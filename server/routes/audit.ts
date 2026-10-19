import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { auditLog, users } from "../db/schema.js";
import { requirePerm } from "../lib/auth.js";
import { h, parse } from "../lib/util.js";

export const auditRouter = Router();

const query = z.object({
  entity: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(), // YYYY-MM-DD
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

auditRouter.get(
  "/",
  requirePerm("audit", "view"),
  h((req, res) => {
    const q = parse(query, req.query);
    const where: SQL[] = [];
    if (q.entity) where.push(eq(auditLog.entity, q.entity));
    if (q.userId) where.push(eq(auditLog.userId, q.userId));
    if (q.action) where.push(eq(auditLog.action, q.action as never));
    if (q.from) where.push(gte(auditLog.createdAt, `${q.from}T00:00:00.000Z`));
    if (q.to) where.push(lte(auditLog.createdAt, `${q.to}T23:59:59.999Z`));
    const cond = where.length ? and(...where) : undefined;
    const total = db.select({ n: count() }).from(auditLog).where(cond).get()?.n ?? 0;
    const rows = db
      .select({ entry: auditLog, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(cond)
      .orderBy(desc(auditLog.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    res.json({
      total,
      page: q.page,
      pageSize: q.pageSize,
      entries: rows.map((r) => ({
        ...r.entry,
        userName: r.userName,
        before: r.entry.beforeJson ? JSON.parse(r.entry.beforeJson) : null,
        after: r.entry.afterJson ? JSON.parse(r.entry.afterJson) : null,
      })),
    });
  }),
);
