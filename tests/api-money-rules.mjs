// Money rules from the admin test report: what each method really received, boxes never overdrawn, who may cancel a paid order.
// Run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4396 node tests/api-money-rules.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4396";
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + "/api" + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
}
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n   ", e.message); }
};
const ok = (r, code = 200) => { if (r.status !== code) throw new Error(`expected ${code}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`); return r.json; };

const admin = client();
const member = client();
const S = {};
const p2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const mainBalance = async () => ok(await admin("GET", "/money/boxes")).rows.find((b) => b.systemKey === "main_cash").balance;
const report = async () => ok(await admin("GET", `/reports/range?from=${TODAY}&to=${TODAY}`));
const received = (r, key) => r.byMethod.find((m) => m.methodId === S.m[key].id)?.usd ?? 0;

console.log("Money rules API test →", BASE);

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  ok(await admin("PUT", "/fx/manual", { rate: 13000 }));
  S.p = Object.fromEntries(ok(await admin("GET", "/menu/catalog")).products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.main = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.systemKey === "main_cash");
  S.client = ok(await admin("GET", "/clients")).rows[0];
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Sami", username: "sami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await member("POST", "/auth/login", { username: "sami", password: "pass1234" }));
});

await step("payment report counts money received, not the order total", async () => {
  const before = await report();
  const line = { productId: S.p.LEMON.id, qty: 5, optionIds: [] };
  const o = ok(await admin("POST", "/orders", { clientId: S.client.id, methodId: S.m.cash.id, paidAmount: 1, lines: [line] }), 201);
  S.partial = o;
  ok(await admin("POST", `/clients/${S.client.id}/payments`, { amount: 2, currency: "USD", methodId: S.m.sham.id }), 201);
  const after = await report();
  assert.ok(near(received(after, "cash") - received(before, "cash"), 1), "cash shows only what was paid at the order");
  assert.ok(near(received(after, "sham") - received(before, "sham"), 2), "the later Sham Cash payment shows too");
  assert.ok(near(after.byMethod.reduce((s, m) => s + m.usd, 0), after.collectedUsd), "methods add up to what was collected");
});

await step("a cancelled order's money leaves the report", async () => {
  const before = await report();
  const o = ok(await admin("POST", "/orders", { methodId: S.m.cash.id, lines: [{ productId: S.p.LEMON.id, qty: 5, optionIds: [] }] }), 201);
  const paid = await report();
  assert.ok(received(paid, "cash") > received(before, "cash"));
  ok(await admin("POST", `/orders/${o.id}/cancel`, { reason: "typo" }));
  const after = await report();
  assert.ok(near(received(after, "cash"), received(before, "cash")));
  assert.ok(near(after.byMethod.reduce((s, m) => s + m.usd, 0), after.collectedUsd));
});

