import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { perm, type Action, type Module } from "../../shared/permissions.js";
import { db } from "../db/client.js";
import { permissions, roles, sessions, users } from "../db/schema.js";
import { SESSION_DAYS } from "../env.js";
import { HttpError } from "./util.js";

export const SESSION_COOKIE = "jjs_session";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  language: "ar" | "en";
  role: { id: string; nameAr: string; nameEn: string; systemKey: "admin" | "manager" | "member" | null };
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashPassword = (plain: string) => bcrypt.hashSync(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compareSync(plain, hash);
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createSession(res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: expires.toISOString() }).run();
  // Behind HTTPS (the online server) the cookie is never sent over plain http.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: res.req.secure, expires, path: "/" });
}

export function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function rolePermissions(roleId: string): Set<string> {
  const rows = db.select({ module: permissions.module, action: permissions.action }).from(permissions).where(eq(permissions.roleId, roleId)).all();
  return new Set(rows.map((r) => `${r.module}:${r.action}`));
}

export function loadUser(userId: string): AuthUser | null {
  const row = db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), eq(users.active, true), isNull(users.deletedAt)))
    .get();
  if (!row) return null;
  return {
    id: row.user.id,
    name: row.user.name,
    username: row.user.username,
    language: row.user.language,
    role: { id: row.role.id, nameAr: row.role.nameAr, nameEn: row.role.nameEn, systemKey: row.role.systemKey },
    permissions: rolePermissions(row.role.id),
  };
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const s = db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date().toISOString())))
      .get();
    if (s) req.user = loadUser(s.userId) ?? undefined;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "not_logged_in", "Please log in."));
  next();
}

export const can = (user: AuthUser | undefined, module: Module, action: Action) => !!user && user.permissions.has(perm(module, action));

/** Route guard: the API refuses with 403 whatever the UI shows. */
export const requirePerm = (module: Module, action: Action) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, "not_logged_in", "Please log in."));
  if (!can(req.user, module, action)) return next(new HttpError(403, "forbidden", `Your role cannot ${action} in ${module}.`));
  next();
};

/** Simple brute-force brake: 5 wrong passwords lock that username for 60 seconds. */
const failures = new Map<string, { count: number; until: number }>();
export function checkLoginLock(username: string) {
  const f = failures.get(username.toLowerCase());
  if (f && f.until > Date.now()) {
    throw new HttpError(429, "locked", "Too many wrong passwords. Wait a minute and try again.", { seconds: Math.ceil((f.until - Date.now()) / 1000) });
  }
}
export function recordLoginFailure(username: string) {
  const key = username.toLowerCase();
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) {
    f.until = Date.now() + 60_000;
    f.count = 0;
  }
  failures.set(key, f);
}
export const clearLoginFailures = (username: string) => failures.delete(username.toLowerCase());

export const publicUser = (u: AuthUser) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  language: u.language,
  role: u.role,
  permissions: [...u.permissions],
});
