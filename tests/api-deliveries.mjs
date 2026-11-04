// Discounts as % or amount, delivering with the money question, who delivers on the portal, client reports,
// the day's story, suppliers paid in either currency, and the rate API settings.
// Run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4399 node tests/api-deliveries.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";
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
const sara = client();
const other = client();
const S = {};
const p2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const line = (qty = 5) => [{ productId: S.p.TC.id, qty, optionIds: [] }];
const balance = async () => ok(await admin("GET", `/clients/${S.sara.id}`)).client.balanceUsd;
const boxBalance = async (id) => ok(await admin("GET", "/money/boxes")).rows.find((b) => b.id === id).balance;
const newCreditOrder = async (extra = {}) => ok(await manager("POST", "/orders", { clientId: S.sara.id, type: "normal", fulfilment: "delivery", methodId: S.m.credit.id, lines: line(), ...extra }), 201);

console.log("Deliveries, discounts and reports API test →", BASE);

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  ok(await admin("PUT", "/fx/manual", { rate: 14000 }));
  S.p = Object.fromEntries(ok(await admin("GET", "/menu/catalog")).products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.main = ok(await admin("GET", "/money/boxes")).rows.find((b) => b.systemKey === "main_cash");
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Rami", username: "rami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "manager").id }), 201);
  ok(await admin("POST", "/users", { name: "Lina", username: "lina", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await manager("POST", "/auth/login", { username: "rami", password: "pass1234" }));
  ok(await member("POST", "/auth/login", { username: "lina", password: "pass1234" }));
  const r = ok(await admin("POST", "/clients", { type: "individual", name: "Sara", phone: "0944123456", address: "Mazzeh", creditLimitUsd: 0 }), 201);
  S.sara = { id: r.row.id, ...r.portal };
  ok(await sara("POST", "/portal/login", { username: S.sara.username, password: S.sara.password }));
  ok(await sara("PUT", "/portal/me/password", { current: S.sara.password, next: "mynewpass" }));
  const o = ok(await admin("POST", "/clients", { type: "individual", name: "Other" }), 201);
  S.other = { id: o.row.id, ...o.portal };
  ok(await other("POST", "/portal/login", { username: S.other.username, password: S.other.password }));
  ok(await other("PUT", "/portal/me/password", { current: S.other.password, next: "mynewpass" }));
});

