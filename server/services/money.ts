import { and, asc, eq, isNull, sql } from "drizzle-orm";
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

/** Money physically leaving a box: refused when the box does not hold that much. */
export function payFromBox(tx: Q, p: Parameters<typeof addBoxMove>[1]) {
  const box = getBox(tx, p.boxId);
  const out = roundMoney(convert(-p.amount, p.currency, box.currency, p.rate), box.currency);
  if (out > boxBalance(tx, box.id) + 0.001) throw new HttpError(409, "not_enough", "There is not that much money in the box.");
  return addBoxMove(tx, p);
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

/**
 * The charges a client has not paid yet, oldest first, with what is left of each. They add up to what the client owes.
 * Money tied to an invoice (paid at the door, a cancel or a return) settles that invoice first;
 * account payments and whatever is left over settle the oldest charges.
 */
export function openClientCharges(tx: Q, clientId: string) {
  const moves = tx.select().from(clientMoves).where(and(eq(clientMoves.clientId, clientId), isNull(clientMoves.deletedAt))).orderBy(asc(clientMoves.createdAt)).all();
  const chargedTo = new Map<string, number>();
  const paidTo = new Map<string, number>();
  for (const m of moves) {
    if (!m.orderId) continue;
    const into = m.amountUsd < 0 ? chargedTo : paidTo;
    into.set(m.orderId, (into.get(m.orderId) ?? 0) + Math.abs(m.amountUsd));
  }
  // per invoice: how much of its own money goes to its own charge (used once on each side)
  const ownForCharge = new Map<string, number>();
  const ownFromPay = new Map<string, number>();
  for (const [orderId, charged] of chargedTo) {
    const own = Math.min(charged, paidTo.get(orderId) ?? 0);
    ownForCharge.set(orderId, own);
    ownFromPay.set(orderId, own);
  }
  const open: { id: string; date: string; at: string; type: string; orderId: string | null; note: string; usd: number }[] = [];
  let credit = 0;
  for (const m of moves) {
    if (m.amountUsd < 0) {
      let owed = -m.amountUsd;
      if (m.orderId) {
        const own = Math.min(owed, ownForCharge.get(m.orderId) ?? 0);
        ownForCharge.set(m.orderId, (ownForCharge.get(m.orderId) ?? 0) - own);
        owed -= own;
      }
      const use = Math.min(credit, owed);
      credit -= use;
      owed -= use;
      if (owed > 0.0001) open.push({ id: m.id, date: m.businessDate, at: m.createdAt, type: m.type, orderId: m.orderId, note: m.note, usd: owed });
    } else {
      let pay = m.amountUsd;
      if (m.orderId) {
        const own = Math.min(pay, ownFromPay.get(m.orderId) ?? 0);
        ownFromPay.set(m.orderId, (ownFromPay.get(m.orderId) ?? 0) - own);
        pay -= own;
      }
      while (pay > 0.0001 && open.length) {
        const first = open[0]!;
        const use = Math.min(pay, first.usd);
        first.usd -= use;
        pay -= use;
        if (first.usd <= 0.0001) open.shift();
      }
      credit += pay;
    }
  }
  return open;
}