await step("a box cannot pay out more than it holds", async () => {
  const bal = await mainBalance();
  const tooMuch = bal + 50;
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items;
  const sup = ok(await admin("GET", "/purchases/suppliers")).rows[0];
  const emp = ok(await admin("GET", "/people/employees")).rows[0];
  const item = ok(await admin("GET", "/stock/items")).rows.find((i) => i.kind !== "product");
  const place = ok(await admin("GET", "/stock/locations")).rows[0];
  ok(await admin("POST", "/purchases", { supplierId: sup.id, currency: "USD", lines: [{ itemId: item.id, qty: tooMuch, unitPrice: 1, locationId: place.id }] }), 201); // owed, so paying it is allowed in principle
  const refused = [
    ["expense", () => admin("POST", "/expenses", { categoryId: cats[0].id, amount: tooMuch, currency: "USD", boxId: S.main.id })],
    ["withdrawal", () => admin("POST", "/money/withdraw", { boxId: S.main.id, amount: tooMuch })],
    ["supplier payment", () => admin("POST", `/purchases/suppliers/${sup.id}/pay`, { amount: tooMuch, currency: "USD", boxId: S.main.id })],
    ["advance", () => admin("POST", "/people/advances", { employeeId: emp.id, amount: tooMuch, currency: "USD", boxId: S.main.id })],
    ["purchase", () => admin("POST", "/purchases", { supplierId: sup.id, currency: "USD", paid: tooMuch, boxId: S.main.id, lines: [{ itemId: item.id, qty: tooMuch, unitPrice: 1, locationId: place?.id }] })],
  ];
  for (const [name, call] of refused) {
    const r = await call();
    assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.json).slice(0, 200)}`);
    assert.equal(r.json.error, "not_enough", name);
  }
  assert.ok(near(await mainBalance(), bal), "nothing moved");
  assert.equal(ok(await admin("GET", "/expenses")).rows.filter((e) => e.amount === tooMuch).length, 0, "the refused expense was not kept");
});

await step("adding cash makes the payment possible and is not counted as a sale", async () => {
  const bal = await mainBalance();
  const before = await report();
  assert.equal((await member("POST", "/money/deposit", { boxId: S.main.id, amount: 100 })).status, 403);
  ok(await admin("POST", "/money/deposit", { boxId: S.main.id, amount: 100, note: "owner" }), 201);
  assert.ok(near(await mainBalance(), bal + 100));
  const after = await report();
  assert.ok(near(after.collectedUsd, before.collectedUsd), "not collected money");
  assert.ok(near(after.salesUsd, before.salesUsd), "not a sale");
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items;
  ok(await admin("POST", "/expenses", { categoryId: cats[0].id, amount: bal + 100, currency: "USD", boxId: S.main.id }), 201);
  assert.ok(near(await mainBalance(), 0), "exactly the whole box can be paid out");
});

await step("a member can cancel an unpaid order but not one with money on it", async () => {
  const line = { productId: S.p.LEMON.id, qty: 5, optionIds: [] };
  const paid = ok(await member("POST", "/orders", { methodId: S.m.cash.id, lines: [line] }), 201);
  const bal = await mainBalance();
  const r = await member("POST", `/orders/${paid.id}/cancel`, { reason: "took the cash" });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "cancel_needs_manager");
  assert.ok(near(await mainBalance(), bal), "no cash left the box");
  const unpaid = ok(await member("POST", "/orders", { clientId: S.client.id, methodId: S.m.credit.id, lines: [line] }), 201);
  ok(await member("POST", `/orders/${unpaid.id}/cancel`, { reason: "typo" }));
  ok(await admin("POST", `/orders/${paid.id}/cancel`, { reason: "manager checked" }));
});

await step("an expense item suggests its category; overlapping categories are hidden", async () => {
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items;
  const items = ok(await admin("GET", "/lookups?type=expense_item")).items;
  const fuel = cats.find((c) => c.nameEn === "Fuel");
  const scooter = items.find((i) => i.nameEn === "Scooter fuel");
  assert.equal(ok(await admin("GET", "/expenses/item-categories")).map[scooter.id], fuel.id, "seeded default");
  const other = cats.find((c) => c.nameEn === "Maintenance");
  ok(await admin("POST", "/money/deposit", { boxId: S.main.id, amount: 5 }), 201);
  ok(await admin("POST", "/expenses", { categoryId: other.id, itemId: scooter.id, amount: 1, currency: "USD", boxId: S.main.id }), 201);
  assert.equal(ok(await admin("GET", "/expenses/item-categories")).map[scooter.id], other.id, "the shop's own history wins");
  for (const hidden of ["Rent & bills", "Delivery & scooter"]) assert.ok(!cats.some((c) => c.nameEn === hidden), hidden);
  const all = ok(await admin("GET", "/lookups?type=expense_category&includeInactive=1")).items;
  assert.ok(all.some((c) => c.nameEn === "Rent & bills"), "hidden, not deleted");
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll money rule checks passed.");
process.exit(failed ? 1 : 0);
