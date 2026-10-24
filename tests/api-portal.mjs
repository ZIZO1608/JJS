// Client portal — run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4396 node tests/api-portal.mjs
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
const manager = client();
const member = client();
const sara = client();
const other = client();
const S = {};

console.log("Client portal API test →", BASE);

await step("setup, demo data, a manager and a member", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's Kitchen", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Rami", username: "rami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "manager").id }), 201);
  ok(await admin("POST", "/users", { name: "Lina", username: "lina", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await manager("POST", "/auth/login", { username: "rami", password: "pass1234" }));
  ok(await member("POST", "/auth/login", { username: "lina", password: "pass1234" }));
  const c = ok(await admin("GET", "/menu/catalog"));
  S.p = Object.fromEntries(c.products.map((p) => [p.code, p]));
});

await step("admin creates a client → a login is generated and shown once", async () => {
  const r = ok(await admin("POST", "/clients", { type: "individual", name: "سارة أحمد", phone: "0944 123 456", creditLimitUsd: 100 }), 201);
  assert.ok(r.portal.username.length >= 3, "username");
  assert.match(r.portal.username, /^[a-z0-9.]+$/);
  assert.equal(r.portal.password.length, 8);
  S.sara = { id: r.row.id, ...r.portal };
  const acc = ok(await admin("GET", `/clients/${S.sara.id}/portal`)).account;
  assert.equal(acc.username, S.sara.username);
  assert.equal(acc.mustChangePassword, true);
  assert.equal(acc.password, undefined);
  // a client created without access has no login until asked for
  const o = ok(await admin("POST", "/clients", { type: "business", name: "Other Shop", portalAccess: false }), 201);
  assert.equal(o.portal, null);
  const made = ok(await admin("POST", `/clients/${o.row.id}/portal`), 201);
  S.other = { id: o.row.id, ...made.credentials };
  assert.equal((await admin("POST", `/clients/${o.row.id}/portal`)).status, 409);
});

await step("member cannot create client logins", async () => {
  assert.equal((await member("POST", `/clients/${S.sara.id}/portal/reset`)).status, 403);
});

await step("client logs in; wrong password refused", async () => {
  assert.equal((await sara("POST", "/portal/login", { username: S.sara.username, password: "nope" })).status, 401);
  const r = ok(await sara("POST", "/portal/login", { username: S.sara.username.toUpperCase(), password: S.sara.password }));
  assert.equal(r.client.clientId, S.sara.id);
  assert.equal(r.client.mustChangePassword, true);
  ok(await other("POST", "/portal/login", { username: S.other.username, password: S.other.password }));
});

await step("a client session cannot reach staff routes, staff cannot reach the portal", async () => {
  assert.equal((await sara("GET", "/orders")).status, 401);
  assert.equal((await sara("GET", "/clients")).status, 401);
  assert.equal((await sara("GET", "/auth/me")).status, 401);
  assert.equal((await sara("GET", "/notifications")).status, 401);
  assert.equal((await admin("GET", "/portal/home")).status, 401);
});

await step("client changes the first password", async () => {
  ok(await sara("PUT", "/portal/me/password", { current: S.sara.password, next: "mynewpass" }));
  S.sara.password = "mynewpass";
  assert.equal(ok(await sara("GET", "/portal/me")).client.mustChangePassword, false);
});

await step("home and menu show the client's data, never costs", async () => {
  const h = ok(await sara("GET", "/portal/home"));
  assert.ok(near(h.balanceUsd, 0));
  assert.equal(h.requests.length, 0);
  const m = ok(await sara("GET", "/portal/menu"));
  assert.ok(m.products.length > 0);
  const tc = m.products.find((p) => p.id === S.p.TC.id);
  assert.ok(tc && tc.price > 0);
  assert.equal(tc.extraCostUsd, undefined);
  assert.equal(tc.code, undefined);
});

await step("quote, then send a request: staff are notified, no stock or money moves", async () => {
  S.balanceBefore = ok(await admin("GET", `/clients/${S.sara.id}`)).client.balanceUsd;
  const q = ok(await sara("POST", "/portal/quote", { fulfilment: "pickup", lines: [{ productId: S.p.TC.id, qty: 2, optionIds: [] }] }));
  assert.ok(q.total > 0);
  assert.equal(q.costUsd, undefined);
  const before = ok(await admin("GET", "/notifications/unread-count")).unread;
  const r = ok(await sara("POST", "/portal/order-requests", { fulfilment: "pickup", paymentChoice: "on_account", note: "بدون بصل", lines: [{ productId: S.p.TC.id, qty: 2, optionIds: [] }] }), 201);
  S.req1 = r;
  assert.equal(r.number, 1);
  assert.equal(ok(await admin("GET", "/notifications/unread-count")).unread, before + 1);
  assert.ok(ok(await manager("GET", "/notifications")).rows.some((n) => n.kind === "order_request" && n.refId === r.id));
  // the member role cannot answer requests → not notified
  assert.equal(ok(await member("GET", "/notifications")).rows.length, 0);
  assert.equal(ok(await admin("GET", "/requests/counts")).orders, 1);
  const c = ok(await admin("GET", `/clients/${S.sara.id}`)).client;
  assert.ok(near(c.balanceUsd, S.balanceBefore));
  assert.equal(ok(await admin("GET", `/orders?clientId=${S.sara.id}`)).rows.length, 0);
});

await step("another client cannot read or cancel Sara's request", async () => {
  assert.equal((await other("GET", `/portal/order-requests/${S.req1.id}`)).status, 404);
  assert.equal((await other("POST", `/portal/order-requests/${S.req1.id}/cancel`)).status, 404);
  assert.equal(ok(await other("GET", "/portal/order-requests")).rows.length, 0);
});

await step("manager accepts: a real portal order on the client's account, client notified", async () => {
  const list = ok(await manager("GET", "/requests/orders?status=pending")).rows;
  assert.equal(list.length, 1);
  assert.equal(list[0].lines[0].qty, 2);
  const r = ok(await manager("POST", `/requests/orders/${S.req1.id}/accept`));
  S.order1 = r.orderId;
  const o = ok(await admin("GET", `/orders/${r.orderId}`)).order;
  assert.equal(o.source, "portal");
  assert.equal(o.paymentStatus, "credit");
  assert.equal(o.clientId, S.sara.id);
  const c = ok(await admin("GET", `/clients/${S.sara.id}`)).client;
  assert.ok(near(c.balanceUsd, S.balanceBefore - o.totalUsd));
  const n = ok(await sara("GET", "/portal/notifications"));
  assert.ok(n.rows.some((x) => x.kind === "order_accepted"));
  assert.equal(n.unread, 1);
  const d = ok(await sara("GET", `/portal/order-requests/${S.req1.id}`)).request;
  assert.equal(d.status, "accepted");
  assert.equal(d.order.number, o.number);
  assert.ok(d.lines.length === 1 && d.totals.total === o.total);
  // a request can only be answered once
  assert.equal((await admin("POST", `/requests/orders/${S.req1.id}/accept`)).status, 409);
  assert.equal((await sara("POST", `/portal/order-requests/${S.req1.id}/cancel`)).status, 409);
});

await step("client sees their own receipt only", async () => {
  const r = ok(await sara("GET", `/portal/orders/${S.order1}/receipt`)).receipt;
  assert.equal(r.order.costUsd, undefined);
  assert.equal((await other("GET", `/portal/orders/${S.order1}/receipt`)).status, 404);
});

await step("delivered → client notified", async () => {
  ok(await manager("POST", `/orders/${S.order1}/deliver`, {}));
  assert.ok(ok(await sara("GET", "/portal/notifications")).rows.some((x) => x.kind === "order_delivered"));
  ok(await sara("POST", "/portal/notifications/read", {}));
  assert.equal(ok(await sara("GET", "/portal/notifications/unread-count")).unread, 0);
});

await step("pay on delivery: noted on the order; decline with a reason; client cancels a waiting one", async () => {
  const a = ok(await sara("POST", "/portal/order-requests", { fulfilment: "delivery", paymentChoice: "on_delivery", lines: [{ productId: S.p.TC.id, qty: 1, optionIds: [] }] }), 201);
  const r = ok(await admin("POST", `/requests/orders/${a.id}/accept`));
  const o = ok(await admin("GET", `/orders/${r.orderId}`)).order;
  assert.match(o.note, /Pay on delivery/);
  assert.equal(o.fulfilment, "delivery");

  const b = ok(await sara("POST", "/portal/order-requests", { fulfilment: "pickup", paymentChoice: "on_account", lines: [{ productId: S.p.TC.id, qty: 3, optionIds: [] }] }), 201);
  assert.equal((await manager("POST", `/requests/orders/${b.id}/decline`, { reason: "x" })).status, 400);
  ok(await manager("POST", `/requests/orders/${b.id}/decline`, { reason: "Sold out today" }));
  const n = ok(await sara("GET", "/portal/notifications")).rows.find((x) => x.kind === "order_declined");
  assert.equal(n.bodyEn, "Sold out today");
  assert.equal(ok(await sara("GET", `/portal/order-requests/${b.id}`)).request.declineReason, "Sold out today");

  const c = ok(await sara("POST", "/portal/order-requests", { fulfilment: "pickup", paymentChoice: "on_account", lines: [{ productId: S.p.TC.id, qty: 1, optionIds: [] }] }), 201);
  ok(await sara("POST", `/portal/order-requests/${c.id}/cancel`));
  assert.equal((await admin("POST", `/requests/orders/${c.id}/accept`)).status, 409);
});

await step("member cannot accept or decline", async () => {
  const a = ok(await sara("POST", "/portal/order-requests", { fulfilment: "pickup", paymentChoice: "on_account", lines: [{ productId: S.p.TC.id, qty: 1, optionIds: [] }] }), 201);
  assert.equal((await member("POST", `/requests/orders/${a.id}/accept`)).status, 403);
  assert.equal((await member("POST", `/requests/orders/${a.id}/decline`, { reason: "nope" })).status, 403);
  ok(await admin("POST", `/requests/orders/${a.id}/decline`, { reason: "Test cleanup" }));
});

await step("staff cancel of a portal order → client notified", async () => {
  const a = ok(await sara("POST", "/portal/order-requests", { fulfilment: "pickup", paymentChoice: "on_account", lines: [{ productId: S.p.TC.id, qty: 1, optionIds: [] }] }), 201);
  const r = ok(await admin("POST", `/requests/orders/${a.id}/accept`));
  ok(await admin("POST", `/orders/${r.orderId}/cancel`, { reason: "Kitchen closed" }));
  assert.ok(ok(await sara("GET", "/portal/notifications")).rows.some((x) => x.kind === "order_cancelled" && x.bodyEn === "Kitchen closed"));
});

await step("subscription: request → accept → active and charged", async () => {
  const plan = ok(await admin("POST", "/clients/plans", { nameAr: "باقة الشهر", nameEn: "Monthly", monthlyFee: 30, currency: "USD", discountPct: 10, includedItems: 4 }), 201);
  S.plan = plan.row ?? plan;
  const s = ok(await sara("GET", "/portal/subscription"));
  assert.equal(s.current, null);
  assert.ok(s.plans.some((p) => p.id === S.plan.id));
  const before = ok(await admin("GET", `/clients/${S.sara.id}`)).client.balanceUsd;
  const r = ok(await sara("POST", "/portal/subscription-requests", { planId: S.plan.id }), 201);
  assert.equal((await sara("POST", "/portal/subscription-requests", { planId: S.plan.id })).status, 409);
  assert.ok(ok(await admin("GET", "/notifications")).rows.some((n) => n.kind === "sub_request"));
  assert.equal(ok(await admin("GET", "/requests/subscriptions")).rows.length, 1);
  assert.equal((await member("POST", `/requests/subscriptions/${r.id}/accept`)).status, 403);
  ok(await manager("POST", `/requests/subscriptions/${r.id}/accept`));
  const after = ok(await admin("GET", `/clients/${S.sara.id}`)).client;
  assert.ok(near(after.balanceUsd, before - 30));
  const s2 = ok(await sara("GET", "/portal/subscription"));
  assert.equal(s2.current.nameEn, "Monthly");
  assert.equal(s2.current.availableIncluded, 4);
  assert.ok(ok(await sara("GET", "/portal/notifications")).rows.some((x) => x.kind === "sub_accepted"));
  assert.equal(ok(await sara("GET", "/portal/home")).subscription.includedItems, 4);
});

await step("reset password signs the client out; disabled account cannot log in", async () => {
  const r = ok(await admin("POST", `/clients/${S.sara.id}/portal/reset`));
  assert.equal((await sara("GET", "/portal/me")).status, 401);
  assert.equal((await sara("POST", "/portal/login", { username: S.sara.username, password: "mynewpass" })).status, 401);
  ok(await sara("POST", "/portal/login", { username: r.credentials.username, password: r.credentials.password }));
  ok(await admin("PUT", `/clients/${S.sara.id}/portal`, { active: false }));
  assert.equal((await sara("GET", "/portal/me")).status, 401);
  assert.equal((await sara("POST", "/portal/login", { username: r.credentials.username, password: r.credentials.password })).status, 403);
  ok(await admin("PUT", `/clients/${S.sara.id}/portal`, { active: true }));
  ok(await sara("POST", "/portal/login", { username: r.credentials.username, password: r.credentials.password }));
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll portal steps passed");
process.exit(failed ? 1 : 0);
