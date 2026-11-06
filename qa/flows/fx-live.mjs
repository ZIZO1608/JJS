// Live rate check against the real Syrian rate API.
// Copies the API key saved in data/jjs.db into a throwaway QA server (never prints it),
// fetches the live rate, and prices an order in SYP.
//   BASE=http://127.0.0.1:4421 node qa/flows/fx-live.mjs
import Database from "better-sqlite3";
import { client } from "./lib.mjs";

const saved = JSON.parse(new Database("data/jjs.db", { readonly: true }).prepare("select value from settings where key = ?").get("fx.config").value);
const a = client();
await a("POST", "/auth/login", { username: "jabal", password: process.env.QA_PASS_ADMIN ?? "qaAdmin123" });
const put = await a("PUT", "/fx/config", { apiUrl: saved.apiUrl, jsonPath: saved.jsonPath, apiKey: saved.apiKey });
console.log("key copied:", put.status === 200);

const r = (await a("POST", "/fx/refresh")).json;
console.log("rate now: 1 USD =", r.rate, "SYP | source:", r.source, "| error:", r.lastError);

await a("POST", "/system/demo-data");
await a("PUT", "/settings/currency", { defaultCurrency: "SYP" });
const P = (await a("GET", "/menu/products")).json;
const prods = P.products ?? P.rows ?? P;
const p = prods.find((x) => x.currency === "USD");
const q = (await a("POST", "/orders/quote", { lines: [{ productId: p.id, qty: 5 }] })).json;
console.log(`5 × ${p.nameEn} at $${p.price} → ${q.total.toLocaleString("en-US")} ${q.currency} (rate ${q.rate})`);
