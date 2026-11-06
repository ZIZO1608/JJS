// Re-runs the exact steps of each fixed QA finding on a fresh QA server and prints PASS / FAIL.
//   BASE=http://127.0.0.1:4420 node qa/flows/retest.mjs     (server started with the env-var admin/manager/member)
import { BASE, client, login } from "./lib.mjs";

let failed = 0;
const check = (id, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
};
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const a = await login("jabal", "qaAdmin123");
const j = (r, k) => r.json?.[k] ?? r.json?.rows ?? r.json;
await a("POST", "/system/demo-data");

/* NEW-1: a pounds supplier and a pounds product save before any rate is set (fresh server) */
{
  await a("PUT", "/fx/manual", { rate: null });
  const sup = await a("POST", "/purchases/suppliers", { name: "Pounds supplier", openingCurrency: "SYP" });
  const cat = await a("POST", "/menu/categories", { nameAr: "تجربة", nameEn: "Test" });
  const catId = cat.json?.row?.id ?? cat.json?.id;
  const prod = await a("POST", "/menu/products", { categoryId: catId, nameAr: "منتج", nameEn: "Pounds product", price: 450, currency: "SYP", shelfLifeHours: 24 });
  check("NEW-1", sup.status === 201 && prod.status === 201, `no rate set: SYP supplier → ${sup.status}, SYP product → ${prod.status} ${prod.json?.error ?? ""}`);
}
const prods = j(await a("GET", "/menu/products"), "products");
const ms = j(await a("GET", "/money/methods"), "methods");
const clients = j(await a("GET", "/clients"), "clients");
const cash = ms.find((m) => m.kind === "box" && /cash/i.test(m.nameEn));
const credit = ms.find((m) => m.kind === "credit");
const bal = async (id) => (await a("GET", `/clients/${id}`)).json.client.balanceUsd;
const line = (p, qty = 5) => [{ productId: p.id, qty }];
const P = prods.find((p) => p.currency === "USD");

/* QA-001: return then cancel */
{
  const C = clients[0];
  const b0 = await bal(C.id);
  const o = (await a("POST", "/orders", { lines: line(P), clientId: C.id, methodId: credit.id })).json;
  await a("POST", "/returns", { clientId: C.id, orderId: o.id, settlement: "credit", lines: [{ productId: P.id, qty: 5, action: "restock" }] });
  const c = await a("POST", `/orders/${o.id}/cancel`, { reason: "qa" });
  const b1 = await bal(C.id);
  check("QA-001", c.status === 409 && near(b1, b0), `cancel after return → ${c.status} ${c.json?.error}; balance ${b0} → ${b1}`);
}

/* QA-002: paid on account, then the delivery */
{
  const C = clients[1];
  const b0 = await bal(C.id);
  const o = (await a("POST", "/orders", { lines: line(P), clientId: C.id, methodId: credit.id, fulfilment: "delivery" })).json;
  const total = o.receipt.payment.remaining;
  await a("POST", `/clients/${C.id}/payments`, { amount: total, currency: "USD", methodId: cash.id });
  const row = (await a("GET", "/orders/deliveries?status=open")).json.rows.find((x) => x.id === o.id);
  const d = (await a("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: cash.id } })).json;
  const b1 = await bal(C.id);
  check("QA-002", row.remaining === 0 && d.collected === 0 && near(b1, b0), `deliveries screen asks ${row.remaining}, collected ${d.collected}, balance ${b0} → ${b1}`);
}

/* QA-003: SYP debt, rate moves, paid in exact pounds */
{
  const C = clients[2];
  await a("PUT", "/fx/manual", { rate: 130 });
  await a("PUT", "/settings/currency", { defaultCurrency: "SYP" });
  const b0 = await bal(C.id);
  const o = (await a("POST", "/orders", { lines: line(P), clientId: C.id, methodId: credit.id, fulfilment: "delivery" })).json;
  const owed = o.receipt.payment.remaining;
  await a("PUT", "/fx/manual", { rate: 140 });
  const d = (await a("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", currency: "SYP", methodId: cash.id } })).json;
  const b1 = await bal(C.id);
  check("QA-003", near(b1, b0, 0.0001), `owed ${owed} SYP, paid ${d.collected} after the rate moved 130→140; balance ${b0} → ${b1}`);
  await a("PUT", "/settings/currency", { defaultCurrency: "USD" });
}

