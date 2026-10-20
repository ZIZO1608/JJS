// Full business-day API test for Stages 2–10 (run on a FRESH data folder):
//   JJS_DATA_DIR=/tmp/jjs-full PORT=4397 node dist/server/server/index.js &
//   BASE=http://127.0.0.1:4397 node tests/api-full.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4397";
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
const manager = client();
const member = client();
const S = {};
const today = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const TODAY = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;

console.log("Full API test →", BASE);

await step("setup + sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's deli shop", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  const r = ok(await admin("POST", "/system/demo-data"));
  assert.equal(r.loaded, true);
  assert.equal(ok(await admin("POST", "/system/demo-data")).loaded, false, "sample data loads only once");
});

await step("catalog has categories, products and add-on groups", async () => {
  const c = ok(await admin("GET", "/menu/catalog"));
  assert.ok(c.categories.length >= 3);
  S.products = Object.fromEntries(c.products.map((p) => [p.code, p]));
  S.groups = c.groups;
  S.double = c.groups.flatMap((g) => g.options).find((o) => o.nameEn === "Double filling");
  assert.ok(S.products.TC && S.double);
  assert.ok(S.products.TC.groupIds.length >= 2, "sandwiches inherit category add-ons");
});

await step("costing: Turkey & Cheddar real cost and margin", async () => {
  const r = ok(await admin("GET", "/costing/products"));
  const tc = r.rows.find((x) => x.nameEn === "Turkey & Cheddar");
  // 0.25 + .08*9 + .025*7 + .03*.8 + .015*1 + .015*3 + .03 + .02 = 1.279
  assert.ok(near(tc.costUsd, 1.279, 0.002), `cost ${tc.costUsd}`);
  assert.ok(near(tc.marginPct, 48.84, 0.1), `margin ${tc.marginPct}`);
  assert.ok(tc.packagingUsd > 0);
});

await step("payment methods, boxes, tiers and staff exist", async () => {
  S.methods = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  assert.ok(S.methods.cash && S.methods.sham && S.methods.credit && S.methods.salary);
  S.boxes = ok(await admin("GET", "/money/boxes")).rows;
  S.main = S.boxes.find((b) => b.systemKey === "main_cash");
  S.repBox = S.boxes.find((b) => b.kind === "rep");
  assert.ok(S.main && S.repBox, "the sample delivery person has a cash box");
  S.clients = Object.fromEntries(ok(await admin("GET", "/clients")).rows.map((c) => [c.name, c]));
  S.reps = ok(await admin("GET", "/money/reps")).rows;
  S.employees = ok(await admin("GET", "/people/employees")).rows;
});

await step("SYP order is refused until an exchange rate is set", async () => {
  ok(await admin("PUT", "/settings/currency", { defaultCurrency: "SYP" }));
  const r = await admin("POST", "/orders/quote", { lines: [{ productId: S.products.TC.id, qty: 1 }] });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "no_rate");
  ok(await admin("PUT", "/fx/manual", { rate: 115 }));
  const q = ok(await admin("POST", "/orders/quote", { lines: [{ productId: S.products.TC.id, qty: 1 }] }));
  assert.equal(q.currency, "SYP");
  assert.equal(q.total, 288); // 2.50 × 115 = 287.5 → rounded to whole pounds
  ok(await admin("PUT", "/settings/currency", { defaultCurrency: "USD" }));
});

await step("make 10 Turkey & Cheddar: ingredients out, fridge batch in", async () => {
  const items = ok(await admin("GET", "/stock/items")).rows;
  S.turkeyItem = items.find((i) => i.nameEn === "Turkey breast");
  S.breadItem = items.find((i) => i.nameEn === "Bread roll");
  const turkeyBefore = S.turkeyItem.qty;
  const r = ok(await admin("POST", "/stock/produce", { productId: S.products.TC.id, qty: 10 }), 201);
  assert.ok(r.batchCode.startsWith("B-"));
  S.tcBatch = r;
  assert.ok(near(r.costUsd, 12.79, 0.02), `production cost ${r.costUsd}`);
  const after = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === S.turkeyItem.id);
  assert.ok(near(after.qty, turkeyBefore - 0.8, 0.0001), "0.8 kg turkey used");
  const scan = ok(await admin("GET", `/stock/scan/${r.batchCode}`));
  assert.equal(scan.batch.qtyLeft, 10);
  assert.equal(scan.batch.status === "fresh" || scan.batch.status === "soon" || scan.batch.status === "today", true);
});

