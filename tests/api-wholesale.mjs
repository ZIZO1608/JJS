// Wholesale & distribution pack — run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4395 node tests/api-wholesale.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4395";
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
const S = {};
const p2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

console.log("Wholesale API test →", BASE);

await step("setup, sample data, people and lists", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's Kitchen", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  const c = ok(await admin("GET", "/menu/catalog"));
  S.p = Object.fromEntries(c.products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.boxes = ok(await admin("GET", "/money/boxes")).rows;
  S.main = S.boxes.find((b) => b.systemKey === "main_cash");
  S.c = Object.fromEntries(ok(await admin("GET", "/clients")).rows.map((x) => [x.name, x]));
  S.rep = ok(await admin("GET", "/money/reps")).rows[0];
  S.items = Object.fromEntries(ok(await admin("GET", "/stock/items")).rows.map((i) => [i.nameEn, i]));
  S.locs = ok(await admin("GET", "/stock/locations")).rows;
  ok(await admin("POST", "/money/opening", { boxId: S.main.id, amount: 500 }));
  assert.ok(S.c["Al-Noor Market"].consignment === true);
  assert.equal(S.c["City Distributor"].paymentTermsDays, 14);
  const areas = ok(await admin("GET", "/lookups?type=area")).items;
  assert.ok(areas.some((a) => a.nameEn === "Downtown"));
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items.map((x) => x.nameEn);
  for (const k of ["Rent", "Salaries", "Fuel", "Electricity", "Fees & licenses"]) assert.ok(cats.includes(k), `category ${k}`);
});

await step("price lists: the distributor pays its list price", async () => {
  const q = ok(await admin("POST", "/orders/quote", { clientId: S.c["City Distributor"].id, lines: [{ productId: S.p.TC.id, qty: 20, optionIds: [] }] }));
  assert.equal(q.lines[0].unitPrice, 1.9);
  assert.equal(q.lines[0].priceFrom, "list");
  assert.equal(q.total, 38);
  const lists = ok(await admin("GET", "/clients/price-lists")).rows;
  assert.equal(lists.length, 2);
  const items = ok(await admin("GET", `/clients/price-lists/${lists[0].id}/items`)).rows;
  assert.ok(items.length >= 5);
});

