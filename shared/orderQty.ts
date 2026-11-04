/** Orders come in fives: 5, 10, 15… The same rule for the client portal, the staff screens and the API. */
export const ORDER_QTY_STEP = 5;
export const ORDER_QTY_MAX = 1000;
export const ORDER_QTY_CHOICES = Array.from({ length: ORDER_QTY_MAX / ORDER_QTY_STEP }, (_, i) => (i + 1) * ORDER_QTY_STEP);

export const isOrderQty = (q: number) => Number.isInteger(q) && q >= ORDER_QTY_STEP && q <= ORDER_QTY_MAX && q % ORDER_QTY_STEP === 0;

/** Older carts and standing orders can hold any number: round up to the next allowed one. */
export const toOrderQty = (q: number) => Math.min(ORDER_QTY_MAX, Math.max(ORDER_QTY_STEP, Math.ceil(q / ORDER_QTY_STEP) * ORDER_QTY_STEP));
