import { Router } from "express";
import { orderIdFromLinkKey } from "../lib/receiptLink.js";
import { h, HttpError } from "../lib/util.js";
import { publicReceiptOf } from "./orders.js";

/** No login: the signed link from the receipt's QR code is the permission to see that one receipt. */
export const publicReceiptRouter = Router();

publicReceiptRouter.get(
  "/:key",
  h((req, res) => {
    const id = orderIdFromLinkKey(String(req.params.key));
    if (!id) throw new HttpError(404, "receipt_link_invalid", "This receipt link is not valid.");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json({ receipt: publicReceiptOf(id) });
  }),
);