await step("invoice of 600 paid 400: the rest goes on the shop's account", async () => {
  // 20 × 1.9 = 38, paid 25 now → 13 on account
  const r = ok(await admin("POST", "/orders", { clientId: S.c["City Distributor"].id, fulfilment: "delivery", methodId: S.m.cash.id, paidAmount: 25, lines: [{ productId: S.p.TC.id, qty: 20, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.paymentStatus, "partial");
  assert.equal(r.receipt.payment.paid, 25);
  assert.equal(r.receipt.payment.remaining, 13);
  assert.ok(near(r.receipt.account.beforeUsd, 0) && near(r.receipt.account.afterUsd, -13));
  S.partial = r;
  const box = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id);
  assert.ok(near(box.balance, 525));
});

await step("client snapshot on the invoice screen: last order, debt, agreed prices", async () => {
  const s = ok(await admin("GET", `/clients/${S.c["City Distributor"].id}/snapshot`));
  assert.equal(s.lastOrder.number, S.partial.number);
  assert.ok(near(s.aging.balanceUsd, -13));
  assert.equal(s.aging.overdueDays, 0, "not late yet: 14 days to pay");
  assert.ok(s.agreedPrices.some((p) => p.from === "list" && p.price === 1.9));
  assert.ok(near(s.month.salesUsd, 38));
});

await step("cancel with a reason reverses money and debt", async () => {
  ok(await admin("POST", `/orders/${S.partial.id}/cancel`, { reason: "Entry mistake" }));
  const o = ok(await admin("GET", `/orders/${S.partial.id}`)).order;
  assert.equal(o.status, "cancelled");
  assert.equal(o.cancelReason, "Entry mistake");
  const c = ok(await admin("GET", `/clients/${S.c["City Distributor"].id}`)).client;
  assert.ok(near(c.balanceUsd, 0));
  const box = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id);
  assert.ok(near(box.balance, 500));
});

await step("production run: materials checked first, then 50 + 30 made in one batch run", async () => {
  const lines = [{ productId: S.p.TC.id, qty: 50 }, { productId: S.p.CLUB.id, qty: 30 }];
  const pv = ok(await admin("POST", "/production/preview", { lines }));
  const bread = pv.materials.find((m) => m.nameEn === "Bread roll");
  assert.equal(bread.need, 80);
  assert.equal(pv.itemsCount, 80);
  const turkey = pv.materials.find((m) => m.nameEn === "Turkey breast");
  assert.ok(near(turkey.need, 4)); // 50 × 80 g = 4 kg (the doc's own example)
  const run = ok(await admin("POST", "/production", { lines, employeeId: S.rep.id }), 201);
  assert.equal(run.batches.length, 2);
  assert.equal(run.itemsCount, 80);
  S.tcBatch = run.batches.find((b) => b.productId === S.p.TC.id);
  const list = ok(await admin("GET", "/production")).rows;
  assert.equal(list[0].batches.length, 2);
});

await step("recipe waste % is used and costed", async () => {
  const prods = ok(await admin("GET", "/menu/products")).rows;
  const tc = prods.find((p) => p.code === "TC");
  const body = {
    categoryId: tc.categoryId, code: tc.code, nameAr: tc.nameAr, nameEn: tc.nameEn, price: tc.price, currency: tc.currency, shelfLifeHours: tc.shelfLifeHours, allergens: tc.allergens,
    optionGroupIds: tc.ownGroupIds, weightG: 220, extraCost: 0.05,
    recipe: tc.recipe.map((r) => ({ itemId: r.itemId, qty: r.qty, wastePct: r.nameEn === "Lettuce" ? 20 : 0 })),
  };
  const before = tc.costUsd;
  const r = ok(await admin("PUT", `/menu/products/${tc.id}`, body));
  const after = r.row?.costUsd ?? ok(await admin("GET", "/menu/products")).rows.find((p) => p.code === "TC").costUsd;
  // + 20% of 15 g lettuce at $1/kg = $0.003, + $0.05 extra
  assert.ok(near(after - before, 0.053, 0.002), `cost went from ${before} to ${after}`);
  const cost = ok(await admin("GET", "/costing/products")).rows.find((p) => p.nameEn === "Turkey & Cheddar");
  assert.ok(cost.targetPriceUsd > cost.costUsd);
  assert.ok(near(cost.cost100Usd, cost.costUsd * 100, 0.01));
});

await step("consignment: 30 left at Al-Noor, 5 come back, 25 are invoiced at the agreed price", async () => {
  const r = ok(await admin("POST", "/consignments", { clientId: S.c["Al-Noor Market"].id, repId: S.rep.id, lines: [{ productId: S.p.TC.id, qty: 30 }] }), 201);
  assert.equal(r.consignment.lines[0].unitPrice, 2.2, "small-shop price list");
  S.cons = r.consignment;
  const scan = ok(await admin("GET", `/stock/scan/${S.tcBatch.batchCode}`));
  assert.equal(scan.batch.qtyLeft, 20, "taken from the morning batch");
  const sheet = ok(await admin("GET", `/route-sheet?repId=${S.rep.id}`));
  assert.ok(sheet.stops.some((s) => s.name === "Al-Noor Market" && s.consignments.length === 1));
  const st = ok(await admin("POST", `/consignments/${r.id}/settle`, { lines: [{ productId: S.p.TC.id, returnedQty: 5, action: "waste" }] }));
  assert.equal(st.soldQty, 25);
  assert.equal(st.returnedQty, 5);
  const inv = ok(await admin("GET", `/orders/${st.orderId}`)).order;
  assert.equal(inv.total, 55);
  assert.equal(inv.paymentStatus, "credit");
  const c = ok(await admin("GET", `/clients/${S.c["Al-Noor Market"].id}`)).client;
  assert.ok(near(c.balanceUsd, -55));
  assert.equal((await admin("POST", `/orders/${st.orderId}/cancel`, {})).status, 409, "consignment invoices are corrected with returns");
});

await step("batch tracing: which shops got the morning batch", async () => {
  const t = ok(await admin("GET", `/trace/${S.tcBatch.batchCode}`));
  assert.ok(t.received.some((r) => r.kind === "consignment" && r.clientName === "Al-Noor Market" && r.qty === 30));
  assert.equal(t.run.number, 1);
});

await step("return on an invoice: 2 back to the fridge, the shop is credited", async () => {
  const o = ok(await admin("POST", "/orders", { clientId: S.c["Focus Study Zone"].id, methodId: S.m.credit.id, lines: [{ productId: S.p.CLUB.id, qty: 10, optionIds: [] }] }), 201);
  // Club 3.00 − 10% favourite = 2.70; 10 → 27 on account
  S.focusOrder = o;
  const r = ok(await admin("POST", "/returns", { orderId: o.id, settlement: "credit", lines: [{ productId: S.p.CLUB.id, qty: 2, action: "restock" }] }), 201);
  assert.equal(r.total, 5.4);
  const c = ok(await admin("GET", `/clients/${S.c["Focus Study Zone"].id}`)).client;
  assert.ok(near(c.balanceUsd, -21.6));
  const tooMany = await admin("POST", "/returns", { orderId: o.id, settlement: "credit", lines: [{ productId: S.p.CLUB.id, qty: 9, action: "waste" }] });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.json.error, "return_too_many");
  const st = ok(await admin("GET", `/clients/${S.c["Focus Study Zone"].id}/statement?from=${TODAY}&to=${TODAY}`));
  assert.ok(st.lines.some((l) => l.type === "return"));
  assert.equal(st.returns.length, 1);
});

await step("walk-in return: refund from the cash box", async () => {
  const o = ok(await admin("POST", "/orders", { methodId: S.m.cash.id, lines: [{ productId: S.p.HAL.id, qty: 2, optionIds: [] }] }), 201);
  const before = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id).balance;
  ok(await admin("POST", "/returns", { orderId: o.id, settlement: "refund", boxId: S.main.id, lines: [{ productId: S.p.HAL.id, qty: 1, action: "waste" }] }), 201);
  const after = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id).balance;
  assert.ok(near(before - after, 2.25));
});

