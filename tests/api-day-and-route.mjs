// My day, money cloud, client locations, route order, goods coming back, clients sheet, client report, one-button close.
// Run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4396 node tests/api-day-and-route.mjs
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

console.log("Day, route & returns API test →", BASE);

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  S.p = Object.fromEntries(ok(await admin("GET", "/menu/catalog")).products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.main = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.systemKey === "main_cash");
  S.c = Object.fromEntries(ok(await admin("GET", "/clients")).rows.map((x) => [x.name, x]));
  S.rep = ok(await admin("GET", "/money/reps")).rows[0];
  S.tags = ok(await admin("GET", "/lookups?type=client_tag")).items;
});

await step("new client: type, manager, location from a long Google Maps link", async () => {
  const cafe = S.tags.find((t) => t.nameEn === "Café");
  const r = ok(
    await admin("POST", "/clients", {
      type: "business",
      name: "Bean Corner",
      tagId: cafe.id,
      phone: "0933000000",
      contactPerson: "Lina",
      address: "Mazzeh, next to the bakery",
      mapUrl: "https://www.google.com/maps/place/Bean+Corner/@33.5000,36.2500,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d33.5012!4d36.2534",
      note: "Opens at 8",
      repId: S.rep.id,
      portalAccess: false,
    }),
    201,
  );
  assert.equal(r.row.lat, 33.5012, "the pin wins over the camera position");
  assert.equal(r.row.lng, 36.2534);
  S.bean = r.row;
  const picked = ok(await admin("PUT", `/clients/${S.bean.id}`, { ...S.bean, lat: 33.51, lng: 36.26 }));
  assert.equal(picked.row.lat, 33.51, "a spot picked on the map is kept");
});

await step("short map links are only followed to Google", async () => {
  const r = await admin("POST", "/clients/resolve-map-link", { url: "https://example.com/@33.1,36.1" });
  assert.equal(r.status, 200, "coordinates already in the text need no fetch");
  const bad = await admin("POST", "/clients/resolve-map-link", { url: "https://evil.example.com/abc" });
  assert.equal(bad.status, 422);
});

await step("route sheet: stops carry their pins", async () => {
  ok(await admin("PUT", `/clients/${S.c["Focus Study Zone"].id}`, { ...S.c["Focus Study Zone"], lat: 33.52, lng: 36.28 }));
  ok(await admin("POST", "/orders", { clientId: S.bean.id, fulfilment: "delivery", assignedTo: S.rep.id, methodId: S.m.credit.id, lines: [{ productId: S.p.TC.id, qty: 2, optionIds: [] }] }), 201);
  ok(await admin("POST", "/orders", { clientId: S.c["Focus Study Zone"].id, fulfilment: "delivery", assignedTo: S.rep.id, methodId: S.m.credit.id, lines: [{ productId: S.p.TC.id, qty: 1, optionIds: [] }] }), 201);
  const sheet = ok(await admin("GET", `/route-sheet?date=${TODAY}&repId=${S.rep.id}`));
  const bean = sheet.stops.find((s) => s.clientId === S.bean.id);
  assert.equal(bean.lat, 33.51);
  assert.ok(sheet.stops.filter((s) => s.lat != null).length >= 2);
});

await step("an order comes back: fridge, trash and another client", async () => {
  ok(await admin("POST", "/stock/produce", { productId: S.p.TC.id, qty: 10 }), 201);
  const o = ok(await admin("POST", "/orders", { clientId: S.c["Focus Study Zone"].id, methodId: S.m.credit.id, lines: [{ productId: S.p.TC.id, qty: 6, optionIds: [] }, { productId: S.p.CLUB.id, qty: 2, optionIds: [] }] }), 201);
  const before = ok(await admin("GET", `/clients/${S.bean.id}`)).client?.balanceUsd ?? ok(await admin("GET", "/clients")).rows.find((c) => c.id === S.bean.id).balanceUsd;
  const r = ok(
    await admin("POST", "/returns", {
      orderId: o.id,
      settlement: "credit",
      lines: [
        { productId: S.p.TC.id, qty: 3, action: "give" },
        { productId: S.p.CLUB.id, qty: 1, action: "waste" },
      ],
      giveTo: { clientId: S.bean.id },
    }),
    201,
  );
  assert.ok(r.givenOrder?.number > 0, "a new invoice was made for the other client");
  assert.equal(r.return.givenOrderId, r.givenOrder.id);
  assert.deepEqual(r.return.lines.map((l) => l.action).sort(), ["give", "waste"]);
  const given = ok(await admin("GET", `/orders/${r.givenOrder.id}`)).order;
  assert.equal(given.clientId, S.bean.id);
  assert.equal(given.itemsCount, 3);
  const after = ok(await admin("GET", "/clients")).rows.find((c) => c.id === S.bean.id).balanceUsd;
  assert.ok(after < before, "the other client now owes for the goods");
  const same = await admin("POST", "/returns", { orderId: o.id, settlement: "none", lines: [{ productId: S.p.TC.id, qty: 1, action: "give" }], giveTo: { clientId: S.c["Focus Study Zone"].id } });
  assert.equal(same.status, 400, "cannot give back to the same client");
});