/* ---------- 1) discounts ---------- */
await step("a manual discount can be a percentage or an amount, and never goes past the price", async () => {
  const plain = ok(await manager("POST", "/orders/quote", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", methodId: S.m.credit.id, lines: line() }));
  S.subtotal = plain.subtotal;
  const pct = ok(await manager("POST", "/orders/quote", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", lines: line(), manualDiscountPct: 10 }));
  assert.ok(near(pct.discount, plain.subtotal * 0.1));
  assert.match(pct.discountReason, /manual:10%/);
  const amount = ok(await manager("POST", "/orders/quote", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", lines: line(), manualDiscountAmount: 2 }));
  assert.ok(near(amount.discount, 2));
  assert.match(amount.discountReason, /manual:2 USD/);
  assert.ok(near(amount.total, plain.total - 2, 0.5));
  const huge = ok(await manager("POST", "/orders/quote", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", lines: line(), manualDiscountAmount: 100000 }));
  assert.ok(near(huge.discount, plain.subtotal), "capped at the price");
  assert.ok(huge.total >= 0);
  assert.equal((await manager("POST", "/orders/quote", { clientId: S.sara.id, lines: line(), manualDiscountAmount: -1 })).status, 400);
  assert.equal((await manager("POST", "/orders/quote", { clientId: S.sara.id, lines: line(), manualDiscountPct: 101 })).status, 400);
});

await step("a member cannot give an amount discount either", async () => {
  const r = await member("POST", "/orders", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", methodId: S.m.cash.id, lines: line(), manualDiscountAmount: 1 });
  assert.equal(r.status, 403);
});

await step("client tiers and subscription plans take an amount, in dollars or pounds", async () => {
  const tier = ok(await admin("POST", "/clients/tiers", { nameAr: "ثابت", nameEn: "Flat", discountPct: 0, discountAmount: 28000, discountCurrency: "SYP", sort: 9 }), 201).row;
  S.tier = tier;
  assert.equal(tier.discountAmount, 28000);
  ok(await admin("PUT", `/clients/${S.other.id}`, { ...ok(await admin("GET", `/clients/${S.other.id}`)).client, tierId: tier.id }));
  const q = ok(await other("POST", "/portal/quote", { fulfilment: "pickup", lines: line() }));
  assert.ok(near(q.discount, 2), `28,000 SYP at 14,000 is $2, got ${q.discount}`);
  const plan = ok(await admin("POST", "/clients/plans", { nameAr: "باقة", nameEn: "Plan", monthlyFee: 10, currency: "USD", discountAmount: 3, includedItems: 0 }), 201).row;
  assert.equal(plan.discountAmount, 3);
  const list = ok(await other("GET", "/portal/subscription")).plans.find((p) => p.id === plan.id);
  assert.equal(list.discountAmount, 3, "the portal shows the amount");
});

await step("the best discount wins by what it is worth, percentage against amount", async () => {
  // the tier takes $2 off: a 1% manual discount is worth less, a 90% one more
  const small = ok(await manager("POST", "/orders/quote", { clientId: S.other.id, type: "normal", fulfilment: "pickup", lines: line(), manualDiscountPct: 1 }));
  assert.match(small.discountReason, /tier:/);
  const big = ok(await manager("POST", "/orders/quote", { clientId: S.other.id, type: "normal", fulfilment: "pickup", lines: line(), manualDiscountPct: 90 }));
  assert.match(big.discountReason, /manual:90%/);
});

await step("a staff discount can be an amount", async () => {
  const e = ok(await admin("POST", "/people/employees", { payModel: "fixed", name: "Staff", currency: "USD", staffDiscountPct: 0, staffDiscountAmount: 1.5 }), 201).row;
  const q = ok(await admin("POST", "/orders/quote", { type: "staff", employeeId: e.id, fulfilment: "pickup", lines: line() }));
  assert.ok(near(q.discount, 1.5));
});

/* ---------- 6) who delivers ---------- */
await step("delivery people: only an active rep can be assigned, by manager or admin, not by a member", async () => {
  S.rep = ok(await admin("POST", "/people/employees", { payModel: "fixed", name: "Abu Ali", phone: "0933000111", currency: "USD", isDeliveryRep: true }), 201).row;
  S.notRep = ok(await admin("POST", "/people/employees", { payModel: "fixed", name: "Cook", currency: "USD" }), 201).row;
  const o = await newCreditOrder();
  S.o1 = o;
  assert.equal((await manager("POST", `/orders/${o.id}/assign`, { assignedTo: S.notRep.id })).status, 400);
  assert.equal((await member("POST", `/orders/${o.id}/assign`, { assignedTo: S.rep.id })).status, 403);
  ok(await manager("POST", `/orders/${o.id}/assign`, { assignedTo: S.rep.id }));
  const reps = ok(await manager("GET", "/money/reps")).rows;
  assert.equal(reps.find((r) => r.id === S.rep.id).phone, "0933000111");
  const pickup = ok(await manager("POST", "/orders", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", methodId: S.m.credit.id, lines: line() }), 201);
  assert.equal((await manager("POST", `/orders/${pickup.id}/assign`, { assignedTo: S.rep.id })).status, 400, "a pickup has nobody delivering it");
  S.pickup = pickup;
});

await step("a portal client sees who delivers and the phone, and is told when it is assigned", async () => {
  const r = ok(await sara("POST", "/portal/order-requests", { fulfilment: "delivery", paymentChoice: "on_delivery", note: "", lines: line() }), 201);
  S.req = r;
  assert.equal(ok(await sara("GET", `/portal/order-requests/${r.id}`)).request.delivery, null, "nobody yet");
  S.reqOrder = ok(await manager("POST", `/requests/orders/${r.id}/accept`));
  ok(await manager("POST", `/orders/${S.reqOrder.orderId}/assign`, { assignedTo: S.rep.id }));
  const detail = ok(await sara("GET", `/portal/order-requests/${r.id}`)).request;
  assert.deepEqual(detail.delivery, { name: "Abu Ali", phone: "0933000111" });
  assert.ok(ok(await sara("GET", "/portal/notifications")).rows.some((n) => n.kind === "order_assigned" && n.bodyEn.includes("0933000111")));
  // assigning the same person again tells nobody twice
  const before = ok(await sara("GET", "/portal/notifications")).rows.length;
  ok(await manager("POST", `/orders/${S.reqOrder.orderId}/assign`, { assignedTo: S.rep.id }));
  assert.equal(ok(await sara("GET", "/portal/notifications")).rows.length, before);
});

/* ---------- 7) the deliveries list has no costs ---------- */
await step("the deliveries list shows open orders with what to collect, without any cost, and members are out", async () => {
  const { rows } = ok(await manager("GET", "/orders/deliveries"));
  const row = rows.find((o) => o.id === S.o1.id);
  assert.ok(row, "the order is listed");
  assert.equal(row.clientPhone, "0944123456");
  assert.equal(row.clientAddress, "Mazzeh");
  assert.equal(row.assignedName, "Abu Ali");
  assert.ok(row.remaining > 0);
  assert.ok(row.lines.length > 0);
  assert.equal(row.costUsd, undefined);
  assert.equal(JSON.stringify(rows).includes("cost"), false);
  assert.equal((await member("GET", "/orders/deliveries")).status, 403);
});

await step("a linked manager is told which employee they are, so they can see only their own", async () => {
  const me = ok(await manager("GET", "/auth/me"));
  const id = me.user?.id ?? me.id;
  const linked = ok(await admin("POST", "/people/employees", { payModel: "fixed", name: "Rami the driver", userId: id, currency: "USD", isDeliveryRep: true }), 201).row;
  assert.equal(ok(await manager("GET", "/orders/deliveries")).myEmployeeId, linked.id);
  assert.equal(ok(await admin("GET", "/orders/deliveries")).myEmployeeId, null);
});

/* ---------- 4) delivering and the money ---------- */
await step("paid nothing: stays on the account, shows in the cloud, and the bell says so", async () => {
  const beforeBalance = await balance();
  const cloudBefore = ok(await admin("GET", "/reports/my-money")).clientsOweUsd;
  const unread = ok(await admin("GET", "/notifications/unread-count")).unread;
  const r = ok(await manager("POST", `/orders/${S.o1.id}/deliver`, { collection: { mode: "none" } }));
  assert.equal(r.collected, 0);
  assert.ok(r.stillOwed > 0);
  assert.ok(near(await balance(), beforeBalance), "nothing moved: the debt was already there");
  assert.ok(near(ok(await admin("GET", "/reports/my-money")).clientsOweUsd, cloudBefore));
  assert.equal(ok(await admin("GET", "/notifications/unread-count")).unread, unread + 1);
  const n = ok(await admin("GET", "/notifications")).rows.find((x) => x.kind === "delivery_unpaid" && x.refId === S.o1.id);
  assert.ok(n, "notification");
  assert.match(n.titleEn, /Sara did not pay/);
  assert.equal(n.link, `/clients/${S.sara.id}`);
  const order = ok(await admin("GET", `/orders/${S.o1.id}`)).order;
  assert.equal(order.status, "delivered");
  assert.equal(order.paymentStatus, "credit");
  assert.ok(order.deliveredAt);
  assert.ok(ok(await admin("GET", "/reports/my-money/details/clients")).rows.some((x) => x.who === "Sara" && x.number === order.number));
});

await step("delivering twice is refused, so money can never be taken twice", async () => {
  const r = await manager("POST", `/orders/${S.o1.id}/deliver`, { collection: { mode: "full", methodId: S.m.cash.id } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "already_delivered");
});

await step("paid everything: the money lands in the box, the debt clears, no notification", async () => {
  const o = await newCreditOrder({ fulfilment: "pickup" });
  const before = await balance();
  const box = await boxBalance(S.main.id);
  const n = ok(await admin("GET", "/notifications")).rows.filter((x) => x.kind === "delivery_unpaid").length;
  const r = ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: S.m.cash.id } }));
  assert.equal(r.stillOwed, 0);
  const order = ok(await admin("GET", `/orders/${o.id}`)).order;
  assert.equal(order.paymentStatus, "paid");
  assert.ok(near(order.paidAmount, order.total));
  assert.ok(near(await balance(), before + order.totalUsd), "the debt is gone");
  assert.ok(near(await boxBalance(S.main.id), box + order.total), "the cash arrived");
  assert.equal(ok(await admin("GET", "/notifications")).rows.filter((x) => x.kind === "delivery_unpaid").length, n);
  S.paidOrder = order;
});

await step("paid part: what came in is recorded, the rest stays owed, and the bell says part", async () => {
  const o = await newCreditOrder({ fulfilment: "pickup" });
  const before = await balance();
  const r = ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "part", amount: 1, currency: "USD", methodId: S.m.cash.id } }));
  assert.ok(near(r.collected, 1));
  assert.ok(r.stillOwed > 0);
  const order = ok(await admin("GET", `/orders/${o.id}`)).order;
  assert.equal(order.paymentStatus, "partial");
  assert.ok(near(order.paidAmount, 1));
  assert.ok(near(await balance(), before + 1));
  assert.ok(ok(await admin("GET", "/notifications")).rows.some((x) => x.kind === "delivery_unpaid" && x.refId === o.id && /only part/.test(x.titleEn)));
  const rec = ok(await admin("GET", `/orders/${o.id}/receipt`)).receipt;
  assert.ok(near(rec.payment.paid, 1));
  assert.ok(near(rec.payment.remaining, order.total - 1));
  S.partOrder = order;
});

await step("paying in pounds for a dollar order converts at the rate, and the box stays right", async () => {
  const o = await newCreditOrder({ fulfilment: "pickup" });
  const before = await balance();
  ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "part", amount: 14000, currency: "SYP", methodId: S.m.cash.id } }));
  const order = ok(await admin("GET", `/orders/${o.id}`)).order;
  assert.ok(near(order.paidAmount, 1), `14,000 SYP at 14,000 is $1, got ${order.paidAmount}`);
  assert.ok(near(await balance(), before + 1));
  const full = await newCreditOrder({ fulfilment: "pickup" });
  const beforeFull = await balance();
  ok(await manager("POST", `/orders/${full.id}/deliver`, { collection: { mode: "full", currency: "SYP", methodId: S.m.cash.id } }));
  const paid = ok(await admin("GET", `/orders/${full.id}`)).order;
  assert.equal(paid.paymentStatus, "paid");
  assert.ok(near(await balance(), beforeFull + paid.totalUsd));
});

