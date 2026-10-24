import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications, permissions, users } from "../db/schema.js";
import type { Q } from "../lib/biz.js";
import { newId, nowIso } from "../lib/util.js";

export interface NotificationInput {
  kind: string;
  titleAr: string;
  titleEn: string;
  bodyAr?: string;
  bodyEn?: string;
  link?: string;
  refId?: string | null;
}

export type Recipient = { userId: string } | { clientId: string };

const insert = (tx: Q, to: Recipient, n: NotificationInput) =>
  tx.insert(notifications)
    .values({
      id: newId(),
      userId: "userId" in to ? to.userId : null,
      clientId: "clientId" in to ? to.clientId : null,
      kind: n.kind,
      titleAr: n.titleAr,
      titleEn: n.titleEn,
      bodyAr: n.bodyAr ?? "",
      bodyEn: n.bodyEn ?? "",
      link: n.link ?? "",
      refId: n.refId ?? null,
    })
    .run();

/** Every active staff user whose role may edit orders (admin and manager by default, not member). */
export function notifyStaff(tx: Q, n: NotificationInput) {
  const rows = tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(permissions, and(eq(permissions.roleId, users.roleId), eq(permissions.module, "orders"), eq(permissions.action, "edit"), isNull(permissions.deletedAt)))
    .where(and(eq(users.active, true), isNull(users.deletedAt)))
    .all();
  rows.forEach((u) => insert(tx, { userId: u.id }, n));
}

export const notifyClient = (tx: Q, clientId: string, n: NotificationInput) => insert(tx, { clientId }, n);

const whereFor = (to: Recipient) => ("userId" in to ? eq(notifications.userId, to.userId) : eq(notifications.clientId, to.clientId));

export const listNotifications = (tx: Q, to: Recipient, limit = 30) => tx.select().from(notifications).where(whereFor(to)).orderBy(desc(notifications.createdAt)).limit(limit).all();

export const unreadCount = (tx: Q, to: Recipient) => tx.select({ n: count() }).from(notifications).where(and(whereFor(to), isNull(notifications.readAt))).get()?.n ?? 0;

/** Marks the given ids as read, or all of them when ids is empty. Only the recipient's own rows. */
export function markRead(tx: Q, to: Recipient, ids: string[] = []) {
  tx.update(notifications)
    .set({ readAt: nowIso() })
    .where(and(whereFor(to), isNull(notifications.readAt), ids.length ? inArray(notifications.id, ids) : sql`1 = 1`))
    .run();
}