/* QA-004: supplier invoice in SYP, rate moves, pay the exact pounds */
{
  const items = j(await a("GET", "/stock/items"), "items");
  const locs = j(await a("GET", "/stock/locations"), "locations");
  const loc = locs[0]?.places?.[0]?.id ?? locs[0]?.id;
  const boxes = j(await a("GET", "/money/boxes"), "boxes");
  const box = boxes.find((b) => b.kind === "main") ?? boxes[0];
  await a("POST", "/money/deposit", { boxId: box.id, amount: 5000 });
  const sup = (await a("POST", "/purchases/suppliers", { name: "QA SYP supplier" })).json;
  const supId = sup.row?.id ?? sup.supplier?.id ?? sup.id;
  if (!supId) console.log("  supplier create answered:", JSON.stringify(sup).slice(0, 200));
  for (const [buyAt, payAt] of [[130, 120], [140, 150]]) {
    await a("PUT", "/fx/manual", { rate: buyAt });
    const p = (await a("POST", "/purchases", { supplierId: supId, currency: "SYP", lines: [{ itemId: items[0].id, qty: 10, unitPrice: 1000, locationId: loc }] })).json.purchase;
    await a("PUT", "/fx/manual", { rate: payAt });
    const r = await a("POST", `/purchases/suppliers/${supId}/pay`, { amount: 10000, currency: "SYP", boxId: box.id });
    const after = (await a("GET", `/purchases/${p.id}`)).json;
    const due = (after.purchase ?? after).due;
    check("QA-004", r.status === 200 && near(due, 0, 0.5), `10,000 SYP invoice at ${buyAt}, paid 10,000 SYP at ${payAt} → ${r.status}, still due ${due}`);
  }
  await a("PUT", "/fx/manual", { rate: 130 });
}

/* QA-006: returns of free items */
{
  await a("PUT", "/system/settings/loyalty", { enabled: true, buyQty: 5, freeQty: 5 });
  const C = clients[3];
  const cheap = [...prods].filter((p) => p.currency === "USD").sort((x, y) => x.price - y.price)[0];
  const dear = [...prods].filter((p) => p.currency === "USD").sort((x, y) => y.price - x.price)[0];
  await a("POST", "/orders", { lines: line(dear), clientId: C.id, methodId: credit.id }); // earns 5 free
  const o = (await a("POST", "/orders", { lines: [...line(cheap), ...line(dear)], clientId: C.id, methodId: credit.id })).json;
  const ord = (await a("GET", `/orders/${o.id}`)).json.order;
  const freeLine = ord.lines.find((l) => l.freeQty > 0);
  const paidLine = ord.lines.find((l) => l.freeQty === 0);
  const r1 = (await a("POST", "/returns", { clientId: C.id, orderId: o.id, settlement: "credit", lines: [{ productId: freeLine.productId, qty: 5, action: "restock" }] })).json;
  const r2 = (await a("POST", "/returns", { clientId: C.id, orderId: o.id, settlement: "credit", lines: [{ productId: paidLine.productId, qty: 5, action: "restock" }] })).json;
  check("QA-006", freeLine.freeQty === 5 && r1.total === 0 && near(r2.total, paidLine.lineTotal), `free items return ${r1.total} (want 0), paid items return ${r2.total} (want ${paidLine.lineTotal})`);
  await a("PUT", "/system/settings/loyalty", { enabled: true, buyQty: 100, freeQty: 5 });
}