await step("bad money answers are refused and change nothing", async () => {
  const o = await newCreditOrder({ fulfilment: "pickup" });
  const before = await balance();
  const too = await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "part", amount: 999999, currency: "USD", methodId: S.m.cash.id } });
  assert.equal(too.status, 400);
  assert.equal(too.json.error, "collected_too_much");
  assert.equal((await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "part", methodId: S.m.cash.id } })).status, 400);
  assert.equal((await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full" } })).status, 400);
  assert.equal((await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: S.m.credit.id } })).status, 400);
  assert.equal(ok(await admin("GET", `/orders/${o.id}`)).order.status, "confirmed");
  assert.ok(near(await balance(), before));
  S.spare = o;
});

await step("an already paid order just gets ticked: nothing more is collected", async () => {
  const o = ok(await manager("POST", "/orders", { clientId: S.sara.id, type: "normal", fulfilment: "pickup", methodId: S.m.cash.id, lines: line() }), 201);
  const box = await boxBalance(S.main.id);
  const r = ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: S.m.cash.id } }));
  assert.equal(r.collected, 0);
  assert.ok(near(await boxBalance(S.main.id), box));
});

await step("cash a delivery person collects stays in their box until handed over", async () => {
  const boxes = ok(await admin("GET", "/money/boxes")).rows;
  const repBox = boxes.find((b) => b.employeeId === S.rep.id);
  assert.ok(repBox, "the rep has a box");
  const o = await newCreditOrder({ assignedTo: S.rep.id });
  const main = await boxBalance(S.main.id);
  const held = await boxBalance(repBox.id);
  ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: S.m.cash.id } }));
  const order = ok(await admin("GET", `/orders/${o.id}`)).order;
  assert.ok(near(await boxBalance(repBox.id), held + order.total));
  assert.ok(near(await boxBalance(S.main.id), main));
});

