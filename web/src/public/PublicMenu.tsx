import { useEffect, useMemo, useState } from "react";
import { money, type Currency } from "../lib/format";
import { useI18n, type Lang } from "../lib/i18n";

/** What /api/public/menu sends: only the products the admin switched on, never costs. */
interface MenuProduct {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  allergens: string;
  photo: string;
  price?: number;
  currency?: Currency;
}
interface MenuData {
  business: { nameAr: string; nameEn: string; phone: string; address: string; logo: string };
  page: {
    showPrices: boolean;
    whatsapp: string;
    heroTitleAr: string;
    heroTitleEn: string;
    heroSubtitleAr: string;
    heroSubtitleEn: string;
    aboutAr: string;
    aboutEn: string;
    hoursAr: string;
    hoursEn: string;
    instagram: string;
    facebook: string;
    mapUrl: string;
  };
  categories: { id: string; nameAr: string; nameEn: string; products: MenuProduct[] }[];
}

type Basket = Record<string, number>;
const BASKET_KEY = "jjs.menu.basket";

const readBasket = (): Basket => {
  try {
    const v = JSON.parse(localStorage.getItem(BASKET_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Basket) : {};
  } catch {
    return {};
  }
};
const saveBasket = (b: Basket) => {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(b));
  } catch {
    /* private window: the basket just isn't remembered */
  }
};

/** "Ar" or "En" field of an object, falling back to the other language when one is empty. */
const by = (lang: Lang) => (o: object, base: string) => {
  const r = o as Record<string, unknown>;
  const a = String(r[`${base}Ar`] ?? "");
  const e = String(r[`${base}En`] ?? "");
  return lang === "ar" ? a || e : e || a;
};

function useMenu() {
  const [data, setData] = useState<MenuData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off" | "error">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/public/menu", { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) return setState("off");
        if (!r.ok) return setState("error");
        setData((await r.json()) as MenuData);
        setState("ok");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);
  return { data, state };
}

const WaIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.3-1.95 1.34-.5.05-.97.23-3.27-.68-2.77-1.09-4.52-3.92-4.66-4.1-.13-.18-1.1-1.47-1.1-2.8 0-1.34.7-2 .95-2.27.25-.27.54-.34.72-.34h.52c.17 0 .4-.06.62.47.24.55.8 1.9.87 2.04.07.14.11.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.28-.12.56.16.27.7 1.16 1.51 1.88 1.04.93 1.92 1.21 2.19 1.35.27.14.43.11.59-.07.16-.18.68-.79.86-1.07.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.14.45.2.52.32.07.11.07.66-.17 1.34Z" />
  </svg>
);

