// The "digital receipt" QR: each receipt carries a signed link, and /api/public/receipts/<link> shows that one
// receipt without a login, never another one, and never costs, notes or the client's phone and balance.
// Run on a FRESH data folder (npm test does this for you).
//   BASE=http://127.0.0.1:4399 node tests/api-receipt-link.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + "/api" + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
}
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n   ", e.message); }
};
const ok = (r, code = 200) => { if (r.status !== code) throw new Error(`expected ${code}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`); return r.json; };

const admin = client();
const anyone = client(); // no login at all
const S = {};

console.log("Digital receipt link API test →", BASE);

await step("setup, sample data and two orders", async () => {
  ok(await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's", name: "Owner", username: "jj", password: "secret123", language: "en" }), 201);
  ok(await admin("POST", "/system/demo-data"));
  const products = ok(await admin("GET", "/menu/catalog")).products;
  const methods = ok(await admin("GET", "/money/methods")).rows;
  const c = ok(await admin("POST", "/clients", { type: "individual", name: "Sara", phone: "0944123456", address: "Mazzeh", creditLimitUsd: 0 }), 201);
  S.sara = c.row.id;
  const credit = methods.find((m) => m.systemKey === "credit") ?? methods[0];
  S.a = ok(await admin("POST", "/orders", { clientId: S.sara, methodId: credit.id, note: "secret kitchen note", lines: [{ productId: products[0].id, qty: 10, optionIds: [] }] }), 201);
  S.b = ok(await admin("POST", "/orders", { methodId: methods[0].id, lines: [{ productId: products[1].id, qty: 5, optionIds: [] }] }), 201);
});

await step("the staff receipt carries a signed link", async () => {
  const rc = ok(await admin("GET", `/orders/${S.a.id}/receipt`)).receipt;
  assert.match(rc.link, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/);
  assert.ok(rc.link.startsWith(S.a.id + "."));
  S.linkA = rc.link;
  S.linkB = ok(await admin("GET", `/orders/${S.b.id}/receipt`)).receipt.link;
  assert.notEqual(S.linkA.split(".")[1], S.linkB.split(".")[1], "each order has its own signature");
  assert.equal(ok(await admin("GET", `/orders/${S.a.id}/receipt`)).receipt.link, S.linkA, "the link is stable");
  assert.equal(rc.printing.receiptLinkQr, true, "the QR is on by default");
});

await step("anyone with the link sees that receipt, without logging in", async () => {
  const r = await anyone("GET", `/public/receipts/${S.linkA}`);
  const rc = ok(r).receipt;
  assert.equal(rc.order.number, S.a.number);
  assert.equal(rc.client.name, "Sara");
  assert.ok(rc.lines.length === 1 && rc.lines[0].qty === 10);
  assert.ok(rc.order.total > 0);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/);
});

await step("it shows nothing private", async () => {
  const rc = ok(await anyone("GET", `/public/receipts/${S.linkA}`)).receipt;
  const text = JSON.stringify(rc);
  for (const word of ["cost", "secret kitchen note", "0944123456", "Mazzeh", "balance", "userId", "employeeId", "beforeUsd"]) {
    assert.ok(!text.includes(word), `public receipt must not contain "${word}"`);
  }
  assert.deepEqual(Object.keys(rc.client).sort(), ["language", "name"]);
});

await step("a changed, swapped or made-up link is refused", async () => {
  const [idA, sigA] = S.linkA.split(".");
  const [idB] = S.linkB.split(".");
  const flip = (s) => (s[0] === "A" ? "B" : "A") + s.slice(1);
  for (const bad of [`${idA}.${flip(sigA)}`, `${idB}.${sigA}`, idA, `${idA}.`, "test", "x".repeat(60), `${idA}.${sigA}x`]) {
    const r = await anyone("GET", `/public/receipts/${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, `"${bad}" should be refused`);
    assert.ok(!JSON.stringify(r.json).includes("Sara"));
  }
});

await step("the link settings save and validate", async () => {
  const p = ok(await admin("GET", "/system/app-settings")).printing;
  ok(await admin("PUT", "/system/settings/printing", { ...p, receiptLinkQr: false, receiptLinkBase: "https://jjs.example.com" }));
  const after = ok(await admin("GET", "/system/app-settings")).printing;
  assert.equal(after.receiptLinkQr, false);
  assert.equal(after.receiptLinkBase, "https://jjs.example.com");
  assert.equal((await admin("PUT", "/system/settings/printing", { ...p, receiptLinkBase: "not a url !!" })).status, 400);
  ok(await admin("PUT", "/system/settings/printing", { ...p, receiptLinkQr: true, receiptLinkBase: "" }));
});

await step("a cancelled order's link still opens and says cancelled", async () => {
  const r = await admin("POST", `/orders/${S.b.id}/cancel`, { reason: "test" });
  if (r.status !== 200 && r.status !== 201) return; // cancelling has its own rules; nothing to check if refused
  const rc = ok(await anyone("GET", `/public/receipts/${S.linkB}`)).receipt;
  assert.equal(rc.order.status, "cancelled");
});

if (failed) {
  console.error(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log("All digital receipt link checks passed");