await step("tasting / internal use: no money, cost recorded", async () => {
  const r = ok(await admin("POST", "/orders", { type: "internal", note: "tasting new sauce", lines: [{ productId: S.p.PESTO.id, qty: 2, optionIds: [] }] }), 201);
  assert.equal(r.receipt.order.total, 0);
  assert.equal(r.receipt.order.paymentStatus, "free");
  ok(await admin("POST", "/stock/use", { itemId: S.items["Cucumber"].id, qty: 0.2, note: "staff salad" }));
  const rep = ok(await admin("GET", `/reports/range?from=${TODAY}&to=${TODAY}`));
  assert.equal(rep.internalUse.orders, 1);
  assert.ok(rep.internalUse.costUsd > 0);
});

await step("supplier invoice: number, discount, transport, packs, due date → real unit cost", async () => {
  const sup = ok(await admin("GET", "/purchases/suppliers")).rows.find((s) => s.name === "Cold cuts supplier");
  assert.ok(near(sup.dueUsd, 40), "opening balance owed");
  const bread = S.items["Bread roll"];
  // 10 bags × $2.00 (10 rolls each) = $20, discount $2, transport $1 → $19 for 100 rolls = $0.19 per roll
  const r = ok(await admin("POST", "/purchases", { supplierId: sup.id, supplierRef: "INV-778", currency: "USD", discount: 2, transport: 1, paid: 9, boxId: S.main.id, lines: [{ itemId: bread.id, qty: 10, inPacks: true, unitPrice: 2, locationId: S.locs[0].id }] }), 201);
  assert.equal(r.purchase.total, 19);
  assert.equal(r.purchase.supplierRef, "INV-778");
  assert.ok(r.purchase.dueDate > TODAY, "due date from the supplier's 7 days");
  assert.equal(r.purchase.lines[0].qty, 100);
  const changes = ok(await admin("GET", "/purchases/price-changes")).rows;
  assert.ok(changes.some((c) => c.nameEn === "Bread roll" && c.changePct < 0), "bread got cheaper (0.25 → 0.19)");
  const debts = ok(await admin("GET", "/purchases/debts"));
  assert.ok(near(debts.totalUsd, 50), `owed ${debts.totalUsd}`); // 40 opening + 10 remaining
});

