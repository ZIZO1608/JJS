// Rules from the member test report: who may cancel an order, and what an order taker can read.
// Run through npm test: it needs JJS_DATA_DIR to age an order, on a FRESH data folder.
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";

const BASE = process.env.BASE ?? "http://127.0.0.1:4398";

function client() {
  let cookie = "";
  return async (method, p, body) => {
    const res = await fetch(BASE + "/api" + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n   ", e.message); }
};
const ok = (r, code = 200) => { if (r.status !== code) throw new Error(`expected ${code}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`); return r.json; };

const admin = client();
const member = client();
const S = {};
const balance = async () => ok(await admin("GET", `/clients/${S.client.id}`)).client.balanceUsd;
const onAccount = async (who) => ok(await who("POST", "/orders", { clientId: S.client.id, methodId: S.m.credit.id, lines: [{ productId: S.p.LEMON.id, qty: 1, optionIds: [] }] }), 201);
const canCancel = async (o) => ok(await member("GET", `/orders/${o.id}`)).order.canCancel;
const refused = async (o) => {
  const r = await member("POST", `/orders/${o.id}/cancel`, { reason: "try" });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "cancel_needs_manager");
};

console.log("Member rules API test →", BASE);

await step("setup and sample data", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  ok(await admin("PUT", "/fx/manual", { rate: 13000 }));
  S.p = Object.fromEntries(ok(await admin("GET", "/menu/catalog")).products.map((p) => [p.code, p]));
  S.m = Object.fromEntries(ok(await admin("GET", "/money/methods")).rows.map((m) => [m.systemKey, m]));
  S.client = ok(await admin("GET", "/clients")).rows[0];
  const roles = ok(await admin("GET", "/roles")).roles;
  ok(await admin("POST", "/users", { name: "Sami", username: "sami", password: "pass1234", roleId: roles.find((r) => r.systemKey === "member").id }), 201);
  ok(await member("POST", "/auth/login", { username: "sami", password: "pass1234" }));
});

await step("a member can take back their own order right after taking it", async () => {
  const before = await balance();
  const o = await onAccount(member);
  assert.ok((await balance()) < before, "the debt went on");
  assert.equal(await canCancel(o), true);
  ok(await member("POST", `/orders/${o.id}/cancel`, { reason: "typo" }));
  assert.equal(await balance(), before, "and came back off");
});

await step("a delivered on-account order cannot be cancelled by a member, so the debt stays", async () => {
  const o = await onAccount(member);
  ok(await admin("POST", `/orders/${o.id}/deliver`, {}));
  const owed = await balance();
  assert.equal(await canCancel(o), false);
  await refused(o);
  assert.equal(await balance(), owed, "the debt did not move");
  assert.equal(ok(await admin("GET", `/orders/${o.id}`)).order.status, "delivered");
  ok(await admin("POST", `/orders/${o.id}/cancel`, { reason: "manager checked" }));
});

await step("a member cannot cancel someone else's order", async () => {
  const o = await onAccount(admin);
  assert.equal(await canCancel(o), false);
  await refused(o);
});

await step("a member's own order stops being theirs to cancel after 30 minutes", async () => {
  const o = await onAccount(member);
  const db = new Database(path.join(process.env.JJS_DATA_DIR, "jjs.db"));
  db.prepare("update orders set created_at = ? where id = ?").run(new Date(Date.now() - 31 * 60_000).toISOString(), o.id);
  db.close();
  assert.equal(await canCancel(o), false);
  await refused(o);
  ok(await admin("POST", `/orders/${o.id}/cancel`, { reason: "manager checked" }));
});

await step("client requests and the route sheet are closed to a member, even by address", async () => {
  for (const p of ["/requests/orders", "/requests/subscriptions", "/route-sheet"]) assert.equal((await member("GET", p)).status, 403, p);
  ok(await admin("GET", "/requests/orders"));
});

await step("a member's client list holds only what the order screen needs", async () => {
  const row = ok(await member("GET", "/clients")).rows.find((c) => c.id === S.client.id);
  assert.deepEqual(Object.keys(row).sort(), ["active", "balanceUsd", "consignment", "contactPerson", "id", "name", "phone", "subscription"]);
  const full = ok(await admin("GET", "/clients")).rows.find((c) => c.id === S.client.id);
  for (const k of ["creditLimitUsd", "address", "lat", "lng", "aging"]) assert.ok(k in full, `the admin still gets ${k}`);
  assert.ok(ok(await member("GET", "/orders")).rows.every((o) => !("costUsd" in o)), "no cost on orders");
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll member rules passed");
process.exit(failed ? 1 : 0);
