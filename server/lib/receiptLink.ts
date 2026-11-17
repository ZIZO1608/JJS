import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../env.js";

/**
 * Receipt links for the QR code on printed receipts: `<orderId>.<signature>`. Only this server can make a valid
 * signature, so nobody can open someone else's receipt by guessing or counting order ids.
 *
 * The key lives in its own file in the data folder (not in the settings table), so no settings screen or sync can
 * ever send it out. Deleting the file makes every printed receipt link stop working.
 */
const KEY_FILE = () => path.join(DATA_DIR, "receipt-link.key");
const SIG_LEN = 16; // base64url characters = 96 bits

let key: Buffer | null = null;
function secret(): Buffer {
  if (key) return key;
  try {
    const saved = Buffer.from(fs.readFileSync(KEY_FILE(), "utf8").trim(), "hex");
    if (saved.length >= 32) return (key = saved);
  } catch {
    /* first use: make one below */
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE(), fresh.toString("hex"), { mode: 0o600 });
  return (key = fresh);
}

const sign = (orderId: string) => crypto.createHmac("sha256", secret()).update(`receipt:${orderId}`).digest("base64url").slice(0, SIG_LEN);

/** The part of the link after `/r/`. */
export const receiptLinkKey = (orderId: string) => `${orderId}.${sign(orderId)}`;

/** The order id inside a link key, or null when the key is malformed or the signature is wrong. */
export function orderIdFromLinkKey(linkKey: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]+)$/.exec(linkKey);
  if (!m) return null;
  const want = Buffer.from(sign(m[1]!));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? m[1]! : null;
}
