import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { ACTIONS, DEFAULT_ROLE_PERMISSIONS, MODULES } from "../../shared/permissions.js";
import { db } from "../db/client.js";
import { permissions, roles, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm, rolePermissions } from "../lib/auth.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";

export const rolesRouter = Router();

const VALID = new Set(MODULES.flatMap((m) => ACTIONS.map((a) => `${m}:${a}`)));
const permList = z
  .array(z.string())
  .max(VALID.size)
  .transform((list) => [...new Set(list)])
  .refine((list) => list.every((p) => VALID.has(p)), "Unknown permission");

const roleOut = (r: typeof roles.$inferSelect) => ({
  id: r.id,
  nameAr: r.nameAr,
  nameEn: r.nameEn,
  systemKey: r.systemKey,
  permissions: [...rolePermissions(r.id)],
  userCount: db.select({ n: count() }).from(users).where(and(eq(users.roleId, r.id), isNull(users.deletedAt))).get()?.n ?? 0,
});

function replacePermissions(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], roleId: string, list: string[]) {
  tx.delete(permissions).where(eq(permissions.roleId, roleId)).run();
  for (const p of list) {
    const [module, action] = p.split(":") as [string, string];
    tx.insert(permissions).values({ id: newId(), roleId, module, action }).run();
  }
}

rolesRouter.get(
  "/",
  requirePerm("roles", "view"),
  h((_req, res) => {
    const list = db.select().from(roles).where(isNull(roles.deletedAt)).orderBy(asc(roles.createdAt)).all();
    res.json({ roles: list.map(roleOut) });
  }),
);

const roleSchema = z.object({
  nameAr: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(40),
  permissions: permList,
});

rolesRouter.post(
  "/",
  requirePerm("roles", "create"),
  h((req, res) => {
    const body = parse(roleSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      tx.insert(roles).values({ id, nameAr: body.nameAr, nameEn: body.nameEn }).run();
      replacePermissions(tx, id, body.permissions);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "role", entityId: id, after: body });
    });
    res.status(201).json({ role: roleOut(db.select().from(roles).where(eq(roles.id, id)).get()!) });
  }),
);

rolesRouter.put(
  "/:id",
  requirePerm("roles", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(roleSchema, req.body);
    const before = db.select().from(roles).where(and(eq(roles.id, id), isNull(roles.deletedAt))).get();
    if (!before) throw notFound("role");
    // The Admin role always keeps every permission so the shop can never lock itself out.
    const list = before.systemKey === "admin" ? DEFAULT_ROLE_PERMISSIONS.admin : body.permissions;
    const beforePerms = [...rolePermissions(id)];
    db.transaction((tx) => {
      tx.update(roles).set({ nameAr: body.nameAr, nameEn: body.nameEn, updatedAt: nowIso(), syncedAt: null }).where(eq(roles.id, id)).run();
      replacePermissions(tx, id, list);
      writeAudit(tx, {
        userId: req.user!.id,
        action: "edit",
        entity: "role",
        entityId: id,
        before: { nameAr: before.nameAr, nameEn: before.nameEn, permissions: beforePerms },
        after: { nameAr: body.nameAr, nameEn: body.nameEn, permissions: list },
      });
    });
    res.json({ role: roleOut(db.select().from(roles).where(eq(roles.id, id)).get()!) });
  }),
);

rolesRouter.delete(
  "/:id",
  requirePerm("roles", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const r = db.select().from(roles).where(and(eq(roles.id, id), isNull(roles.deletedAt))).get();
    if (!r) throw notFound("role");
    if (r.systemKey) throw new HttpError(409, "system_role", "Admin, Manager and Member cannot be deleted.");
    const inUse = db.select({ n: count() }).from(users).where(and(eq(users.roleId, id), isNull(users.deletedAt))).get()?.n ?? 0;
    if (inUse > 0) throw new HttpError(409, "role_in_use", `${inUse} user(s) still have this role. Move them to another role first.`, { users: inUse });
    db.transaction((tx) => {
      tx.update(roles).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(roles.id, id)).run();
      tx.delete(permissions).where(eq(permissions.roleId, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "role", entityId: id, before: { nameAr: r.nameAr, nameEn: r.nameEn } });
    });
    res.json({ ok: true });
  }),
);