await step("my day: five boxes add up", async () => {
  const day = ok(await admin("GET", "/reports/day"));
  const range = ok(await admin("GET", "/reports/range"));
  assert.ok(near(day.profit.usd, range.grossProfitUsd));
  assert.ok(near(day.net.usd, range.grossProfitUsd - range.expensesUsd - range.wasteUsd));
  assert.ok(day.made.total >= 10);
  assert.ok(day.used.count > 0 && day.used.usd > 0);
  assert.equal(day.boxes.rows.length, 2);
  const money = ok(await admin("GET", "/reports/my-money"));
  assert.ok(near(money.totalUsd, money.cashUsd + money.clientsOweUsd + money.goodsAtShopsUsd - money.weOweUsd - money.dueExpensesUsd));
});

await step("clients sheet for a time window", async () => {
  const from = new Date(Date.now() - 3600e3).toISOString();
  const to = new Date(Date.now() + 60e3).toISOString();
  const sh = ok(await admin("GET", `/reports/clients-sheet?from=${from}&to=${to}`));
  const bean = sh.rows.find((r) => r.clientId === S.bean.id);
  assert.ok(bean && bean.items === 5, "2 delivered + 3 given");
  assert.ok(near(bean.leftUsd, bean.totalUsd - bean.paidUsd));
  assert.ok(near(sh.totals.totalUsd, sh.rows.reduce((s, r) => s + r.totalUsd, 0)));
  const empty = ok(await admin("GET", `/reports/clients-sheet?from=2000-01-01T00:00:00.000Z&to=2000-01-02T00:00:00.000Z`));
  assert.equal(empty.rows.length, 0);
  assert.equal((await admin("GET", `/reports/clients-sheet?from=${to}&to=${from}`)).status, 400);
});

await step("client report: products, invoices, money", async () => {
  const r = ok(await admin("GET", `/clients/${S.bean.id}/statement?from=${TODAY}&to=${TODAY}`));
  assert.equal(r.summary.orders, 2);
  assert.equal(r.summary.items, 5);
  assert.equal(r.products[0].qty, 5);
  assert.ok(near(r.summary.boughtUsd, r.orders.reduce((s, o) => s + o.totalUsd, 0)));
});

await step("member is orders only", async () => {
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Sami", username: "sami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await member("POST", "/auth/login", { username: "sami", password: "pass1234" }));
  const me = ok(await member("GET", "/auth/me"));
  assert.deepEqual([...me.user.permissions].sort(), ["home:view", "orders:create", "orders:delete", "orders:view"]);
  const o = ok(await member("POST", "/orders", { clientId: S.bean.id, methodId: S.m.cash.id, lines: [{ productId: S.p.LEMON.id, qty: 1, optionIds: [] }] }), 201);
  ok(await member("POST", `/orders/${o.id}/cancel`, { reason: "typo" }));
  for (const path of ["/stock/batches", "/reports/day", "/reports/my-money", "/route-sheet", `/clients/${S.bean.id}/statement?from=${TODAY}&to=${TODAY}`]) {
    assert.equal((await member("GET", path)).status, 403, path);
  }
});

await step("close the day in one go: delivery cash, leftovers, count", async () => {
  const v = ok(await admin("GET", `/days/${TODAY}`));
  const repBox = v.reps.find((b) => b.balance > 0) ?? null;
  const leftover = v.leftovers.find((b) => b.qty > 0);
  assert.ok(leftover, "there are sandwiches left in the fridge");
  const expected = v.mainBox.expected + (repBox ? repBox.balance : 0);
  const closed = ok(await admin("POST", `/days/${TODAY}/close`, { counted: expected, handoverBoxIds: repBox ? [repBox.id] : [], wasteBatchIds: [leftover.batchId] }));
  assert.equal(closed.day.status, "closed");
  assert.ok(near(closed.day.totals.cash.difference, 0), "cash matches once the delivery cash is in");
  assert.ok(!closed.leftovers.some((b) => b.batchId === leftover.batchId), "the leftover batch was thrown away");
  assert.ok(closed.day.totals.wasteUsd > 0);
  ok(await admin("POST", `/days/${TODAY}/reopen`));
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll day, route & returns checks passed.");
process.exit(failed ? 1 : 0);
