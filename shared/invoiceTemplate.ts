/** A client's own invoice design: saved on the client, used for every invoice printed for them. */
export interface InvoiceTemplate {
  /** Paper for this client; "default" follows Settings → Printing. */
  size: "default" | "a4" | "thermal";
  /** Heading of the invoice; empty = "Sales invoice". */
  title: string;
  /** Text above the item lines (a greeting, a contract number…). */
  intro: string;
  /** Text at the bottom; empty = the footer line from Settings → Printing. */
  footer: string;
  showLogo: boolean;
  showUnitPrice: boolean;
  /** The "client account" box with previous and new balance. */
  showAccount: boolean;
  /** Paid / remaining lines under the total. */
  showPayment: boolean;
  showSignatures: boolean;
  /** Colour of the heading and lines, as #rrggbb. */
  accent: string;
}

export const INVOICE_TEMPLATE_DEFAULTS: InvoiceTemplate = {
  size: "default",
  title: "",
  intro: "",
  footer: "",
  showLogo: true,
  showUnitPrice: true,
  showAccount: true,
  showPayment: true,
  showSignatures: true,
  accent: "#000000",
};

/** The stored JSON (or an empty string) → a full template, filling anything missing. */
export function readInvoiceTemplate(json: string | null | undefined): InvoiceTemplate {
  if (!json) return { ...INVOICE_TEMPLATE_DEFAULTS };
  try {
    const v = JSON.parse(json) as Partial<InvoiceTemplate>;
    return { ...INVOICE_TEMPLATE_DEFAULTS, ...(v && typeof v === "object" ? v : {}) };
  } catch {
    return { ...INVOICE_TEMPLATE_DEFAULTS };
  }
}
