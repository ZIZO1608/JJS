// End-to-end API check for Stage 1. Run against a fresh data folder:
//   JJS_DATA_DIR=/tmp/jjs-test PORT=4399 npx tsx server/index.ts   (in one terminal)
//   BASE=http://127.0.0.1:4399 node tests/api-smoke.mjs             (in another)
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
}

const step = async (name, fn) => {
  try {
    await fn();
    console.log("  ✓", name);
  } catch (e) {
    console.error("  ✗", name, "\n   ", e.message);
    process.exitCode = 1;
  }
};

const admin = client();
const manager = client();
const member = client();
let managerRoleId, memberRoleId, customRoleId, managerUserId, lookupId, taxId;

console.log("Stage 1 API smoke test →", BASE);

await step("first run needs setup", async () => {
  const r = await admin("GET", "/auth/status");
  assert.equal(r.json.needsSetup, true);
});
await step("setup is refused with a weak password", async () => {
  const r = await admin("POST", "/auth/setup", { businessNameAr: "JJ's", businessNameEn: "JJ's", name: "Owner", username: "owner", password: "123", language: "ar" });
  assert.equal(r.status, 400);
});
await step("setup creates the business and the first admin", async () => {
  const r = await admin("POST", "/auth/setup", { businessNameAr: "جي جيز", businessNameEn: "JJ's deli shop", name: "Owner", username: "Owner", password: "secret123", language: "ar" });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.role.systemKey, "admin");
  assert.ok(r.json.user.permissions.includes("costing:see_cost"));
});
await step("setup cannot run twice", async () => {
  const r = await client()("POST", "/auth/setup", { businessNameAr: "x", businessNameEn: "x", name: "Hacker", username: "hacker", password: "secret123", language: "en" });
  assert.equal(r.status, 409);
});
await step("API refuses requests without login", async () => {
  const r = await client()("GET", "/users");
  assert.equal(r.status, 401);
});
await step("three system roles are seeded", async () => {
  const r = await admin("GET", "/roles");
  assert.equal(r.status, 200);
  const keys = r.json.roles.map((x) => x.systemKey).sort();
  assert.deepEqual(keys, ["admin", "manager", "member"]);
  managerRoleId = r.json.roles.find((x) => x.systemKey === "manager").id;
  memberRoleId = r.json.roles.find((x) => x.systemKey === "member").id;
  const mgr = r.json.roles.find((x) => x.systemKey === "manager");
  assert.ok(!mgr.permissions.includes("costing:see_cost"), "manager must not see costs");
});
await step("admin creates a manager and a member", async () => {
  let r = await admin("POST", "/users", { name: "Rami", username: "rami", password: "manager1", roleId: managerRoleId, language: "ar" });
  assert.equal(r.status, 201);
  managerUserId = r.json.user.id;
  r = await admin("POST", "/users", { name: "Sami", username: "sami", password: "member11", roleId: memberRoleId, language: "en" });
  assert.equal(r.status, 201);
});
await step("duplicate username is refused", async () => {
  const r = await admin("POST", "/users", { name: "Rami 2", username: "RAMI", password: "manager1", roleId: managerRoleId });
  assert.equal(r.status, 409);
});
await step("wrong password is refused", async () => {
  const r = await manager("POST", "/auth/login", { username: "rami", password: "nope" });
  assert.equal(r.status, 401);
});
await step("manager and member log in", async () => {
  assert.equal((await manager("POST", "/auth/login", { username: "rami", password: "manager1" })).status, 200);
  assert.equal((await member("POST", "/auth/login", { username: "sami", password: "member11" })).status, 200);
});
await step("manager cannot open users, roles or audit (403)", async () => {
  assert.equal((await manager("GET", "/users")).status, 403);
  assert.equal((await manager("GET", "/roles")).status, 403);
  assert.equal((await manager("GET", "/audit")).status, 403);
  assert.equal((await manager("PUT", "/settings/business", { nameAr: "x", nameEn: "x" })).status, 403);
});
await step("everyone can read dropdown lists", async () => {
  const r = await member("GET", "/lookups?type=unit");
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 3);
});
await step("manager may add an expense item from a form (+ Add new)", async () => {
  const r = await manager("POST", "/lookups", { listType: "expense_item", nameAr: "بيستو", nameEn: "Pesto" });
  assert.equal(r.status, 201);
  lookupId = r.json.item.id;
});
await step("member may not add an expense item", async () => {
  const r = await member("POST", "/lookups", { listType: "expense_item", nameAr: "جبنة", nameEn: "Cheese" });
  assert.equal(r.status, 403);
});
await step("duplicate list item is refused", async () => {
  const r = await admin("POST", "/lookups", { listType: "expense_item", nameAr: "بيستو", nameEn: "Pesto" });
  assert.equal(r.status, 409);
});
await step("admin renames and deactivates a list item", async () => {
  const r = await admin("PUT", `/lookups/${lookupId}`, { nameAr: "صلصة بيستو", nameEn: "Pesto sauce", active: false, sort: 9 });
  assert.equal(r.status, 200);
  const list = await admin("GET", "/lookups?type=expense_item");
  assert.ok(!list.json.items.some((i) => i.id === lookupId), "inactive items are hidden from dropdowns");
});
await step("custom role: create with chosen permissions", async () => {
  const r = await admin("POST", "/roles", { nameAr: "كاشير", nameEn: "Cashier", permissions: ["home:view", "orders:view", "orders:create"] });
  assert.equal(r.status, 201);
  customRoleId = r.json.role.id;
});
await step("unknown permission is refused", async () => {
  const r = await admin("POST", "/roles", { nameAr: "x", nameEn: "x", permissions: ["rockets:launch"] });
  assert.equal(r.status, 400);
});
await step("admin role permissions cannot be reduced", async () => {
  const roles = (await admin("GET", "/roles")).json.roles;
  const adminRole = roles.find((x) => x.systemKey === "admin");
  const r = await admin("PUT", `/roles/${adminRole.id}`, { nameAr: "الإدارة", nameEn: "Admin", permissions: ["home:view"] });
  assert.equal(r.status, 200);
  assert.ok(r.json.role.permissions.includes("roles:edit"));
});
await step("system role cannot be deleted; role in use cannot be deleted", async () => {
  assert.equal((await admin("DELETE", `/roles/${managerRoleId}`)).status, 409);
  await admin("PUT", `/users/${managerUserId}`, { name: "Rami", username: "rami", roleId: customRoleId, language: "ar" });
  assert.equal((await admin("DELETE", `/roles/${customRoleId}`)).status, 409);
  await admin("PUT", `/users/${managerUserId}`, { name: "Rami", username: "rami", roleId: managerRoleId, language: "ar" });
  assert.equal((await admin("DELETE", `/roles/${customRoleId}`)).status, 200);
});
await step("the last admin cannot be deactivated or demoted", async () => {
  const me = (await admin("GET", "/auth/me")).json.user;
  assert.equal((await admin("POST", `/users/${me.id}/active`, { active: false })).status, 409);
  assert.equal((await admin("PUT", `/users/${me.id}`, { name: "Owner", username: "owner", roleId: managerRoleId, language: "ar" })).status, 409);
});
await step("deactivated user is logged out and cannot log in", async () => {
  assert.equal((await admin("POST", `/users/${managerUserId}/active`, { active: false })).status, 200);
  assert.equal((await manager("GET", "/auth/me")).status, 401);
  assert.equal((await client()("POST", "/auth/login", { username: "rami", password: "manager1" })).status, 403);
  await admin("POST", `/users/${managerUserId}/active`, { active: true });
});
await step("business info saves", async () => {
  const r = await admin("PUT", "/settings/business", { nameAr: "جي جيز ديلي", nameEn: "JJ's deli shop", phone: "+963 900 000 000", address: "Aleppo", logo: "" });
  assert.equal(r.status, 200);
  assert.equal((await member("GET", "/settings/public")).json.business.nameAr, "جي جيز ديلي");
});
await step("manual FX rate overrides and can be cleared", async () => {
  let r = await admin("PUT", "/fx/manual", { rate: 117.5 });
  assert.equal(r.json.rate, 117.5);
  assert.equal(r.json.source, "manual");
  r = await member("GET", "/fx/current");
  assert.equal(r.json.rate, 117.5);
  r = await admin("PUT", "/fx/manual", { rate: null });
  assert.equal(r.json.manualRate, null);
});
await step("FX API failure keeps the last rate and reports the error", async () => {
  await admin("PUT", "/fx/manual", { rate: 120 });
  const r = await admin("PUT", "/fx/config", { apiUrl: "http://127.0.0.1:1/nothing", jsonPath: "rate" });
  assert.equal(r.status, 200);
  assert.equal(r.json.rate, 120);
  assert.ok(r.json.lastError);
});
await step("taxes: percent and fixed; >100% refused", async () => {
  assert.equal((await admin("POST", "/taxes", { nameAr: "رسم", nameEn: "Fee", kind: "percent", value: 150 })).status, 400);
  let r = await admin("POST", "/taxes", { nameAr: "ضريبة", nameEn: "Tax", kind: "percent", value: 5 });
  assert.equal(r.status, 201);
  taxId = r.json.tax.id;
  r = await admin("POST", "/taxes", { nameAr: "رسم ثابت", nameEn: "Fixed fee", kind: "fixed", value: 0.5 });
  assert.equal(r.status, 201);
  assert.equal((await admin("DELETE", `/taxes/${taxId}`)).status, 200);
  assert.equal((await admin("GET", "/taxes")).json.taxes.length, 1);
});
await step("backup now creates a file", async () => {
  const r = await admin("POST", "/backups");
  assert.equal(r.status, 201);
  assert.ok(r.json.backups.length >= 1);
});
await step("audit log recorded the work and hides passwords", async () => {
  const r = await admin("GET", "/audit?pageSize=200");
  assert.equal(r.status, 200);
  assert.ok(r.json.total >= 15);
  const userCreate = r.json.entries.find((e) => e.entity === "user" && e.action === "create");
  assert.equal(userCreate.after.passwordHash, "•••");
  const filtered = await admin("GET", "/audit?entity=role");
  assert.ok(filtered.json.entries.every((e) => e.entity === "role"));
});
await step("logout ends the session", async () => {
  await member("POST", "/auth/logout");
  assert.equal((await member("GET", "/auth/me")).status, 401);
});

console.log(process.exitCode ? "\nSome checks failed." : "\nAll Stage 1 API checks passed.");