await step("cancelling after a part payment puts the money and the account back exactly", async () => {
  const o = await newCreditOrder({ fulfilment: "pickup" });
  const before = await balance();
  const box = await boxBalance(S.main.id);
  ok(await manager("POST", `/orders/${o.id}/deliver`, { collection: { mode: "part", amount: 1, currency: "USD", methodId: S.m.cash.id } }));
  ok(await manager("POST", `/orders/${o.id}/cancel`, { reason: "test" }));
  const order = ok(await admin("GET", `/orders/${o.id}`)).order;
  assert.ok(near(await balance(), before + order.totalUsd), "the whole charge is undone");
  assert.ok(near(await boxBalance(S.main.id), box), "the dollar left the box");
});

await step("money by method still adds up to what was collected", async () => {
  const r = ok(await admin("GET", `/reports/range?from=${TODAY}&to=${TODAY}`));
  assert.ok(near(r.byMethod.reduce((s, m) => s + m.usd, 0), r.collectedUsd, 0.05), `${r.byMethod.reduce((s, m) => s + m.usd, 0)} vs ${r.collectedUsd}`);
});

await step("marking delivered without saying anything still flags the debt", async () => {
  ok(await manager("POST", `/orders/${S.spare.id}/deliver`, {}));
  assert.ok(ok(await admin("GET", "/notifications")).rows.some((x) => x.kind === "delivery_unpaid" && x.refId === S.spare.id));
});