await step("pay a supplier: opening balance first, then the oldest invoice", async () => {
  const sup = ok(await admin("GET", "/purchases/suppliers")).rows.find((s) => s.name === "Cold cuts supplier");
  const r = ok(await admin("POST", `/purchases/suppliers/${sup.id}/pay`, { amount: 45, currency: "USD", boxId: S.main.id }));
  assert.ok(near(r.due.openingDueUsd, 0));
  assert.ok(near(r.due.totalDueUsd, 5));
  const st = ok(await admin("GET", `/purchases/suppliers/${sup.id}/statement`));
  assert.ok(near(st.closingUsd, 5));
  assert.ok(st.lines.some((l) => l.kind === "payment"));
});

await step("price-change radar shows the products the change touched", async () => {
  const imp = ok(await admin("GET", "/costing/impact"));
  const tc = imp.products.find((p) => p.nameEn === "Turkey & Cheddar");
  assert.ok(tc && tc.costNowUsd < tc.costBeforeUsd, "cheaper bread lowers the sandwich cost");
  assert.ok(tc.marginNow > tc.marginBefore);
});

await step("expenses: due vs paid, who paid, the beneficiary, monthly rent", async () => {
  const cats = ok(await admin("GET", "/lookups?type=expense_category")).items;
  const elec = cats.find((c) => c.nameEn === "Electricity");
  const e = ok(await admin("POST", "/expenses", { categoryId: elec.id, amount: 30, currency: "USD", status: "due", beneficiary: "Electricity company", note: "October bill" }), 201);
  const due = ok(await admin("GET", "/expenses?status=due")).rows;
  assert.ok(due.some((x) => x.id === e.id));
  const before = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id).balance;
  ok(await admin("POST", `/expenses/${e.id}/pay`, { boxId: S.main.id, paidBy: "Owner" }));
  const after = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === S.main.id).balance;
  assert.ok(near(before - after, 30));
  assert.equal((await admin("POST", `/expenses/${e.id}/pay`, { boxId: S.main.id })).status, 409);
  const fuel = cats.find((c) => c.nameEn === "Fuel");
  ok(await admin("POST", "/expenses", { categoryId: fuel.id, amount: 4, currency: "USD", boxId: S.main.id, employeeId: S.rep.id, paidBy: "Ahmad" }), 201);
  const rec = ok(await admin("GET", "/expenses/recurring")).rows;
  assert.equal(rec.length, 1);
  ok(await admin("POST", "/expenses/recurring/run"));
  const all = ok(await admin("GET", "/expenses?status=due")).rows;
  assert.ok(all.some((x) => x.recurringId === rec[0].id && x.amount === 200), "rent created as due");
  const again = ok(await admin("POST", "/expenses/recurring/run"));
  assert.equal(again.created, 0, "only once a month");
  const dc = ok(await admin("GET", `/reports/delivery-cost?from=${TODAY}&to=${TODAY}`));
  assert.ok(near(dc.totalUsd, 4));
});

