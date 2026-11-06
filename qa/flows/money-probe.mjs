// Edge cases on real orders: big discounts, part pay, deliver twice, cancel twice, member discount.
import { login } from "./lib.mjs";
const a = await login("jabal", "qaAdmin123");
const mem = await login("member", "qaMember123");
const prods = (await a("GET", "/menu/products")).json;
const P = (prods.products ?? prods.rows ?? prods).filter((p) => p.active !== false);
const methods = (await a("GET", "/money/methods")).json;
const M = methods.methods ?? methods.rows ?? methods;
const cj = (await a("GET", "/clients")).json; const clients = cj.clients ?? cj.rows ?? cj;
const cash = M.find((m) => /cash|نقد/i.test(m.nameEn + m.nameAr) && m.kind !== "credit") ?? M[0];
const credit = M.find((m) => m.kind === "credit" || /credit/i.test(m.nameEn));
console.log("products", P.slice(0, 3).map((p) => `${p.nameEn} ${p.price} ${p.currency}`), "methods", M.map((m) => `${m.nameEn}/${m.kind}`));
const line = [{ productId: P[0].id, qty: 5 }];
const show = (tag, r) => console.log(tag, r.status, JSON.stringify(r.json).slice(0, 300));
show("quote amount>total", await a("POST", "/orders/quote", { lines: line, methodId: cash.id, manualDiscountAmount: 999999 }));
show("quote pct 100", await a("POST", "/orders/quote", { lines: line, methodId: cash.id, manualDiscountPct: 100 }));
show("quote pct+amount", await a("POST", "/orders/quote", { lines: line, methodId: cash.id, manualDiscountPct: 50, manualDiscountAmount: 1 }));
show("member discount", await mem("POST", "/orders", { lines: line, methodId: cash.id, manualDiscountPct: 10 }));
const o = await a("POST", "/orders", { lines: line, clientId: clients[0].id, methodId: cash.id, paidAmount: 1, fulfilment: "delivery" });
show("order part paid", o);
const id = o.json?.id;
if (id) {
  show("deliver part", await a("POST", `/orders/${id}/deliver`, { collection: { mode: "part", amount: 1, currency: "USD" } }));
  show("deliver again", await a("POST", `/orders/${id}/deliver`, { collection: { mode: "full" } }));
  show("cancel", await a("POST", `/orders/${id}/cancel`, { reason: "qa" }));
  show("cancel again", await a("POST", `/orders/${id}/cancel`, { reason: "qa" }));
}
show("qty 0", await a("POST", "/orders/quote", { lines: [{ productId: P[0].id, qty: 0 }] }));
show("paid > total", await a("POST", "/orders", { lines: line, methodId: cash.id, paidAmount: 99999 }));
