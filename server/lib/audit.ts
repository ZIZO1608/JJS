import { auditLog } from "../db/schema.js";
import type { DB, Tx } from "../db/client.js";
import { newId } from "./util.js";

type AuditAction = (typeof auditLog.$inferInsert)["action"];

const SECRET_KEYS = new Set(["passwordHash", "password", "apiKey"]);
/** Never store secrets in the audit log. */
const scrub = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.has(k) ? "•••" : scrub(v)]),
  );
};

export function writeAudit(
  tx: DB | Tx,
  entry: { userId: string | null; action: AuditAction; entity: string; entityId?: string | null; before?: unknown; after?: unknown },
) {
  tx.insert(auditLog)
    .values({
      id: newId(),
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      beforeJson: entry.before === undefined ? null : JSON.stringify(scrub(entry.before)),
      afterJson: entry.after === undefined ? null : JSON.stringify(scrub(entry.after)),
    })
    .run();
}
