// Drop points, the public menu page and client invoice designs — run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4395 node tests/api-drop-menu.mjs
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
const visitor = client(); // nobody logged in
const S = {};

console.log("Drop points, public menu & invoice design API test →", BASE);

const newClient = (name, extra) => ({ type: "business", name, receiptLanguage: "en", portalAccess: false, ...extra });

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's Kitchen", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  const c = ok(await admin("GET", "/menu/catalog"));
  S.p = Object.fromEntries(c.products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  // make sure there is stock to leave at the stands
  ok(await admin("POST", "/production", { lines: [{ productId: S.p.TC.id, qty: 40 }] }), 201);
});

await step("drop point: a % share is kept, the shop is marked consignment", async () => {
  const r = ok(await admin("POST", "/clients", newClient("Gym Fridge", { dropPoint: true, dropCutType: "pct", dropCutValue: 20, dropMoney: "cash" })), 201);
  assert.equal(r.row.dropPoint, true);
  assert.equal(r.row.consignment, true, "a drop point settles like consignment");
  S.gym = r.row;
  // the selling price at this point
  ok(await admin("PUT", `/clients/${S.gym.id}/prices`, { prices: [{ productId: S.p.TC.id, price: 3, currency: "USD" }] }));
  const bad = await admin("POST", "/clients", newClient("Too greedy", { dropPoint: true, dropCutType: "pct", dropCutValue: 150 }));
  assert.equal(bad.status, 400, "a share above 100% is refused");
});

await step("leave 10 at the gym: the overview shows them there", async () => {
  const r = ok(await admin("POST", "/consignments", { clientId: S.gym.id, lines: [{ productId: S.p.TC.id, qty: 10 }] }), 201);
  assert.equal(r.consignment.lines[0].unitPrice, 3, "sold at the drop point's own price");
  assert.equal(r.consignment.drop.cutType, "pct");
  assert.equal(r.consignment.drop.money, "cash");
  S.gymCons = r.consignment;
  const dp = ok(await admin("GET", "/drop-points")).rows.find((x) => x.id === S.gym.id);
  assert.equal(dp.piecesThere, 10);
  assert.equal(dp.open.length, 1);
});

await step("count & settle: 8 sold × $3 = $24, the gym keeps 20% ($4.80), we collect $19.20 cash", async () => {
  const st = ok(await admin("POST", `/consignments/${S.gymCons.id}/settle`, { lines: [{ productId: S.p.TC.id, returnedQty: 2, action: "waste" }], methodId: S.m.cash.id }));
  assert.equal(st.soldQty, 8);
  assert.ok(near(st.soldValue, 24) && near(st.cut, 4.8) && near(st.ourShare, 19.2));
  const o = ok(await admin("GET", `/orders/${st.orderId}`)).order;
  assert.ok(near(o.subtotal, 24));
  assert.ok(near(o.discount, 4.8));
  assert.ok(o.discountReason.startsWith("drop_cut:"), o.discountReason);
  assert.ok(near(o.total, 19.2));
  assert.equal(o.paymentStatus, "paid");
  const dp = ok(await admin("GET", "/drop-points")).rows.find((x) => x.id === S.gym.id);
  assert.equal(dp.piecesThere, 0);
  assert.equal(dp.month.pieces, 8);
  assert.ok(near(dp.month.salesUsd, 24) && near(dp.month.cutUsd, 4.8) && near(dp.month.oursUsd, 19.2));
  assert.ok(dp.lastVisit);
});

await step("per-piece share on account: 4 sold, $0.50 each to the place, the rest on their balance", async () => {
  const c = ok(await admin("POST", "/clients", newClient("Uni Stand", { dropPoint: true, dropCutType: "piece", dropCutValue: 0.5, dropCutCurrency: "USD", dropMoney: "balance" })), 201).row;
  ok(await admin("PUT", `/clients/${c.id}/prices`, { prices: [{ productId: S.p.TC.id, price: 2.5, currency: "USD" }] }));
  const r = ok(await admin("POST", "/consignments", { clientId: c.id, lines: [{ productId: S.p.TC.id, qty: 5 }] }), 201);
  assert.equal(r.consignment.drop.cutPerPiece, 0.5);
  const st = ok(await admin("POST", `/consignments/${r.consignment.id}/settle`, { lines: [{ productId: S.p.TC.id, returnedQty: 1, action: "restock" }] }));
  assert.ok(near(st.soldValue, 10) && near(st.cut, 2) && near(st.ourShare, 8));
  const o = ok(await admin("GET", `/orders/${st.orderId}`)).order;
  assert.equal(o.paymentStatus, "credit");
  const after = ok(await admin("GET", `/clients/${c.id}`)).client;
  assert.ok(near(after.balanceUsd, -8));
});