/* ---------- 3) client reports ---------- */
await step("a client reports a problem on their order and every manager's bell rings", async () => {
  const unread = ok(await manager("GET", "/notifications/unread-count")).unread;
  const r = ok(await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "late", message: "The order did not arrive yet" }), 201);
  S.report = r;
  assert.equal(ok(await manager("GET", "/notifications/unread-count")).unread, unread + 1);
  const n = ok(await manager("GET", "/notifications")).rows.find((x) => x.kind === "order_report");
  assert.match(n.titleEn, /Report from Sara/);
  assert.equal(n.link, `/requests?tab=reports&id=${r.id}`);
  assert.equal(ok(await member("GET", "/notifications")).rows.filter((x) => x.kind === "order_report").length, 0);
  assert.equal(ok(await admin("GET", "/requests/counts")).reports, 1);
  const list = ok(await manager("GET", "/requests/reports")).rows;
  assert.equal(list.length, 1);
  assert.equal(list[0].clientName, "Sara");
  assert.equal(list[0].category, "late");
  assert.equal(ok(await sara("GET", `/portal/order-requests/${S.req.id}`)).request.reports.length, 1);
});

await step("reports stay private and sane: other clients, bad input, members and floods are refused", async () => {
  assert.equal((await other("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "late", message: "not my order" })).status, 404);
  assert.equal((await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "nonsense", message: "hello there" })).status, 400);
  assert.equal((await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "late", message: "x" })).status, 400);
  assert.equal((await member("GET", "/requests/reports")).status, 403);
  assert.equal((await member("POST", `/requests/reports/${S.report.id}/resolve`, {})).status, 403);
  assert.equal((await admin("GET", "/portal/home")).status, 401);
  ok(await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "other", message: "second one" }), 201);
  ok(await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "other", message: "third one" }), 201);
  const flood = await sara("POST", `/portal/order-requests/${S.req.id}/reports`, { category: "other", message: "fourth one" });
  assert.equal(flood.status, 409);
  assert.equal(flood.json.error, "too_many_reports");
});

await step("staff answer a report: the client sees the answer and is told", async () => {
  ok(await manager("POST", `/requests/reports/${S.report.id}/resolve`, { reply: "Sorry, it is on the way" }));
  const rep = ok(await sara("GET", `/portal/order-requests/${S.req.id}`)).request.reports.find((x) => x.id === S.report.id);
  assert.equal(rep.status, "resolved");
  assert.equal(rep.reply, "Sorry, it is on the way");
  assert.ok(ok(await sara("GET", "/portal/notifications")).rows.some((n) => n.kind === "report_answered" && n.bodyEn.includes("on the way")));
  assert.equal((await manager("POST", `/requests/reports/${S.report.id}/resolve`, {})).status, 409);
  assert.equal(ok(await admin("GET", "/requests/counts")).reports, 2);
});

/* ---------- 5) the day's story ---------- */
await step("the close screen tells the day's story, and a blind count stays blind", async () => {
  const pending = await newCreditOrder({ fulfilment: "delivery" });
  const adminDay = ok(await admin("GET", `/days/${TODAY}`));
  const h = adminDay.highlights;
  assert.ok(h.deliveries.total >= h.deliveries.done);
  assert.ok(h.notDelivered.some((o) => o.orderId === pending.id));
  assert.ok(h.unpaid.some((o) => o.orderId === S.o1.id && o.remaining > 0), "who did not pay");
  assert.ok(h.unpaidUsd > 0);
  assert.equal(h.openReports, 2);
  assert.ok(h.rate > 0);
  assert.ok(typeof h.previous.salesUsd === "number");
  const mgrDay = ok(await manager("GET", `/days/${TODAY}`));
  assert.ok(mgrDay.highlights, "the manager sees the story");
  assert.equal(mgrDay.mainBox.expected, null, "but not the expected cash");
  assert.equal(JSON.stringify(mgrDay.highlights).toLowerCase().includes("expected"), false);
  assert.equal(JSON.stringify(mgrDay.highlights).toLowerCase().includes("cost"), false);
});

