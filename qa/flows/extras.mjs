// Checks the handover extras on a fresh server started with JJS_ADMIN_USERNAME=jabal / JJS_ADMIN_PASSWORD=qaAdmin123:
//  - an account made from the server variables is asked to choose its own password, until it does
//  - a dollar move of 5% or more puts a note in the staff bell (fake rate API on port 4431)
//   BASE=http://127.0.0.1:4420 node qa/flows/extras.mjs
import http from "node:http";
import { login } from "./lib.mjs";

let failed = 0;
const check = (id, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
};

/* password nudge */
const a = await login("jabal", "qaAdmin123");
const before = (await a("GET", "/auth/me")).json.user.tempPassword;
const changed = await a("PUT", "/auth/me/password", { current: "qaAdmin123", next: "ownPass789" });
const after = (await a("GET", "/auth/me")).json.user.tempPassword;
check("Password nudge", before === true && changed.json?.user?.tempPassword === false && after === false, `env account asked: ${before}; after choosing its own: ${after}`);
await a("PUT", "/auth/me/password", { current: "ownPass789", next: "qaAdmin123" });

/* rate alert: fake API answers in old pounds, 14,000 then 15,000 (+7.1%) */
let rate = 14000;
const fake = http.createServer((_req, res) => res.end(JSON.stringify({ rate }))).listen(4431);
await a("PUT", "/fx/manual", { rate: null });
await a("PUT", "/fx/config", { apiUrl: "http://127.0.0.1:4431/", jsonPath: "rate" });
const r1 = (await a("POST", "/fx/refresh")).json.rate;
rate = 15000;
const r2 = (await a("POST", "/fx/refresh")).json.rate;
const notes = (await a("GET", "/notifications")).json;
const rows = notes.rows ?? notes.notifications ?? notes;
const alert = rows.find((n) => n.kind === "rate_move");
check("Rate alert", r1 === 140 && r2 === 150 && !!alert, `rates ${r1} → ${r2} (new pounds); bell: ${alert ? alert.titleEn + " — " + alert.bodyEn : "nothing"}`);
fake.close();

console.log(failed ? `\n${failed} check(s) failed` : "\nAll extras passed");
process.exit(failed ? 1 : 0);