/* QA-007: admin resets a password → that person is signed out */
{
  const m = await login("member", "qaMember123");
  const users = j(await a("GET", "/users"), "users");
  const u = users.find((x) => x.username === "member");
  await a("PUT", `/users/${u.id}`, { name: u.name, username: u.username, roleId: u.role?.id ?? u.roleId, language: u.language, password: "qaMember456" });
  const after = await m("GET", "/auth/me");
  const self = await login("member", "qaMember456");
  const other = await login("member", "qaMember456");
  await self("PUT", "/auth/me/password", { current: "qaMember456", next: "qaMember123" });
  const selfStill = await self("GET", "/auth/me");
  const otherAfter = await other("GET", "/auth/me");
  check("QA-007", after.status === 401 && selfStill.status === 200 && otherAfter.status === 401, `old phone after admin reset → ${after.status}; own change keeps this device ${selfStill.status}, other device → ${otherAfter.status}`);
}

/* QA-008: cancel a delivered order after the driver handed in the cash */
{
  const reps = j(await a("GET", "/money/reps"), "reps");
  const rep = reps[0];
  const C = clients[4];
  const o = (await a("POST", "/orders", { lines: line(P), clientId: C.id, methodId: credit.id, fulfilment: "delivery", assignedTo: rep.employeeId ?? rep.id })).json;
  const d = (await a("POST", `/orders/${o.id}/deliver`, { collection: { mode: "full", methodId: cash.id } })).json;
  const boxes = j(await a("GET", "/money/boxes"), "boxes");
  const repBox = boxes.find((b) => b.kind === "rep");
  await a("POST", "/money/handover", { boxId: repBox.id });
  const c = await a("POST", `/orders/${o.id}/cancel`, { reason: "qa" });
  const after = j(await a("GET", "/money/boxes"), "boxes").find((b) => b.id === repBox.id);
  check("QA-008", c.status === 200 && after.balance >= -0.001, `collected ${d.collected}, handed in, cancelled → ${c.status}; driver box now ${after.balance}`);
}

/* QA-009: the Assets page address */
{
  const r = await fetch(BASE + "/assets", { redirect: "manual" });
  const page = await fetch(BASE + "/fixed-assets");
  check("QA-009", r.status === 302 && r.headers.get("location") === "/fixed-assets" && page.status === 200, `/assets → ${r.status} ${r.headers.get("location")}; /fixed-assets → ${page.status}`);
}

/* QA-013: SVG product photo refused */
{
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").toString("base64");
  const p = (await a("GET", `/menu/products/${P.id}`)).json.product;
  const r = await a("PUT", `/menu/products/${P.id}`, { ...p, photo: svg });
  check("QA-013", r.status === 400, `saving an SVG photo → ${r.status}`);
}

/* QA-010 / QA-017: exports */
{
  const m = await login("manager", "qaManager123");
  const csvRes = await fetch(`${BASE}/api/reports/export/orders.csv?from=2000-01-01&to=2100-01-01`, { headers: { Cookie: "" } });
  const five = await m("GET", "/reports/five");
  check("QA-010", five.status === 403 || five.status === 401, `manager (no see-costs) asks for the five answers → ${five.status}; anonymous CSV → ${csvRes.status}`);
}

/* backups download */
{
  await a("POST", "/backups");
  const list = (await a("GET", "/backups")).json.backups;
  const name = list[0].name;
  const m = await login("manager", "qaManager123");
  const ok = await a("GET", `/backups/download/${encodeURIComponent(name)}`);
  const bad = await a("GET", `/backups/download/${encodeURIComponent("../jjs.db")}`);
  const mgr = await m("GET", `/backups/download/${encodeURIComponent(name)}`);
  check("Backups", ok.status === 200 && bad.status === 404 && mgr.status === 403, `admin download → ${ok.status}; path trick → ${bad.status}; manager → ${mgr.status}`);
}

/* QA-012: security headers + per-IP login brake (last: it locks this machine out for 10 minutes) */
{
  const h = await fetch(BASE + "/api/health");
  const headers = ["x-content-type-options", "x-frame-options", "referrer-policy"].every((k) => h.headers.get(k));
  const anon = client();
  let last;
  for (let i = 0; i < 21; i++) last = await anon("POST", "/auth/login", { username: `nobody${i}`, password: "wrong-pass" });
  check("QA-012", headers && last.status === 429, `security headers ${headers ? "present" : "missing"}; 21 wrong logins on different names → ${last.status}`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll re-tests passed");
process.exit(failed ? 1 : 0);