/* ---------- 8) suppliers in dollars or pounds ---------- */
await step("a supplier can be paid in dollars or pounds, and one invoice too", async () => {
  ok(await admin("POST", "/money/deposit", { boxId: S.main.id, amount: 1000, note: "for suppliers" }), 201);
  const sup = ok(await admin("POST", "/purchases/suppliers", { name: "Dollar Foods", openingBalance: 100, openingCurrency: "USD" }), 201).row;
  S.sup = sup;
  const due = (async () => ok(await admin("GET", "/purchases/debts")).rows.find((r) => r.id === sup.id)?.totalDueUsd ?? 0);
  assert.ok(near(await due(), 100));
  ok(await admin("POST", `/purchases/suppliers/${sup.id}/pay`, { amount: 10, currency: "USD", boxId: S.main.id }));
  assert.ok(near(await due(), 90), "ten dollars");
  ok(await admin("POST", `/purchases/suppliers/${sup.id}/pay`, { amount: 140000, currency: "SYP", boxId: S.main.id }));
  assert.ok(near(await due(), 80), "140,000 pounds is ten dollars");
  assert.equal((await admin("POST", `/purchases/suppliers/${sup.id}/pay`, { amount: 9999999, currency: "SYP", boxId: S.main.id })).status, 400);
  const items = ok(await admin("GET", "/stock/items")).rows.filter((i) => i.kind === "ingredient");
  const loc = ok(await admin("GET", "/stock/locations")).rows[0];
  const buy = ok(await admin("POST", "/purchases", { supplierId: sup.id, currency: "USD", lines: [{ itemId: items[0].id, qty: 1, unitPrice: 20, locationId: loc.id }] }), 201).purchase;
  ok(await admin("POST", `/purchases/${buy.id}/pay`, { amount: 140000, currency: "SYP", boxId: S.main.id }));
  const after = ok(await admin("GET", `/purchases/${buy.id}`)).purchase ?? ok(await admin("GET", `/purchases/${buy.id}`));
  assert.ok(near(after.paid, 10), `140,000 pounds is $10 off the invoice, got ${after.paid}`);
  assert.equal((await admin("POST", `/purchases/${buy.id}/pay`, { amount: 9999999, currency: "SYP", boxId: S.main.id })).status, 400);
  ok(await admin("POST", `/purchases/${buy.id}/pay`, { amount: 10, boxId: S.main.id }));
  const done = ok(await admin("GET", `/purchases/${buy.id}`)).purchase ?? ok(await admin("GET", `/purchases/${buy.id}`));
  assert.ok(near(done.paid, 20), "and paying without a currency still means the invoice's own");
});

/* ---------- 9 + 10) the cloud and the rate API ---------- */
await step("the cloud still adds up, with both sides available", async () => {
  const m = ok(await admin("GET", "/reports/my-money"));
  assert.ok(m.clientsOweUsd > 0, "to get from clients");
  assert.ok(m.weOweUsd > 0, "to give to suppliers");
  assert.ok(near(m.totalUsd, m.cashUsd + m.clientsOweUsd + m.goodsAtShopsUsd - m.weOweUsd - m.dueExpensesUsd, 0.05));
  assert.equal((await manager("GET", "/reports/my-money")).status, 403);
});

await step("the rate API comes set up for the Syrian service, and its key never leaves the server", async () => {
  const cfg = ok(await admin("GET", "/fx/config"));
  assert.match(cfg.apiUrl, /exchange-rates/);
  assert.equal(cfg.jsonPath, "rates.sell");
  assert.equal(cfg.apiKey, undefined);
  ok(await admin("PUT", "/fx/config", { apiUrl: "http://127.0.0.1:9/nothing", jsonPath: "rates.sell", apiKey: "sk_test_secret" }));
  const after = ok(await admin("GET", "/fx/config"));
  assert.equal(after.hasApiKey, true);
  assert.equal(JSON.stringify(after).includes("sk_test_secret"), false);
  const audit = await admin("GET", "/audit?entity=settings.fx.config");
  assert.equal(JSON.stringify(audit.json).includes("sk_test_secret"), false, "the audit log never holds the key");
  assert.ok(ok(await admin("GET", "/fx/current")).lastError, "a dead API is reported");
  assert.equal(ok(await admin("GET", "/fx/current")).rate, 14000, "and the shop keeps working on the last rate");
});

await step("the dashboard is gone from the role names", async () => {
  const perms = JSON.stringify(ok(await admin("GET", "/roles")));
  assert.equal(perms.includes("لوحة التحكم"), false);
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll deliveries, discount and report steps passed");
process.exit(failed ? 1 : 0);