export function PublicMenu() {
  const { lang, setLang, tr } = useI18n();
  const { data, state } = useMenu();
  const [basket, setBasket] = useState<Basket>(readBasket);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState({ name: "", address: "", note: "" });
  const pickT = by(lang);

  useEffect(() => saveBasket(basket), [basket]);
  useEffect(() => {
    if (data) document.title = `${pickT(data.business, "name")} · ${tr("المنيو", "Menu")}`;
  }, [data, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => new Map((data?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const))), [data]);
  // forget items the shop has since taken off the menu
  const lines = Object.entries(basket)
    .filter(([id, q]) => q > 0 && products.has(id))
    .map(([id, qty]) => ({ p: products.get(id)!, qty }));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const totals = lines.reduce<Partial<Record<Currency, number>>>((t, l) => {
    if (l.p.price === undefined || !l.p.currency) return t;
    t[l.p.currency] = (t[l.p.currency] ?? 0) + l.p.price * l.qty;
    return t;
  }, {});
  const totalText = (Object.entries(totals) as [Currency, number][]).map(([c, v]) => money(v, c, lang)).join(" + ");

  const add = (id: string, d: number) => setBasket((b) => ({ ...b, [id]: Math.max(0, Math.min(99, (b[id] ?? 0) + d)) }));

  if (state === "loading") return <div className="grid min-h-screen place-items-center text-faint">…</div>;
  if (state !== "ok" || !data) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <img src="/logo.png" alt="" className="mx-auto mb-4 h-20 w-auto" />
          <p className="text-lg font-semibold">{state === "off" ? tr("المنيو مش متاح هلّق.", "The menu isn't available right now.") : tr("ما قدرنا نفتح المنيو. جرّب كمان شوي.", "We couldn't load the menu. Please try again shortly.")}</p>
        </div>
      </div>
    );
  }

  const { business: biz, page } = data;
  const name = pickT(biz, "name");
  const wa = page.whatsapp.replace(/\D/g, "");
  const waUrl = (text: string) => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  const orderText = () =>
    [
      tr(`مرحبا ${name}، بدي اطلب:`, `Hi ${name}, I'd like to order:`),
      ...lines.map((l) => `• ${l.qty} × ${pickT(l.p, "name")}${l.p.price !== undefined && l.p.currency ? ` (${money(l.p.price * l.qty, l.p.currency, lang)})` : ""}`),
      totalText ? `${tr("المجموع", "Total")}: ${totalText}` : "",
      who.name.trim() ? `${tr("الاسم", "Name")}: ${who.name.trim()}` : "",
      who.address.trim() ? `${tr("العنوان", "Address")}: ${who.address.trim()}` : "",
      who.note.trim() ? `${tr("ملاحظة", "Note")}: ${who.note.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  const hello = tr(`مرحبا ${name} 👋`, `Hi ${name} 👋`);

  return (
    <div className="min-h-screen bg-bg pb-28">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <img src={biz.logo || "/logo.png"} alt="" className="h-9 w-auto" />
          <span className="truncate text-lg font-bold">{name}</span>
          <div className="ms-auto flex items-center gap-2">
            <button className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted hover:bg-sunken hover:text-ink" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              {lang === "ar" ? "English" : "عربي"}
            </button>
            {wa && (
              <a className="inline-flex items-center gap-1.5 rounded-full bg-[#25d366] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95" href={waUrl(hello)} target="_blank" rel="noreferrer">
                <WaIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{tr("واتساب", "WhatsApp")}</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />
        <div className="mx-auto grid max-w-5xl items-center gap-6 px-4 py-10 sm:grid-cols-[1fr_auto] sm:py-16">
          <div>
            <h1 className="text-balance text-3xl font-bold leading-tight sm:text-5xl">{pickT(page, "heroTitle") || name}</h1>
            {pickT(page, "heroSubtitle") && <p className="mt-3 max-w-xl text-pretty text-lg text-muted">{pickT(page, "heroSubtitle")}</p>}
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#menu" className="rounded-full bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:brightness-95">
                {tr("شوف المنيو", "See the menu")}
              </a>
              {wa && (
                <a className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 font-semibold hover:border-ink/30" href={waUrl(hello)} target="_blank" rel="noreferrer">
                  <WaIcon className="h-5 w-5 text-[#25d366]" />
                  {tr("احكينا", "Message us")}
                </a>
              )}
            </div>
          </div>
          <img src={biz.logo || "/logo.png"} alt="" className="hidden h-44 w-auto drop-shadow-sm sm:block" />
        </div>
      </section>

      {/* category chips */}
      <nav id="menu" className="sticky top-[57px] z-20 scroll-mt-16 border-y border-line/70 bg-bg/90 backdrop-blur" aria-label={tr("الأصناف", "Categories")}>
        <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2.5">
          {data.categories.map((c) => (
            <a key={c.id} href={`#c-${c.id}`} className="whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold hover:border-brand hover:text-brand">
              {pickT(c, "name")}
            </a>
          ))}
        </div>
      </nav>

      {/* products */}
      <main className="mx-auto max-w-5xl px-4">
        {data.categories.length === 0 && <p className="py-16 text-center text-muted">{tr("المنيو عم يتجهّز، ارجع لعنا قريباً.", "The menu is being prepared. Check back soon.")}</p>}
        {data.categories.map((c) => (
          <section key={c.id} id={`c-${c.id}`} className="scroll-mt-32 pt-8">
            <h2 className="mb-3 text-xl font-bold">{pickT(c, "name")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {c.products.map((p) => {
                const q = basket[p.id] ?? 0;
                const desc = pickT(p, "desc");
                return (
                  <article key={p.id} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-col">
                    {p.photo ? (
                      <img src={p.photo} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover sm:aspect-[4/3] sm:h-auto sm:w-full" />
                    ) : (
                      <div className="grid h-24 w-24 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand/80 to-brand text-3xl font-bold text-white sm:aspect-[4/3] sm:h-auto sm:w-full">
                        {pickT(p, "name").slice(0, 1)}
                      </div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="font-bold leading-snug">{pickT(p, "name")}</h3>
                      {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
                      {p.allergens && <p className="mt-0.5 text-xs text-faint">{tr("يحتوي", "Contains")}: {p.allergens}</p>}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <span className="font-bold num ltr">{p.price !== undefined && p.currency ? money(p.price, p.currency, lang) : ""}</span>
                        {wa &&
                          (q === 0 ? (
                            <button className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-bg hover:opacity-90" onClick={() => add(p.id, 1)}>
                              {tr("+ أضف", "+ Add")}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 rounded-full border border-line bg-sunken p-0.5">
                              <button className="grid h-8 w-8 place-items-center rounded-full bg-surface text-lg font-bold" aria-label={tr("أنقص", "Less")} onClick={() => add(p.id, -1)}>
                                −
                              </button>
                              <span className="w-6 text-center font-bold num">{q}</span>
                              <button className="grid h-8 w-8 place-items-center rounded-full bg-surface text-lg font-bold" aria-label={tr("زيد", "More")} onClick={() => add(p.id, 1)}>
                                +
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* footer */}
      <footer className="mt-14 border-t border-line bg-surface">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <img src={biz.logo || "/logo.png"} alt="" className="h-10 w-auto" />
              <span className="text-lg font-bold">{name}</span>
            </div>
            {pickT(page, "about") && <p className="mt-3 whitespace-pre-line text-sm text-muted">{pickT(page, "about")}</p>}
          </div>
          <div className="grid content-start gap-1.5 text-sm">
            <div className="font-bold">{tr("تواصل معنا", "Get in touch")}</div>
            {wa && (
              <a className="inline-flex items-center gap-1.5 hover:text-brand" href={waUrl(hello)} target="_blank" rel="noreferrer">
                <WaIcon className="h-4 w-4 text-[#25d366]" /> <span className="num ltr">+{wa}</span>
              </a>
            )}
            {biz.phone && (
              <a className="hover:text-brand" href={`tel:${biz.phone.replace(/[^\d+]/g, "")}`}>
                ☎ <span className="num ltr">{biz.phone}</span>
              </a>
            )}
            {page.instagram && (
              <a className="hover:text-brand" href={page.instagram} target="_blank" rel="noreferrer">
                Instagram
              </a>
            )}
            {page.facebook && (
              <a className="hover:text-brand" href={page.facebook} target="_blank" rel="noreferrer">
                Facebook
              </a>
            )}
          </div>
          <div className="grid content-start gap-1.5 text-sm">
            <div className="font-bold">{tr("وين نحنا", "Find us")}</div>
            {biz.address && <div className="text-muted">{biz.address}</div>}
            {pickT(page, "hours") && <div className="text-muted">🕒 {pickT(page, "hours")}</div>}
            {page.mapUrl && (
              <a className="font-semibold text-brand hover:underline" href={page.mapUrl} target="_blank" rel="noreferrer">
                {tr("افتح على الخريطة ↗", "Open in Maps ↗")}
              </a>
            )}
          </div>
        </div>
        <div className="border-t border-line py-4 text-center text-xs text-faint">
          © {new Date().getFullYear()} {name}
        </div>
      </footer>

      {/* basket bar */}
      {count > 0 && wa && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3">
          <button className="mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-full bg-[#25d366] px-5 py-3 font-semibold text-white shadow-lg hover:brightness-95" onClick={() => setOpen(true)}>
            <span>
              🧺 {tr(`${count} قطعة`, `${count} item${count === 1 ? "" : "s"}`)}
              {totalText && <span className="num ltr"> · {totalText}</span>}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {tr("اطلب على واتساب", "Order on WhatsApp")} <WaIcon className="h-5 w-5" />
            </span>
          </button>
        </div>
      )}

      {/* basket sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={tr("طلبك", "Your order")} onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">{tr("طلبك", "Your order")}</h2>
              <button className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunken" aria-label={tr("إغلاق", "Close")} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="grid gap-2">
              {lines.map((l) => (
                <div key={l.p.id} className="flex items-center gap-3 rounded-xl border border-line p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{pickT(l.p, "name")}</div>
                    {l.p.price !== undefined && l.p.currency && <div className="text-sm text-muted num ltr text-start">{money(l.p.price * l.qty, l.p.currency, lang)}</div>}
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-line bg-sunken p-0.5">
                    <button className="grid h-8 w-8 place-items-center rounded-full bg-surface font-bold" aria-label={tr("أنقص", "Less")} onClick={() => add(l.p.id, -1)}>
                      −
                    </button>
                    <span className="w-6 text-center font-bold num">{l.qty}</span>
                    <button className="grid h-8 w-8 place-items-center rounded-full bg-surface font-bold" aria-label={tr("زيد", "More")} onClick={() => add(l.p.id, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {totalText && (
              <div className="mt-3 flex justify-between text-lg font-bold">
                <span>{tr("المجموع", "Total")}</span>
                <span className="num ltr">{totalText}</span>
              </div>
            )}
            <div className="mt-4 grid gap-2">
              <input className="input" placeholder={tr("اسمك (اختياري)", "Your name (optional)")} value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} />
              <input className="input" placeholder={tr("العنوان للتوصيل (اختياري)", "Delivery address (optional)")} value={who.address} onChange={(e) => setWho({ ...who, address: e.target.value })} />
              <textarea className="input" rows={2} placeholder={tr("ملاحظة (اختياري)", "Note (optional)")} value={who.note} onChange={(e) => setWho({ ...who, note: e.target.value })} />
            </div>
            <a
              className="mt-4 flex items-center justify-center gap-2 rounded-full bg-[#25d366] px-5 py-3 font-semibold text-white hover:brightness-95"
              href={waUrl(orderText())}
              target="_blank"
              rel="noreferrer"
            >
              <WaIcon /> {tr("ابعت الطلب على واتساب", "Send the order on WhatsApp")}
            </a>
            <button
              className="mt-2 w-full rounded-full px-5 py-2 text-sm font-semibold text-muted hover:bg-sunken"
              onClick={() => {
                setBasket({});
                setOpen(false);
              }}
            >
              {tr("فضّي السلة", "Empty the basket")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