await step("rent: nothing is taken off at settlement", async () => {
  const c = ok(await admin("POST", "/clients", newClient("Mall Kiosk", { dropPoint: true, dropCutType: "rent", dropCutValue: 100, dropMoney: "cash" })), 201).row;
  ok(await admin("PUT", `/clients/${c.id}/prices`, { prices: [{ productId: S.p.TC.id, price: 3, currency: "USD" }] }));
  const r = ok(await admin("POST", "/consignments", { clientId: c.id, lines: [{ productId: S.p.TC.id, qty: 3 }] }), 201);
  const st = ok(await admin("POST", `/consignments/${r.consignment.id}/settle`, { lines: [], methodId: S.m.cash.id }));
  assert.equal(st.cut, 0);
  assert.ok(near(st.ourShare, 9));
});

await step("an ordinary consignment shop keeps working as before (no share taken)", async () => {
  const shop = ok(await admin("GET", "/clients")).rows.find((x) => x.name === "Al-Noor Market");
  const r = ok(await admin("POST", "/consignments", { clientId: shop.id, lines: [{ productId: S.p.TC.id, qty: 5 }] }), 201);
  assert.equal(r.consignment.drop, null);
  const st = ok(await admin("POST", `/consignments/${r.consignment.id}/settle`, { lines: [] }));
  assert.equal(st.cut, 0);
  assert.ok(!ok(await admin("GET", "/drop-points")).rows.some((x) => x.id === shop.id));
});

await step("public menu: closed until the admin switches it on", async () => {
  const r = await visitor("GET", "/public/menu");
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "menu_off");
});

await step("public menu: only products switched on, no costs, prices follow the setting", async () => {
  const cfg = ok(await admin("GET", "/system/public-menu"));
  ok(await admin("PUT", "/system/public-menu", { ...cfg, enabled: true, showPrices: true, whatsapp: "+963 944 000 111", instagram: "https://instagram.com/jjs" }));
  assert.equal(ok(await admin("GET", "/system/public-menu")).whatsapp, "963944000111", "number kept as digits only");
  ok(await admin("PUT", `/menu/products/${S.p.TC.id}/public`, { show: true }));
  const m = ok(await visitor("GET", "/public/menu"));
  const all = m.categories.flatMap((c) => c.products);
  assert.equal(all.length, 1, "only the product switched on");
  assert.equal(all[0].id, S.p.TC.id);
  assert.equal(all[0].price, S.p.TC.price);
  for (const k of ["costUsd", "code", "extraCostUsd", "recipe", "showOnMenu"]) assert.ok(!(k in all[0]), `no ${k} for visitors`);
  assert.equal(m.page.whatsapp, "963944000111");
  assert.ok(!("serviceKey" in m.page));
  ok(await admin("PUT", "/system/public-menu", { ...cfg, enabled: true, showPrices: false }));
  const hidden = ok(await visitor("GET", "/public/menu")).categories.flatMap((c) => c.products)[0];
  assert.ok(!("price" in hidden), "prices hidden when switched off");
  // a product not on the menu has no public photo
  assert.equal((await visitor("GET", `/public/menu/photo/${S.p.CLUB.id}`)).status, 404);
});

await step("public menu settings are checked", async () => {
  const cfg = ok(await admin("GET", "/system/public-menu"));
  assert.equal((await admin("PUT", "/system/public-menu", { ...cfg, whatsapp: "12" })).status, 400);
  assert.equal((await admin("PUT", "/system/public-menu", { ...cfg, facebook: "javascript:alert(1)" })).status, 400);
  assert.equal((await visitor("PUT", "/system/public-menu", cfg)).status, 401);
  assert.equal((await visitor("PUT", `/menu/products/${S.p.TC.id}/public`, { show: false })).status, 401);
});

await step("invoice design: saved on the client and sent with every receipt", async () => {
  const tpl = { size: "a4", title: "Tax invoice", intro: "Contract 42", footer: "Pay within 7 days", showLogo: false, showUnitPrice: true, showAccount: false, showPayment: true, showSignatures: true, accent: "#1d4ed8" };
  const r = ok(await admin("PUT", `/clients/${S.gym.id}/invoice-template`, { template: tpl }));
  assert.equal(r.custom, true);
  assert.equal(r.template.title, "Tax invoice");
  const orderId = ok(await admin("GET", "/orders?clientId=" + S.gym.id)).rows?.[0]?.id ?? null;
  const settled = ok(await admin("GET", `/consignments/${S.gymCons.id}`)).consignment.orderId;
  const rc = ok(await admin("GET", `/orders/${orderId ?? settled}/receipt`)).receipt;
  assert.equal(rc.client.template.title, "Tax invoice");
  assert.equal(rc.client.template.accent, "#1d4ed8");
  assert.equal(rc.client.customTemplate, true);
  assert.equal((await admin("PUT", `/clients/${S.gym.id}/invoice-template`, { template: { ...tpl, accent: "blue" } })).status, 400);
  const back = ok(await admin("PUT", `/clients/${S.gym.id}/invoice-template`, { template: null }));
  assert.equal(back.custom, false);
  assert.equal(back.template.title, "");
});

console.log(failed ? `\n${failed} step(s) failed` : "All drop point, public menu & invoice design steps passed");
process.exit(failed ? 1 : 0);
