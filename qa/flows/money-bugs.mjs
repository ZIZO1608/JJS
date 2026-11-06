// Reproduces the money reviewer's top findings on the live QA server.
import { login } from "./lib.mjs";
const a = await login("jabal", "qaAdmin123");
const j = (r, k) => r.json?.[k] ?? r.json?.rows ?? r.json;
const prods = j(await a("GET", "/menu/products"), "products");
const ms = j(await a("GET", "/money/methods"), "methods");
const clients = j(await a("GET", "/clients"), "clients");
const cash = ms.find((m) => m.kind === "box"), credit = ms.find((m) => m.kind === "credit");
const bal = async (id) => (await a("GET", `/clients/${id}`)).json.client;
const balUsd = async (id) => { const c = await bal(id); return c.balanceUsd ?? c.balance?.usd ?? c.balance; };
const stockOf = async (pid) => JSON.stringify((await a("GET", `/menu/products/${pid}`)).json?.product?.stock ?? "?");
const P = prods[2], C = clients[2];
const line = [{ productId: P.id, qty: 5 }];

console.log("\n#1 return then cancel");
let b0 = await balUsd(C.id);
let o = await a("POST", "/orders", { lines: line, clientId: C.id, methodId: credit.id });
console.log(" order", o.status, o.json?.receipt?.payment, "bal before", b0, "after order", await balUsd(C.id));
let r = await a("POST", "/returns", { clientId: C.id, orderId: o.json.id, settlement: "credit", lines: [{ productId: P.id, qty: 5, action: "restock" }] });
console.log(" return", r.status, JSON.stringify(r.json).slice(0, 150), "bal", await balUsd(C.id));
r = await a("POST", `/orders/${o.json.id}/cancel`, { reason: "qa" });
console.log(" cancel after return", r.status, JSON.stringify(r.json).slice(0, 120), "bal now", await balUsd(C.id), "(should equal before:", b0, ")");

console.log("\n#2 paid on account, then delivery collects again");
const C2 = clients[3];
b0 = await balUsd(C2.id);
o = await a("POST", "/orders", { lines: line, clientId: C2.id, methodId: credit.id, fulfilment: "delivery" });
const total = o.json.receipt.payment.remaining;
r = await a("POST", `/clients/${C2.id}/payments`, { amount: total, currency: "USD", methodId: cash.id });
console.log(" paid on account", r.status, "bal", await balUsd(C2.id));
const dl = (await a("GET", "/orders/deliveries?status=open")).json;
const row = (dl.rows ?? dl.orders ?? []).find((x) => x.id === o.json.id);
console.log(" deliveries screen still asks to collect:", row?.remaining ?? row?.stillOwed ?? JSON.stringify(row).slice(0, 200));
r = await a("POST", `/orders/${o.json.id}/deliver`, { collection: { mode: "full", methodId: cash.id } });
console.log(" deliver full", JSON.stringify(r.json), "bal now", await balUsd(C2.id), "(was", b0, ")");

console.log("\n#3 SYP debt paid in exact pounds after the rate moves");
await a("PUT", "/fx/manual", { rate: 13000 });
console.log(" currency->SYP", (await a("PUT", "/settings/currency", { defaultCurrency: "SYP" })).status);
const C3 = clients[4];
b0 = await balUsd(C3.id);
o = await a("POST", "/orders", { lines: line, clientId: C3.id, methodId: credit.id, fulfilment: "delivery" });
console.log(" SYP order", o.status, o.json?.receipt?.payment, JSON.stringify(o.json).slice(0, 120));
await a("PUT", "/fx/manual", { rate: 14000 });
r = await a("POST", `/orders/${o.json.id}/deliver`, { collection: { mode: "full", currency: "SYP", methodId: cash.id } });
console.log(" deliver full SYP", JSON.stringify(r.json), "bal now", await balUsd(C3.id), "(was", b0, ")");
await a("PUT", "/settings/currency", { defaultCurrency: "USD" });
await a("PUT", "/fx/manual", { rate: 13000 });
