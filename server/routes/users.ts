import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { roles, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { hashPassword, requirePerm } from "../lib/auth.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";

export const usersRouter = Router();

const usernameRule = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .regex(/^[a-zA-Z0-9._-]+$/, "Use English letters, numbers, dot, dash or underscore")
  .transform((s) => s.toLowerCase());

const userOut = (u: typeof users.$inferSelect) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  roleId: u.roleId,
  language: u.language,
  active: u.active,
  createdAt: u.createdAt,
});

const roleExists = (roleId: string) => {
  const r = db.select().from(roles).where(and(eq(roles.id, roleId), isNull(roles.deletedAt))).get();
  if (!r) throw new HttpError(400, "role_not_found", "Choose a role that exists.");
  return r;
};

/** Keep at least one active Admin so nobody can lock the shop out of its own system. */
function assertAnotherActiveAdmin(exceptUserId: string) {
  const admin = db.select().from(roles).where(eq(roles.systemKey, "admin")).get()!;
  const n =
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.roleId, admin.id), eq(users.active, true), isNull(users.deletedAt), ne(users.id, exceptUserId)))
      .get()?.n ?? 0;
  if (n === 0) throw new HttpError(409, "last_admin", "This is the last active Admin. Make another user Admin first.");
  return admin;
}

usersRouter.get(
  "/",
  requirePerm("users", "view"),
  h((_req, res) => {
    res.json({ users: db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name)).all().map(userOut) });
  }),
);

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  username: usernameRule,
  password: z.string().min(6).max(100),
  roleId: z.string().min(1),
  language: z.enum(["ar", "en"]).default("ar"),
});

usersRouter.post(
  "/",
  requirePerm("users", "create"),
  h((req, res) => {
    const body = parse(createSchema, req.body);
    roleExists(body.roleId);
    const id = newId();
    const row = { id, name: body.name, username: body.username, passwordHash: hashPassword(body.password), roleId: body.roleId, language: body.language };
    db.transaction((tx) => {
      tx.insert(users).values(row).run();
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "user", entityId: id, after: row });
    });
    res.status(201).json({ user: userOut(db.select().from(users).where(eq(users.id, id)).get()!) });
  }),
);

const updateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  username: usernameRule,
  roleId: z.string().min(1),
  language: z.enum(["ar", "en"]),
  password: z.string().min(6).max(100).optional().or(z.literal("")),
});

usersRouter.put(
  "/:id",
  requirePerm("users", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(updateSchema, req.body);
    const before = db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get();
    if (!before) throw notFound("user");
    const newRole = roleExists(body.roleId);
    const oldRole = db.select().from(roles).where(eq(roles.id, before.roleId)).get();
    if (oldRole?.systemKey === "admin" && newRole.systemKey !== "admin" && before.active) assertAnotherActiveAdmin(id);
    const patch: Partial<typeof users.$inferInsert> = {
      name: body.name,
      username: body.username,
      roleId: body.roleId,
      language: body.language,
      updatedAt: nowIso(),
      syncedAt: null,
    };
    if (body.password) patch.passwordHash = hashPassword(body.password);
    db.transaction((tx) => {
      tx.update(users).set(patch).where(eq(users.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "user", entityId: id, before, after: { ...before, ...patch } });
    });
    res.json({ user: userOut(db.select().from(users).where(eq(users.id, id)).get()!) });
  }),
);

usersRouter.post(
  "/:id/active",
  requirePerm("users", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const before = db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get();
    if (!before) throw notFound("user");
    if (!active) {
      if (id === req.user!.id) throw new HttpError(409, "self_deactivate", "You cannot deactivate your own user.");
      const role = db.select().from(roles).where(eq(roles.id, before.roleId)).get();
      if (role?.systemKey === "admin") assertAnotherActiveAdmin(id);
    }
    db.transaction((tx) => {
      tx.update(users).set({ active, updatedAt: nowIso(), syncedAt: null }).where(eq(users.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "user", entityId: id, before: { active: before.active }, after: { active } });
    });
    res.json({ user: userOut(db.select().from(users).where(eq(users.id, id)).get()!) });
  }),
);
