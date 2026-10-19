import { and, count, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { roles, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import {
  checkLoginLock,
  checkPassword,
  clearLoginFailures,
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  publicUser,
  recordLoginFailure,
  requireAuth,
} from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { h, HttpError, newId, nowIso, parse } from "../lib/util.js";

export const authRouter = Router();

const needsSetup = () => (db.select({ n: count() }).from(users).get()?.n ?? 0) === 0;

authRouter.get(
  "/status",
  h((_req, res) => {
    const b = getSetting("business");
    res.json({ needsSetup: needsSetup(), business: { nameAr: b.nameAr, nameEn: b.nameEn, logo: b.logo } });
  }),
);

const setupSchema = z.object({
  businessNameAr: z.string().trim().min(1).max(80),
  businessNameEn: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(60),
  username: z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9._-]+$/, "Use English letters, numbers, dot, dash or underscore"),
  password: z.string().min(6).max(100),
  language: z.enum(["ar", "en"]),
});

/** First run only: creates the business name and the first Admin. Refused once any user exists. */
authRouter.post(
  "/setup",
  h((req, res) => {
    if (!needsSetup()) throw new HttpError(409, "already_set_up", "This system is already set up. Log in instead.");
    const body = parse(setupSchema, req.body);
    const admin = db.select().from(roles).where(eq(roles.systemKey, "admin")).get();
    if (!admin) throw new HttpError(500, "no_admin_role", "The Admin role is missing. Restart the app to re-seed.");
    const id = newId();
    db.transaction((tx) => {
      tx.insert(users)
        .values({ id, name: body.name, username: body.username.toLowerCase(), passwordHash: hashPassword(body.password), roleId: admin.id, language: body.language })
        .run();
      setSetting("business", { ...getSetting("business"), nameAr: body.businessNameAr, nameEn: body.businessNameEn }, tx);
      writeAudit(tx, { userId: id, action: "setup", entity: "system", after: { business: body.businessNameEn, admin: body.username } });
    });
    createSession(res, id);
    res.status(201).json({ user: publicUser(loadUser(id)!) });
  }),
);

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

authRouter.post(
  "/login",
  h((req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    checkLoginLock(username);
    const u = db
      .select()
      .from(users)
      .where(and(eq(users.username, username.toLowerCase()), isNull(users.deletedAt)))
      .get();
    if (!u || !checkPassword(password, u.passwordHash)) {
      recordLoginFailure(username);
      throw new HttpError(401, "wrong_credentials", "The username or password is wrong.");
    }
    if (!u.active) throw new HttpError(403, "user_inactive", "This user is deactivated. Ask the admin to activate it.");
    clearLoginFailures(username);
    createSession(res, u.id);
    writeAudit(db, { userId: u.id, action: "login", entity: "user", entityId: u.id });
    res.json({ user: publicUser(loadUser(u.id)!) });
  }),
);

authRouter.post(
  "/logout",
  h((req, res) => {
    if (req.user) writeAudit(db, { userId: req.user.id, action: "logout", entity: "user", entityId: req.user.id });
    destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  h((req, res) => res.json({ user: publicUser(req.user!) })),
);

authRouter.put(
  "/me/language",
  requireAuth,
  h((req, res) => {
    const { language } = parse(z.object({ language: z.enum(["ar", "en"]) }), req.body);
    db.update(users).set({ language, updatedAt: nowIso(), syncedAt: null }).where(eq(users.id, req.user!.id)).run();
    res.json({ user: publicUser(loadUser(req.user!.id)!) });
  }),
);

authRouter.put(
  "/me/password",
  requireAuth,
  h((req, res) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(6).max(100) }), req.body);
    const u = db.select().from(users).where(eq(users.id, req.user!.id)).get()!;
    if (!checkPassword(body.current, u.passwordHash)) throw new HttpError(400, "wrong_password", "The current password is wrong.");
    db.update(users).set({ passwordHash: hashPassword(body.next), updatedAt: nowIso(), syncedAt: null }).where(eq(users.id, u.id)).run();
    writeAudit(db, { userId: u.id, action: "edit", entity: "user", entityId: u.id, after: { password: "changed" } });
    res.json({ ok: true });
  }),
);
