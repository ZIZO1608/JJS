// Manager rules from the manager test report: no cost data in any answer, a blind cash count, purchases stay private.
// Run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4397 node tests/api-manager-rules.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4397";

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

// hiddenCosts is only the flag that tells the screen costs were removed.
const COST = /^(?!hiddenCosts$).*(cost|profit|margin|valueUsd)/i;
/** Every key anywhere in an answer that talks about costs, with where it was found. */
const costKeys = (v, at = "") => {
  if (Array.isArray(v)) return v.flatMap((x) => costKeys(x, at));
  if (v === null || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => [...(COST.test(k) ? [`${at}.${k}`] : []), ...costKeys(x, `${at}.${k}`)]);
};

const admin = client();
const manager = client();
const S = {};
const p2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

console.log("Manager rules API test →", BASE);

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  S.p = Object.fromEntries(ok(await admin("GET", "/menu/catalog")).products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.main = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.systemKey === "main_cash");
  S.client = ok(await admin("GET", "/clients")).rows[0];
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Rami", username: "rami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "manager").id }), 201);
  ok(await manager("POST", "/auth/login", { username: "rami", password: "pass1234" }));
});

await step("a payment in SYP without a rate is refused with a code the screen can explain", async () => {
  ok(await admin("PUT", "/fx/manual", { rate: null }));
  if (ok(await manager("GET", "/fx/current")).rate) return; // a saved online rate exists here: nothing to refuse
  const r = await manager("POST", `/clients/${S.client.id}/payments`, { amount: 1000, currency: "SYP", methodId: S.m.cash.id, kind: "topup" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "no_rate");
});

await step("the manager's answers carry no cost field, the admin's still do", async () => {
  ok(await admin("PUT", "/fx/manual", { rate: 13000 }));
  ok(await admin("POST", "/money/opening", { boxId: S.main.id, amount: 100 }));
  const order = ok(await manager("POST", "/orders", { clientId: S.client.id, methodId: S.m.cash.id, lines: [{ productId: S.p.LEMON.id, qty: 2, optionIds: [] }] }), 201);
  S.order = order;
  assert.deepEqual(costKeys(order), [], "the new order's receipt");
  const made = ok(await manager("POST", "/stock/produce", { productId: S.p.LEMON.id, qty: 1 }), 201);
  assert.deepEqual(costKeys(made), [], "a production answer");
  const paths = ["/orders", `/orders/${order.id}`, `/orders/${order.id}/receipt`, "/menu/products", "/menu/catalog", "/stock/items", "/stock/batches", "/stock/moves", "/production", `/days/${TODAY}`, "/days", `/reports/range?from=${TODAY}&to=${TODAY}`];
  for (const path of paths) {
    const r = await manager("GET", path);
    if (r.status === 403 || r.status === 404) continue; // not open to this role at all
    assert.equal(r.status, 200, path);
    assert.deepEqual(costKeys(r.json), [], path);
  }
  assert.ok(ok(await admin("GET", `/orders/${order.id}`)).order.costUsd !== undefined, "the admin keeps order costs");
  assert.ok(ok(await admin("GET", "/stock/items")).rows[0].avgCostUsd !== undefined, "the admin keeps item costs");
});

await step("saving an item without seeing costs leaves its cost alone", async () => {
  const item = ok(await admin("GET", "/stock/items")).rows.find((i) => i.kind !== "product" && i.avgCostUsd > 0);
  const { qty: _q, valueUsd: _v, low: _l, avgCostUsd: cost, ...fields } = item;
  ok(await manager("PUT", `/stock/items/${item.id}`, { nameAr: fields.nameAr, nameEn: fields.nameEn, kind: fields.kind, unitCode: fields.unitCode, minLevel: fields.minLevel + 1, avgCostUsd: 0 }));
  const after = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === item.id);
  assert.equal(after.minLevel, fields.minLevel + 1, "the edit itself went through");
  assert.equal(after.avgCostUsd, cost);
});

await step("the money report shows purchases to the admin only", async () => {
  const path = `/reports/range?from=${TODAY}&to=${TODAY}`;
  const m = ok(await manager("GET", path));
  assert.equal(m.purchasesUsd, undefined);
  assert.equal(m.purchasesCount, undefined);
  assert.equal(m.salariesUsd, undefined);
  assert.equal(m.hiddenCosts, true);
  assert.ok(ok(await admin("GET", path)).purchasesUsd !== undefined);
  assert.equal(ok(await manager("GET", `/days/${TODAY}`)).report.purchasesUsd, undefined, "the close page's report too");
});

await step("the manager counts blind: no expected cash anywhere until the day is closed", async () => {
  const view = ok(await manager("GET", `/days/${TODAY}`));
  assert.equal(view.mainBox.expected, null);
  assert.equal(view.cashFlow, undefined);
  assert.equal(ok(await manager("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id).balance, null);
  assert.equal((await manager("GET", `/money/boxes/${S.main.id}/moves`)).status, 403);
  const adminView = ok(await admin("GET", `/days/${TODAY}`));
  assert.equal(typeof adminView.mainBox.expected, "number");
  assert.ok(adminView.cashFlow);

  const closed = ok(await manager("POST", `/days/${TODAY}/close`, { counted: 5 }));
  assert.equal(closed.day.status, "closed");
  assert.equal(closed.day.totals.cash.expected, adminView.mainBox.expected, "closing reveals the expected amount");
  assert.equal(closed.day.totals.cash.counted, 5);
  assert.deepEqual(costKeys(closed), [], "the frozen numbers are filtered too");
  assert.equal(closed.day.totals.netUsd, undefined);
  assert.equal(closed.day.totalsJson, undefined);
});

await step("a reopened day is blind again", async () => {
  ok(await admin("POST", `/days/${TODAY}/reopen`));
  const view = ok(await manager("GET", `/days/${TODAY}`));
  assert.equal(view.mainBox.expected, null);
  assert.equal(view.day.totals, null);
  assert.equal(view.day.expectedCashUsd, null);
  assert.equal(ok(await manager("GET", "/days")).rows.find((r) => r.date === TODAY).totals, null);
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll manager rules passed");
process.exit(failed ? 1 : 0);
