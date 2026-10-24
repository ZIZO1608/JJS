import crypto from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { clientAccounts, clientSessions, clients } from "../db/schema.js";
import { SESSION_DAYS } from "../env.js";
import type { Q } from "./biz.js";
import { HttpError } from "./util.js";

/**
 * Client portal logins. A separate cookie, table and request field from staff logins,
 * so a client session can never pass a staff permission check (req.user stays empty). Not `req.client`: Node already uses that name for the socket.
 */
export const CLIENT_COOKIE = "jjs_client";

export interface AuthClient {
  accountId: string;
  clientId: string;
  name: string;
  username: string;
  language: "ar" | "en";
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalClient?: AuthClient;
    }
  }
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createClientSession(res: Response, accountId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.insert(clientSessions).values({ tokenHash: hashToken(token), accountId, expiresAt: expires.toISOString() }).run();
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: res.req.secure, expires, path: "/" });
}

export function destroyClientSession(req: Request, res: Response) {
  const token = req.cookies?.[CLIENT_COOKIE];
  if (token) db.delete(clientSessions).where(eq(clientSessions.tokenHash, hashToken(token))).run();
  res.clearCookie(CLIENT_COOKIE, { path: "/" });
}

export function loadClient(accountId: string): AuthClient | null {
  const row = db
    .select({ a: clientAccounts, c: clients })
    .from(clientAccounts)
    .innerJoin(clients, eq(clientAccounts.clientId, clients.id))
    .where(and(eq(clientAccounts.id, accountId), eq(clientAccounts.active, true), isNull(clientAccounts.deletedAt), eq(clients.active, true), isNull(clients.deletedAt)))
    .get();
  if (!row) return null;
  return { accountId: row.a.id, clientId: row.c.id, name: row.c.name, username: row.a.username, language: row.c.receiptLanguage, mustChangePassword: row.a.mustChangePassword };
}

/** Attaches req.portalClient when a valid portal cookie is present. Never rejects. */
export function clientSessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[CLIENT_COOKIE];
  if (token) {
    const s = db
      .select()
      .from(clientSessions)
      .where(and(eq(clientSessions.tokenHash, hashToken(token)), gt(clientSessions.expiresAt, new Date().toISOString())))
      .get();
    if (s) req.portalClient = loadClient(s.accountId) ?? undefined;
  }
  next();
}

export function requireClient(req: Request, _res: Response, next: NextFunction) {
  if (!req.portalClient) return next(new HttpError(401, "not_logged_in", "Please log in."));
  next();
}

/** Readable passwords: no 0/O, 1/l/I look-alikes. */
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const generatePassword = (length = 8) => Array.from(crypto.randomBytes(length), (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");

const TRANSLIT: Record<string, string> = {
  ا: "a", أ: "a", إ: "e", آ: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "th", ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d",
  ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "a", و: "w", ي: "y", ى: "a", ئ: "e", ؤ: "o", ء: "",
};

/** A username from the client's name (Arabic transliterated), else from the phone, made unique. */
export function suggestUsername(tx: Q, client: { name: string; phone: string }, exceptAccountId?: string) {
  const fromName = [...client.name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20);
  const digits = client.phone.replace(/\D/g, "");
  let base = fromName.length >= 3 ? fromName : digits.length >= 6 ? `c${digits.slice(-8)}` : `client${fromName}`;
  base = base.replace(/\.+$/, "") || "client";
  const taken = (u: string) =>
    !!tx
      .select({ id: clientAccounts.id })
      .from(clientAccounts)
      .where(and(eq(clientAccounts.username, u), exceptAccountId ? ne(clientAccounts.id, exceptAccountId) : undefined))
      .get();
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}${i}`)) return `${base}${i}`;
  return `${base}${crypto.randomInt(1000, 99999)}`;
}