await step("order 1: Focus (favourite 10%), 8 TC + 2 TC double filling, cash, delivered by rep", async () => {
  const r = ok(
    await admin("POST", "/orders", {
      clientId: S.clients["Focus Study Zone"].id,
      fulfilment: "delivery",
      assignedTo: S.reps[0].id,
      methodId: S.methods.cash.id,
      lines: [
        { productId: S.products.TC.id, qty: 8, optionIds: [] },
        { productId: S.products.TC.id, qty: 2, optionIds: [S.double.id] },
      ],
    }),
    201,
  );
  // subtotal 8×2.5 + 2×3.5 = 27; tier 10% → 24.30
  assert.equal(r.receipt.order.subtotal, 27);
  assert.equal(r.receipt.order.total, 24.3);
  assert.match(r.receipt.order.discountReason, /tier:10%/);
  S.order1 = r;
  const scan = ok(await admin("GET", `/stock/scan/${S.tcBatch.batchCode}`));
  assert.equal(scan.batch.qtyLeft, 0, "all 10 came from the fridge batch first (FIFO)");
  const rep = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.repBox.id);
  assert.ok(near(rep.balance, 24.3), "cash on delivery is held by the delivery person");
});

await step("order 2: Bean & Book on credit (no fridge stock → made fresh)", async () => {
  const before = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === S.breadItem.id).qty;
  const r = ok(await admin("POST", "/orders", { clientId: S.clients["Bean & Book Café"].id, methodId: S.methods.credit.id, lines: [{ productId: S.products.CLUB.id, qty: 6, optionIds: [] }, { productId: S.products.LEMON.id, qty: 2, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.total, 20); // 6×3 + 2×1
  assert.equal(r.receipt.order.paymentStatus, "credit");
  assert.ok(near(r.receipt.client.balanceUsd, -20));
  const after = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === S.breadItem.id).qty;
  assert.equal(before - after, 6, "6 breads used for 6 fresh clubs");
  S.order2 = r;
});

await step("credit limit blocks Bean & Book (limit $100, block on)", async () => {
  const r = await admin("POST", "/orders", { clientId: S.clients["Bean & Book Café"].id, methodId: S.methods.credit.id, lines: [{ productId: S.products.BEEF.id, qty: 30, optionIds: [] }] });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "credit_limit");
});

await step("credit needs a client; walk-in pays Sham Cash", async () => {
  const bad = await admin("POST", "/orders", { methodId: S.methods.credit.id, lines: [{ productId: S.products.HAL.id, qty: 1, optionIds: [] }] });
  assert.equal(bad.status, 400);
  const r = ok(await admin("POST", "/orders", { methodId: S.methods.sham.id, lines: [{ productId: S.products.HAL.id, qty: 1, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.total, 2.25);
});

await step("free trial for a new prospect, then conversion on first paid order", async () => {
  const c = ok(await admin("POST", "/clients", { type: "business", name: "New Coworking", creditLimitUsd: 50 }), 201).row;
  S.newClient = c;
  const t = ok(await admin("POST", "/orders", { clientId: c.id, type: "trial", fulfilment: "delivery", assignedTo: S.reps[0].id, lines: [{ productId: S.products.PESTO.id, qty: 3, optionIds: [] }] }), 201);
  assert.equal(t.receipt.order.total, 0);
  assert.equal(t.receipt.order.paymentStatus, "free");
  ok(await admin("POST", "/orders", { clientId: c.id, methodId: S.methods.cash.id, lines: [{ productId: S.products.PESTO.id, qty: 5, optionIds: [] }] }), 201);
  const detail = ok(await admin("GET", `/clients/${c.id}`));
  assert.equal(detail.analytics.converted, true);
  assert.equal(detail.analytics.trials, 1);
});

await step("add-on rules: an add-on from another category is refused", async () => {
  const ice = S.groups.flatMap((g) => g.options).find((o) => o.nameEn === "Extra ice");
  const r = await admin("POST", "/orders/quote", { lines: [{ productId: S.products.TC.id, qty: 1, optionIds: [ice.id] }] });
  assert.equal(r.status, 400);
});

await step("subscription: plan charged to the box, included items free", async () => {
  const plan = ok(await admin("GET", "/clients/plans")).rows[0];
  const lina = S.clients["Lina K."];
  ok(await admin("POST", `/clients/${lina.id}/subscribe`, { planId: plan.id }), 201);
  let d = ok(await admin("GET", `/clients/${lina.id}`));
  assert.ok(near(d.client.balanceUsd, -45), "monthly fee charged");
  const r = ok(await admin("POST", "/orders", { clientId: lina.id, methodId: S.methods.credit.id, lines: [{ productId: S.products.GREEK.id, qty: 2, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.total, 0, "2 included items are free");
  assert.equal(r.receipt.order.subFree, 2);
  d = ok(await admin("GET", `/clients/${lina.id}`));
  assert.equal(d.client.subscription.availableIncluded, 18);
  ok(await admin("POST", `/clients/${lina.id}/payments`, { amount: 45, currency: "USD", methodId: S.methods.sham.id }), 201);
  d = ok(await admin("GET", `/clients/${lina.id}`));
  assert.ok(near(d.client.balanceUsd, 0));
});

await step("loyalty: buy 100 in a month → 5 free on the next order", async () => {
  ok(await admin("PUT", "/system/settings/loyalty", { enabled: true, buyQty: 10, freeQty: 1 }));
  const corner = S.clients["Corner Market"];
  ok(await admin("POST", "/orders", { clientId: corner.id, methodId: S.methods.cash.id, useLoyalty: false, lines: [{ productId: S.products.HAL.id, qty: 10, optionIds: [] }] }), 201);
  const q = ok(await admin("POST", "/orders/quote", { clientId: corner.id, methodId: S.methods.cash.id, lines: [{ productId: S.products.HAL.id, qty: 2, optionIds: [] }] }));
  assert.equal(q.loyaltyFree, 1);
  assert.equal(q.total, 2.25);
  const r = ok(await admin("POST", "/orders", { clientId: corner.id, methodId: S.methods.cash.id, lines: [{ productId: S.products.HAL.id, qty: 2, optionIds: [] }] }), 201);
  assert.equal(r.receipt.loyalty.redeemed, 1);
  assert.equal(r.receipt.loyalty.available, 0);
  ok(await admin("PUT", "/system/settings/loyalty", { enabled: true, buyQty: 100, freeQty: 5 }));
});

await step("taxes: 5% added after discount", async () => {
  const t = ok(await admin("POST", "/taxes", { nameAr: "ضريبة", nameEn: "Tax", kind: "percent", value: 5 }), 201).tax;
  const q = ok(await admin("POST", "/orders/quote", { clientId: S.clients["Focus Study Zone"].id, methodId: S.methods.cash.id, lines: [{ productId: S.products.TC.id, qty: 4, optionIds: [] }] }));
  // 10 − 10% = 9 ; tax 0.45 ; total 9.45
  assert.equal(q.taxTotal, 0.45);
  assert.equal(q.total, 9.45);
  ok(await admin("DELETE", `/taxes/${t.id}`));
});

await step("staff purchase with 30% off, deducted from salary", async () => {
  const emp = S.employees[0];
  const r = ok(await admin("POST", "/orders", { type: "staff", employeeId: emp.id, methodId: S.methods.salary.id, lines: [{ productId: S.products.BEEF.id, qty: 1, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.total, 2.27); // discount 0.975 → 0.98, so 3.25 − 0.98
  assert.equal(r.receipt.order.paymentStatus, "salary");
});

await step("client payment reduces debt; statement shows running balance", async () => {
  const bean = S.clients["Bean & Book Café"];
  ok(await admin("POST", `/clients/${bean.id}/payments`, { amount: 15, currency: "USD", methodId: S.methods.cash.id }), 201);
  const st = ok(await admin("GET", `/clients/${bean.id}/statement?from=${TODAY}&to=${TODAY}`));
  assert.ok(near(st.closingUsd, -5));
  assert.equal(st.lines.length, 2);
});

await step("cancel order 2: stock back, client debt reversed", async () => {
  ok(await admin("POST", `/orders/${S.order2.id}/cancel`));
  const d = ok(await admin("GET", `/clients/${S.clients["Bean & Book Café"].id}`));
  assert.ok(near(d.client.balanceUsd, 15), "only the payment remains → +15 prepaid");
  const again = await admin("POST", `/orders/${S.order2.id}/cancel`);
  assert.equal(again.status, 409);
});

await step("purchase: stock in, weighted average cost, paid from main box", async () => {
  const sup = ok(await admin("GET", "/purchases/suppliers")).rows[1];
  const before = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === S.turkeyItem.id);
  const locs = ok(await admin("GET", "/stock/locations")).rows;
  const r = ok(await admin("POST", "/purchases", { supplierId: sup.id, currency: "USD", lines: [{ itemId: S.turkeyItem.id, qty: before.qty, unitPrice: 11, locationId: locs[0].id }], paid: before.qty * 11, boxId: S.main.id }), 201);
  assert.equal(r.purchase.due, 0);
  const after = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === S.turkeyItem.id);
  assert.ok(near(after.avgCostUsd, 10, 0.001), `avg cost ${after.avgCostUsd} (half at 9, half at 11)`);
});

await step("expense with + Add new item, paid from main box", async () => {
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items;
  const it = ok(await admin("POST", "/lookups", { listType: "expense_item", nameAr: "صيانة البرّاد", nameEn: "Fridge repair" }), 201).item;
  ok(await admin("POST", "/expenses", { categoryId: cats[0].id, itemId: it.id, amount: 6, currency: "USD", boxId: S.main.id, note: "gasket" }), 201);
  const list = ok(await admin("GET", "/expenses")).rows;
  assert.equal(list[0].item.nameEn, "Fridge repair");
});

await step("waste an expired batch", async () => {
  const items = ok(await admin("GET", "/stock/items")).rows;
  const locs = ok(await admin("GET", "/stock/locations")).rows;
  const lettuce = items.find((i) => i.nameEn === "Lettuce");
  const b = ok(await admin("POST", "/stock/receive", { itemId: lettuce.id, qty: 1, locationId: locs[0].id, expiresAt: new Date(Date.now() - 3600e3).toISOString() }), 201);
  const expired = ok(await admin("GET", "/stock/batches?status=expired")).rows;
  assert.ok(expired.some((x) => x.id === b.batchId));
  const reasons = ok(await admin("GET", "/lookups?type=waste_reason")).items;
  const w = ok(await admin("POST", "/stock/waste", { batchId: b.batchId, reasonId: reasons[0].id }));
  assert.ok(w.costUsd > 0);
});

await step("stock count sets the real quantity", async () => {
  const items = ok(await admin("GET", "/stock/items")).rows;
  const cucumber = items.find((i) => i.nameEn === "Cucumber");
  const r = ok(await admin("POST", "/stock/count", { itemId: cucumber.id, counted: cucumber.qty - 0.5 }));
  assert.ok(near(r.difference, -0.5));
  const after = ok(await admin("GET", "/stock/items")).rows.find((i) => i.id === cucumber.id);
  assert.ok(near(after.qty, cucumber.qty - 0.5, 0.0001));
});

await step("prep list for tomorrow from recurring orders", async () => {
  const focus = S.clients["Focus Study Zone"];
  ok(await admin("POST", `/clients/${focus.id}/recurring`, { days: [0, 1, 2, 3, 4, 5, 6], lines: [{ productId: S.products.TC.id, qty: 20, optionIds: [] }] }), 201);
  const p = ok(await admin("GET", "/costing/prep"));
  const tc = p.products.find((x) => x.nameEn === "Turkey & Cheddar");
  assert.equal(tc.qty, 20);
  const bread = p.ingredients.find((x) => x.nameEn === "Bread roll");
  assert.equal(bread.need, 20);
  const due = ok(await admin("GET", "/orders/recurring/due"));
  assert.ok(due.rows.some((r) => r.clientId === focus.id && r.orderedToday === true));
});

await step("advance and payroll preview: base + commission − advance − staff purchase", async () => {
  const emp = S.employees[0];
  ok(await admin("POST", "/people/advances", { employeeId: emp.id, amount: 20, currency: "USD", boxId: S.main.id }), 201);
  const month = TODAY.slice(0, 7);
  const p = ok(await admin("GET", `/people/payroll/${month}`));
  const row = p.rows.find((r) => r.employeeId === emp.id);
  assert.equal(row.baseUsd, 150);
  assert.equal(row.convertedClients, 1);
  // commission: 3% of delivered sales (24.30, the trial is excluded) + $5 per converted client
  assert.ok(near(row.commissionUsd, 24.3 * 0.03 + 5), `commission ${row.commissionUsd}`);
  assert.equal(row.staffPurchasesUsd, 2.27);
  assert.equal(row.advancesUsd, 20);
  assert.ok(near(row.netUsd, 150 + 24.3 * 0.03 + 5 - 2.27 - 20));
});

await step("delivery person hands over cash", async () => {
  const r = ok(await admin("POST", "/money/handover", { boxId: S.repBox.id }));
  assert.ok(near(r.amount, 24.3 + 0)); // order 1 cash; trial was free
});

await step("manager (simple mode): can sell and close, cannot see costs or settings", async () => {
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Rami", username: "rami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "manager").id }), 201);
  ok(await admin("POST", "/users", { name: "Sami", username: "sami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await manager("POST", "/auth/login", { username: "rami", password: "pass1234" }));
  ok(await member("POST", "/auth/login", { username: "sami", password: "pass1234" }));
  assert.equal((await manager("GET", "/costing/products")).status, 403);
  assert.equal((await manager("GET", "/reports/dashboard")).status, 403);
  assert.equal((await manager("PUT", "/system/settings/loyalty", { enabled: false, buyQty: 1, freeQty: 1 })).status, 403);
  ok(await manager("POST", "/orders", { methodId: S.methods.cash.id, lines: [{ productId: S.products.LEMON.id, qty: 1, optionIds: [] }] }), 201);
  const rep = ok(await manager("GET", "/reports/range"));
  assert.equal(rep.hiddenCosts, true);
  assert.equal(rep.costUsd, undefined);
  assert.equal((await manager("POST", "/orders", { manualDiscountPct: 50, methodId: S.methods.cash.id, lines: [{ productId: S.products.LEMON.id, qty: 1, optionIds: [] }] })).status, 201, "manager has orders:edit → may discount");
  assert.equal((await member("POST", "/orders", { manualDiscountPct: 50, methodId: S.methods.cash.id, lines: [{ productId: S.products.LEMON.id, qty: 1, optionIds: [] }] })).status, 403, "member may not discount");
  assert.equal((await member("GET", "/clients")).status, 403);
  assert.equal((await member("POST", "/orders/x/cancel")).status, 403);
  const boxes = ok(await member("GET", "/money/boxes")).rows;
  assert.equal(boxes[0].balance, null, "members do not see box balances");
});

await step("daily close: count, record difference, lock the day", async () => {
  ok(await admin("POST", "/money/opening", { boxId: S.main.id, amount: 300 }));
  assert.equal((await admin("POST", "/money/opening", { boxId: S.main.id, amount: 300 })).status, 409);
  const d = ok(await manager("GET", `/days/${TODAY}`));
  assert.equal(d.day.status, "open");
  const expected = d.mainBox.expected;
  const closed = ok(await manager("POST", `/days/${TODAY}/close`, { counted: expected - 0.5 }));
  assert.equal(closed.day.status, "closed");
  assert.ok(near(closed.day.totals.cash.difference, -0.5));
  const blocked = await manager("POST", "/orders", { methodId: S.methods.cash.id, lines: [{ productId: S.products.LEMON.id, qty: 1, optionIds: [] }] });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, "day_closed");
  assert.equal((await manager("POST", `/days/${TODAY}/reopen`)).status, 403, "only admin reopens");
  ok(await admin("POST", `/days/${TODAY}/reopen`));
});

await step("reports: day numbers add up", async () => {
  const r = ok(await admin("GET", `/reports/range?from=${TODAY}&to=${TODAY}`));
  assert.ok(r.orders >= 9);
  assert.ok(r.salesUsd > 50);
  assert.ok(r.costUsd > 0 && r.grossProfitUsd > 0);
  assert.ok(near(r.netUsd, r.grossProfitUsd - r.expensesUsd - r.wasteUsd - r.depreciationUsd - r.salariesUsd, 0.02));
  assert.equal(r.trials.given, 1);
  assert.equal(r.trials.converted, 1);
  const tc = r.byProduct.find((p) => p.nameEn === "Turkey & Cheddar");
  assert.ok(tc.marginPct > 0);
  const dash = ok(await admin("GET", "/reports/dashboard"));
  assert.equal(dash.week.length, 7);
  assert.ok(dash.alerts.lowStock.length >= 0);
  const csv = await admin("GET", `/reports/export/orders.csv?from=${TODAY}&to=${TODAY}`);
  assert.equal(csv.status, 200);
  assert.match(String(csv.json), /Number,Date,Client/);
});

await step("assets: depreciation per month", async () => {
  const r = ok(await admin("POST", "/assets", { nameAr: "برّاد", nameEn: "Fridge", price: 600, currency: "USD", purchaseDate: TODAY, lifeMonths: 60 }), 201);
  assert.equal(r.row.monthlyUsd, 10);
  const o = ok(await admin("GET", `/costing/overheads?month=${TODAY.slice(0, 7)}`));
  assert.ok(o.depreciationUsd >= 10);
  assert.ok(o.perItemUsd > 0);
});

await step("pay salaries: advance settled, box paid out, cannot pay twice", async () => {
  const month = TODAY.slice(0, 7);
  ok(await admin("POST", `/people/payroll/${month}/pay`, { boxId: S.main.id }));
  const p = ok(await admin("GET", `/people/payroll/${month}`));
  assert.equal(p.status, "paid");
  const adv = ok(await admin("GET", "/people/advances?open=1")).rows;
  assert.equal(adv.length, 0);
  assert.equal((await admin("POST", `/people/payroll/${month}/pay`, { boxId: S.main.id })).status, 409);
});

await step("sync is off until configured; LAN info available", async () => {
  const s = ok(await admin("GET", "/system/sync"));
  assert.equal(s.enabled, false);
  assert.ok(s.pending > 0);
  const n = ok(await admin("GET", "/system/network"));
  assert.equal(typeof n.port, "number");
});

await step("audit log recorded the day", async () => {
  const a = ok(await admin("GET", "/audit?entity=order&pageSize=200"));
  assert.ok(a.total >= 9);
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll full-system API checks passed.");
process.exitCode = failed ? 1 : 0;
