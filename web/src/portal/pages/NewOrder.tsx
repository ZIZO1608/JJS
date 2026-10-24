import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import type { Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { Sheet, useMoney } from "../shared";

interface MenuOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
  currency: Currency;
}
interface MenuGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}
interface MenuProduct {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  allergens: string;
  price: number;
  currency: Currency;
  special: boolean;
  photo: string;
  groupIds: string[];
}
interface Menu {
  categories: { id: string; nameAr: string; nameEn: string }[];
  products: MenuProduct[];
  groups: MenuGroup[];
}
interface Quote {
  currency: Currency;
  lines: { productId: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  discountPct: number;
  freeItems: number;
  taxes: { nameAr: string; nameEn: string; amount: number }[];
  deliveryFee: number;
  total: number;
  itemsCount: number;
}
interface CartLine {
  key: string;
  productId: string;
  optionIds: string[];
  qty: number;
}

const DRAFT_KEY = "jjs.portal.cart";
const readDraft = (): CartLine[] => {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveDraft = (lines: CartLine[]) => {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(lines));
  } catch {
    /* private mode: the cart just isn't kept */
  }
};
const keyOf = (productId: string, optionIds: string[]) => `${productId}|${[...optionIds].sort().join(",")}`;

function Stepper({ qty, onChange, big }: { qty: number; onChange: (q: number) => void; big?: boolean }) {
  const s = big ? "h-10 w-10 text-xl" : "h-8 w-8 text-lg";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-sunken p-0.5">
      <button className={`grid ${s} place-items-center rounded-full bg-surface font-bold shadow-sm active:scale-95`} onClick={() => onChange(qty - 1)} aria-label="−">
        −
      </button>
      <span className="min-w-7 text-center font-bold num">{qty}</span>
      <button className={`grid ${s} place-items-center rounded-full bg-brand font-bold text-white shadow-sm active:scale-95`} onClick={() => onChange(qty + 1)} aria-label="+">
        +
      </button>
    </div>
  );
}

