// Cloud sync against a fake Supabase (PostgREST) — run after api-full.mjs on the same server.
//   BASE=http://127.0.0.1:4397 node tests/api-sync.mjs
import assert from "node:assert/strict";
import http from "node:http";

const BASE = process.env.BASE ?? "http://127.0.0.1:4397";
const got = {}; // table -> rows
const headers = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = req.url.match(/^\/rest\/v1\/([a-z_]+)\?on_conflict=(\w+)/);
    if (!m || req.method !== "POST") return res.writeHead(404).end("no");
    headers.push(req.headers);
    (got[m[1]] ??= []).push(...JSON.parse(body));
    res.writeHead(201).end();
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${mock.address().port}`;

let cookie = "";
const call = async (method, path, body) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const s = r.headers.get("set-cookie");
  if (s) cookie = s.split(";")[0];
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/auth/login", { username: "jj", password: "secret123" });
assert.equal((await call("PUT", "/system/sync", { enabled: true, supabaseUrl: url, serviceKey: "test-service-key" })).status, 200);
const s1 = await call("GET", "/system/sync");
assert.equal(s1.json.hasKey, true);
assert.equal(JSON.stringify(s1.json).includes("test-service-key"), false, "the key is never sent back to the screen");
const run = await call("POST", "/system/sync/run");
assert.equal(run.status, 200, JSON.stringify(run.json));
assert.ok(run.json.pushed > 100, `pushed ${run.json.pushed}`);
assert.ok(got.orders?.length >= 9 && got.clients?.length >= 5 && got.daily_snapshots?.length === 1);
assert.equal(headers[0].authorization, "Bearer test-service-key");
assert.ok(got.users.every((u) => !("password_hash" in u)), "password hashes never leave the laptop");
assert.ok(!got.settings.some((r) => /^(sync|fx\.config)/.test(r.key)), "secret settings never leave the laptop");
assert.equal(typeof got.clients[0].active, "boolean", "booleans are real booleans");
assert.ok(got.daily_snapshots[0].data.today.salesUsd > 0);
const s2 = await call("GET", "/system/sync");
assert.equal(s2.json.pending, 0, `pending after sync: ${s2.json.pending}`);
assert.equal(s2.json.status.lastError, null);
// a new change is picked up next time, nothing else is re-sent
for (const k of Object.keys(got)) delete got[k];
await call("POST", "/clients", { type: "individual", name: "Sync check" });
await call("POST", "/system/sync/run");
assert.equal(got.clients?.length, 1);
assert.equal(got.orders, undefined);
await call("PUT", "/system/sync", { enabled: false, supabaseUrl: "" });
mock.close();
console.log("All cloud sync checks passed.");
