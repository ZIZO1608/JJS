import { and, eq, isNull, sql } from "drizzle-orm";
import type { Currency } from "../../shared/money.js";
import { boxMoves, cashBoxes, clientMoves, paymentMethods } from "../db/schema.js";
import { convert, roundMoney, round4, toUsd, type Q } from "../lib/biz.js";
import { HttpError, newId } from "../lib/util.js";

type BoxMoveType = (typeof boxMoves.$inferInsert)["type"];

export const boxBalance = (tx: Q, boxId: string) =>
  tx.select({ s: sql<number>`coalesce(sum(${boxMoves.amount}),0)` }).from(boxMoves).where(and(eq(boxMoves.boxId, boxId), isNull(boxMoves.deletedAt))).get()?.s ?? 0;

export const clientBalanceUsd = (tx: Q, clientId: string) =>
  round4(tx.select({ s: sql<number>`coalesce(sum(${clientMoves.amountUsd}),0)` }).from(clientMoves).where(and(eq(clientMoves.clientId, clientId), isNull(clientMoves.deletedAt))).get()?.s ?? 0);

export function getBox(tx: Q, boxId: string) {
  const b = tx.select().from(cashBoxes).where(and(eq(cashBoxes.id, boxId), isNull(cashBoxes.deletedAt))).get();
  if (!b) throw new HttpError(400, "box_not_found", "Choose a cash box that exists.");
  return b;
}

export function systemBox(tx: Q, key: "main_cash" | "sham") {
  const b = tx.select().from(cashBoxes).where(and(eq(cashBoxes.systemKey, key), isNull(cashBoxes.deletedAt))).get();
  if (!b) throw new HttpError(500, "box_missing", `The ${key} box is missing.`);
  return b;
}

export function getMethod(tx: Q, id: string) {
  const m = tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, id), isNull(paymentMethods.deletedAt), eq(paymentMethods.active, true))).get();
  if (!m) throw new HttpError(400, "method_not_found", "Choose a payment method.");
  return m;
}

/**
 * Money into (+) or out of (−) a box. The amount is given in any currency and stored
 * in the box's own currency, at today's rate, so counting the box matches the books.
 */
export function addBoxMove(
  tx: Q,
  p: { boxId: string; type: BoxMoveType; amount: number; currency: Currency; rate: number | null; refType?: string; refId?: string; note?: string; userId: string | null; date: string },
) {
  const box = getBox(tx, p.boxId);
  const amount = roundMoney(convert(p.amount, p.currency, box.currency, p.rate), box.currency);
  const id = newId();
  tx.insert(boxMoves)
    .values({
      id,
      boxId: box.id,
      type: p.type,
      amount,
      currency: box.currency,
      fxRate: p.rate,
      amountUsd: round4(toUsd(p.amount, p.currency, p.rate)),
      refType: p.refType ?? null,
      refId: p.refId ?? null,
      note: p.note ?? "",
      userId: p.userId,
      businessDate: p.date,
    })
    .run();
  return { id, amount, box };
}

export function addClientMove(
  tx: Q,
  p: { clientId: string; type: (typeof clientMoves.$inferInsert)["type"]; amount: number; currency: Currency; rate: number | null; orderId?: string; paymentId?: string; note?: string; userId: string | null; date: string },
) {
  tx.insert(clientMoves)
    .values({
      id: newId(),
      clientId: p.clientId,
      type: p.type,
      amount: p.amount,
      currency: p.currency,
      fxRate: p.rate,
      amountUsd: round4(toUsd(p.amount, p.currency, p.rate)),
      orderId: p.orderId ?? null,
      paymentId: p.paymentId ?? null,
      note: p.note ?? "",
      userId: p.userId,
      businessDate: p.date,
    })
    .run();
}

/** A delivery person hands all the cash they collected to the main box. Returns the amount moved (box currency). */
export function handOverRepCash(tx: Q, boxId: string, userId: string, date: string, rate: number | null) {
  const rep = getBox(tx, boxId);
  if (rep.kind !== "rep") throw new HttpError(400, "not_rep_box", "This is not a delivery person's box.");
  const amount = boxBalance(tx, rep.id);
  if (amount <= 0) return { amount: 0, currency: rep.currency };
  const main = systemBox(tx, "main_cash");
  addBoxMove(tx, { boxId: rep.id, type: "handover", amount: -amount, currency: rep.currency, rate, refType: "handover", userId, date });
  addBoxMove(tx, { boxId: main.id, type: "handover", amount, currency: rep.currency, rate, refType: "handover", userId, date });
  return { amount, currency: rep.currency };
}