await step("personal withdrawal from the box (owner only)", async () => {
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Rami", username: "rami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "manager").id }), 201);
  ok(await manager("POST", "/auth/login", { username: "rami", password: "pass1234" }));
  assert.equal((await manager("POST", "/money/withdraw", { boxId: S.main.id, amount: 10 })).status, 403);
  ok(await admin("POST", "/money/withdraw", { boxId: S.main.id, amount: 20, person: "Owner" }), 201);
  const w = ok(await admin("GET", `/money/withdrawals?from=${TODAY}&to=${TODAY}`));
  assert.ok(near(w.totalUsd, 20));
});

await step("daily close view: box flow, rep settlement, made vs sold", async () => {
  const dv = ok(await manager("GET", `/days/${TODAY}`));
  assert.ok(near(dv.cashFlow.expected, dv.mainBox.expected));
  assert.ok(dv.cashFlow.moves.some((m) => m.type === "withdrawal"));
  const rep = dv.repSettlement.find((r) => r.employeeId === S.rep.id);
  assert.ok(rep && rep.expensesUsd === 4);
  const tc = dv.production.find((p) => p.productId === S.p.TC.id);
  assert.equal(tc.made, 50);
  assert.equal(tc.consigned, 30);
  assert.equal(tc.closing, tc.leftNow);
});

await step("reports: returns, collected, five answers, production, cash flow, months", async () => {
  const r = ok(await admin("GET", `/reports/range?from=${TODAY}&to=${TODAY}`));
  assert.ok(near(r.returnsUsd, 5.4 + 2.25));
  assert.ok(near(r.netSalesUsd, r.salesUsd - r.returnsUsd));
  assert.ok(near(r.withdrawalsUsd, 20));
  assert.ok(r.collectedUsd > 0);
  assert.ok(r.byClient.find((c) => c.name === "Al-Noor Market").profitUsd > 0);
  const f = ok(await admin("GET", "/reports/five"));
  assert.ok(f.sold.items > 0 && typeof f.prices.ok === "boolean");
  assert.ok(f.money.clientsOweUsd > 70);
  assert.ok(near(f.money.weOweUsd, 5), "what is still owed to suppliers");
});

await step("reports (2): production, cash flow, months, forecast, break-even, CSV", async () => {
  const pr = ok(await admin("GET", `/reports/production?from=${TODAY}&to=${TODAY}`));
  assert.ok(pr.rows.length >= 2);
  const cf = ok(await admin("GET", `/reports/cashflow?from=${TODAY}&to=${TODAY}`));
  assert.ok(cf.inUsd > 0 && cf.outUsd > 0);
  const months = ok(await admin("GET", "/reports/months?n=3"));
  assert.equal(months.rows.length, 3);
  const fc = ok(await admin("GET", "/costing/forecast"));
  assert.ok(Array.isArray(fc.products));
  const oh = ok(await admin("GET", `/costing/overheads?month=${TODAY.slice(0, 7)}`));
  assert.ok("breakEvenItems" in oh);
  for (const k of ["returns", "purchases", "supplier-debts", "client-debts", "withdrawals", "production"]) {
    const c = await admin("GET", `/reports/export/${k}.csv?from=${TODAY}&to=${TODAY}`);
    assert.equal(c.status, 200, k);
  }
  assert.equal((await manager("GET", `/reports/cashflow?from=${TODAY}&to=${TODAY}`)).status, 403);
});

await step("backup restore is queued for the next start and can be cancelled", async () => {
  const b = ok(await admin("POST", "/backups"), 201);
  ok(await admin("POST", "/backups/restore", { name: b.backup.name }));
  assert.equal(ok(await admin("GET", "/backups/restore")).pending, true);
  ok(await admin("POST", "/backups/restore/cancel"));
  assert.equal(ok(await admin("GET", "/backups/restore")).pending, false);
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll wholesale API checks passed.");
process.exitCode = failed ? 1 : 0;