/** Pick add-ons for one product before it goes in the cart. */
function OptionsSheet({ product, groups, onAdd, onClose }: { product: MenuProduct; groups: MenuGroup[]; onAdd: (optionIds: string[], qty: number) => void; onClose: () => void }) {
  const { tr, pick } = useI18n();
  const m = useMoney();
  const [chosen, setChosen] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const toggle = (g: MenuGroup, id: string) =>
    setChosen((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      const inGroup = cur.filter((x) => g.options.some((o) => o.id === x));
      if (g.maxSelect === 1) return [...cur.filter((x) => !inGroup.includes(x)), id];
      if (inGroup.length >= g.maxSelect) return cur;
      return [...cur, id];
    });
  const missing = groups.find((g) => chosen.filter((x) => g.options.some((o) => o.id === x)).length < g.minSelect);
  return (
    <Sheet
      title={pick(product)}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <Stepper qty={qty} onChange={(q) => setQty(Math.max(1, q))} big />
          <button className="btn btn-primary flex-1 !py-3" disabled={!!missing} onClick={() => onAdd(chosen, qty)}>
            {missing ? tr(`اختر من «${pick(missing)}»`, `Choose from “${pick(missing)}”`) : tr("أضف إلى السلة", "Add to cart")}
          </button>
        </div>
      }
    >
      {product.photo && <img src={product.photo} alt="" className="mb-4 aspect-[16/9] w-full rounded-2xl object-cover" />}
      <div className="grid gap-5">
        {groups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 flex w-full items-center justify-between font-bold">
              {pick(g)}
              <span className="text-xs font-normal text-faint">
                {g.minSelect > 0 ? tr("مطلوب", "Required") : tr("اختياري", "Optional")}
                {g.maxSelect > 1 ? tr(` · حتى ${g.maxSelect}`, ` · up to ${g.maxSelect}`) : ""}
              </span>
            </legend>
            <div className="grid gap-2">
              {g.options.map((o) => {
                const on = chosen.includes(o.id);
                return (
                  <button key={o.id} onClick={() => toggle(g, o.id)} aria-pressed={on} className={`flex items-center justify-between rounded-xl border-2 px-3.5 py-2.5 text-start ${on ? "border-brand bg-brand/10" : "border-line"}`}>
                    <span className="flex items-center gap-2.5">
                      <span className={`grid h-5 w-5 place-items-center ${g.maxSelect === 1 ? "rounded-full" : "rounded-md"} border-2 text-[11px] ${on ? "border-brand bg-brand text-white" : "border-line"}`} aria-hidden>
                        {on ? "✓" : ""}
                      </span>
                      {pick(o)}
                    </span>
                    {o.priceDelta !== 0 && <span className="text-sm text-muted num ltr">+{m(o.priceDelta, o.currency)}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </Sheet>
  );
}

function Toggle<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; icon: string; label: string; sub?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it) => (
        <button key={it.key} onClick={() => onChange(it.key)} aria-pressed={value === it.key} className={`rounded-2xl border-2 p-3 text-start ${value === it.key ? "border-brand bg-brand/10" : "border-line"}`}>
          <div className="text-xl" aria-hidden>
            {it.icon}
          </div>
          <div className="mt-1 font-bold leading-tight">{it.label}</div>
          {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
        </button>
      ))}
    </div>
  );
}

export function NewOrderPage() {
  const { tr, pick, err } = useI18n();
  const m = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: menu } = useData<Menu>("/portal/menu");
  const [cat, setCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>(readDraft);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [payment, setPayment] = useState<"on_account" | "on_delivery">("on_account");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ id: string; number: number } | null>(null);

  useEffect(() => saveDraft(cart), [cart]);

  // live price from the server (the client's own prices, discounts, subscription, taxes)
  useEffect(() => {
    if (!cart.length) {
      setQuote(null);
      return;
    }
    const id = setTimeout(() => {
      post<Quote>("/portal/quote", { fulfilment, lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, optionIds: l.optionIds })) })
        .then((q) => {
          setQuote(q);
          setQuoteError("");
        })
        .catch((e) => setQuoteError(err(e)));
    }, 250);
    return () => clearTimeout(id);
  }, [cart, fulfilment, err]);

  const products = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    return menu.products.filter((p) => (cat === "all" || p.categoryId === cat) && (!q || p.nameAr.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q)));
  }, [menu, cat, search]);

  if (sent) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <div className="portal-pop grid h-24 w-24 place-items-center rounded-full bg-good/15 text-5xl" aria-hidden>
          ✓
        </div>
        <h1 className="mt-5 text-2xl font-bold">{tr("تم إرسال طلبك!", "Order sent!")}</h1>
        <p className="mt-2 max-w-xs text-muted">{tr(`طلب #${sent.number} بانتظار موافقة المحل. سنرسل لك إشعاراً فور الرد.`, `Request #${sent.number} is waiting for the shop. You'll get a notification as soon as they answer.`)}</p>
        <div className="mt-6 grid w-full max-w-xs gap-2">
          <Link to={`/portal/orders/${sent.id}`} className="btn btn-primary w-full !py-3">
            {tr("تابع الطلب", "Follow the order")}
          </Link>
          <Link to="/portal" className="btn w-full !py-3">
            {tr("الرئيسية", "Home")}
          </Link>
        </div>
      </div>
    );
  }
  if (!menu) return <Spinner />;

  const groupsOf = (p: MenuProduct) => menu.groups.filter((g) => p.groupIds.includes(g.id) && g.options.length);
  const qtyOf = (productId: string) => cart.filter((l) => l.productId === productId).reduce((s, l) => s + l.qty, 0);
  const add = (productId: string, optionIds: string[], qty = 1) =>
    setCart((cur) => {
      const key = keyOf(productId, optionIds);
      const hit = cur.find((l) => l.key === key);
      return hit ? cur.map((l) => (l.key === key ? { ...l, qty: Math.min(1000, l.qty + qty) } : l)) : [...cur, { key, productId, optionIds, qty }];
    });
  const setQty = (key: string, qty: number) => setCart((cur) => (qty <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty: Math.min(1000, qty) } : l))));
  const tapProduct = (p: MenuProduct) => {
    if (groupsOf(p).length) setPicking(p);
    else add(p.id, []);
  };
  const productById = (id: string) => menu.products.find((p) => p.id === id);
  const optionName = (id: string) => {
    for (const g of menu.groups) {
      const o = g.options.find((x) => x.id === id);
      if (o) return pick(o);
    }
    return "";
  };
  const count = cart.reduce((s, l) => s + l.qty, 0);

  const send = async () => {
    setSending(true);
    try {
      const r = await post<{ id: string; number: number }>("/portal/order-requests", { fulfilment, paymentChoice: payment, note, lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, optionIds: l.optionIds })) });
      setCart([]);
      setNote("");
      setCheckout(false);
      setSent(r);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">{tr("القائمة", "Menu")}</h1>
      <input className="input mb-3 !rounded-full !py-2.5 !text-base" placeholder={tr("ابحث…", "Search…")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: "all", nameAr: "الكل", nameEn: "All" }, ...menu.categories].map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${cat === c.id ? "bg-ink text-bg" : "bg-surface text-muted ring-1 ring-line"}`}>
            {pick(c)}
          </button>
        ))}
      </div>

      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-faint">{tr("لا منتجات هنا", "Nothing here")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map((p) => {
            const q = qtyOf(p.id);
            const simple = !groupsOf(p).length;
            const line = simple ? cart.find((l) => l.key === keyOf(p.id, [])) : undefined;
            return (
              <div key={p.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-surface ${q ? "border-brand ring-1 ring-brand" : "border-line"}`}>
                <button className="relative block aspect-[4/3] w-full bg-sunken" onClick={() => tapProduct(p)} aria-label={pick(p)}>
                  {p.photo ? <img src={p.photo} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-4xl" aria-hidden>🥪</span>}
                  {q > 0 && <span className="absolute end-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-white num">{q}</span>}
                  {p.special && <span className="absolute start-2 top-2 rounded-full bg-good px-2 py-0.5 text-[11px] font-bold text-white">{tr("سعرك", "Your price")}</span>}
                </button>
                <div className="flex flex-1 flex-col p-3">
                  <div className="line-clamp-2 font-semibold leading-snug">{pick(p)}</div>
                  <div className="mt-auto flex items-center justify-between gap-1 pt-2">
                    <span className="font-bold num ltr">{m(p.price, p.currency)}</span>
                    {line ? (
                      <Stepper qty={line.qty} onChange={(n) => setQty(line.key, n)} />
                    ) : (
                      <button className="grid h-8 w-8 place-items-center rounded-full bg-brand text-lg font-bold text-white active:scale-95" onClick={() => tapProduct(p)} aria-label={tr("أضف", "Add")}>
                        +
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 px-4">
          <button onClick={() => setCheckout(true)} className="portal-pop mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-ink px-5 py-3.5 text-bg shadow-xl active:scale-[0.99]">
            <span className="flex items-center gap-2 font-bold">
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm text-white num">{count}</span>
              {tr("عرض السلة", "View cart")}
            </span>
            <span className="font-bold num ltr">{quote ? m(quote.total, quote.currency) : "…"}</span>
          </button>
        </div>
      )}

      {picking && (
        <OptionsSheet
          product={picking}
          groups={groupsOf(picking)}
          onClose={() => setPicking(null)}
          onAdd={(ids, qty) => {
            add(picking.id, ids, qty);
            setPicking(null);
          }}
        />
      )}

      {checkout && (
        <Sheet
          title={tr("سلتك", "Your cart")}
          onClose={() => setCheckout(false)}
          footer={
            <button className="btn btn-primary w-full !py-3.5 text-base" disabled={sending || !quote || !!quoteError} onClick={send}>
              {sending ? (
                "…"
              ) : (
                <>
                  {tr("أرسل الطلب", "Send order")} · <span className="num ltr">{quote ? m(quote.total, quote.currency) : ""}</span>
                </>
              )}
            </button>
          }
        >
          <div className="grid gap-2">
            {cart.map((l) => {
              const p = productById(l.productId);
              const ql = quote?.lines[cart.indexOf(l)];
              return (
                <div key={l.key} className="flex items-center gap-3 rounded-2xl bg-sunken/60 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p ? pick(p) : "—"}</div>
                    {l.optionIds.length > 0 && <div className="truncate text-xs text-muted">{l.optionIds.map(optionName).join("، ")}</div>}
                    {ql && (
                      <div className="text-sm text-muted num ltr text-start">
                        {m(ql.lineTotal, quote!.currency)}
                        {ql.freeQty > 0 && <span className="ms-1 text-good">({tr(`${ql.freeQty} مجاناً`, `${ql.freeQty} free`)})</span>}
                      </div>
                    )}
                  </div>
                  <Stepper qty={l.qty} onChange={(n) => setQty(l.key, n)} />
                </div>
              );
            })}
            {cart.length === 0 && <p className="py-6 text-center text-faint">{tr("السلة فارغة", "The cart is empty")}</p>}
          </div>

          <h3 className="mb-2 mt-5 font-bold">{tr("الاستلام", "How to get it")}</h3>
          <Toggle
            value={fulfilment}
            onChange={setFulfilment}
            items={[
              { key: "pickup", icon: "🛍️", label: tr("استلام من المحل", "Pick up") },
              { key: "delivery", icon: "🛵", label: tr("توصيل", "Delivery") },
            ]}
          />

          <h3 className="mb-2 mt-5 font-bold">{tr("الدفع", "Payment")}</h3>
          <Toggle
            value={payment}
            onChange={setPayment}
            items={[
              { key: "on_account", icon: "📒", label: tr("على الحساب", "On my account"), sub: tr("يُضاف لرصيدك", "Added to your balance") },
              { key: "on_delivery", icon: "💵", label: tr("عند الاستلام", "Pay on delivery"), sub: tr("ادفع عند الاستلام", "Pay when you receive it") },
            ]}
          />

          <h3 className="mb-2 mt-5 font-bold">{tr("ملاحظة", "Note")}</h3>
          <textarea className="input min-h-[72px] !text-base" maxLength={250} placeholder={tr("مثلاً: بدون بصل، الساعة 1 ظهراً…", "e.g. no onions, at 1 pm…")} value={note} onChange={(e) => setNote(e.target.value)} />

          {quote && (
            <dl className="mt-5 grid gap-1.5 rounded-2xl bg-sunken/60 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{tr("المجموع", "Subtotal")}</dt>
                <dd className="num ltr">{m(quote.subtotal, quote.currency)}</dd>
              </div>
              {quote.discount > 0 && (
                <div className="flex justify-between text-good">
                  <dt>{tr("الخصم", "Discount")}</dt>
                  <dd className="num ltr">−{m(quote.discount, quote.currency)}</dd>
                </div>
              )}
              {quote.taxes.map((t) => (
                <div key={t.nameEn} className="flex justify-between">
                  <dt className="text-muted">{pick(t)}</dt>
                  <dd className="num ltr">{m(t.amount, quote.currency)}</dd>
                </div>
              ))}
              {quote.deliveryFee > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">{tr("التوصيل", "Delivery")}</dt>
                  <dd className="num ltr">{m(quote.deliveryFee, quote.currency)}</dd>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-bold">
                <dt>{tr("الإجمالي", "Total")}</dt>
                <dd className="num ltr">{m(quote.total, quote.currency)}</dd>
              </div>
            </dl>
          )}
          {quoteError && <p className="mt-3 text-sm text-bad">{quoteError}</p>}
          <p className="mt-3 text-xs text-faint">{tr("يُرسل الطلب للمحل للموافقة. السعر النهائي يُثبّت عند القبول.", "The order goes to the shop for approval. The final price is set when it's accepted.")}</p>
        </Sheet>
      )}
    </div>
  );
}
