import { useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DataTable } from "../../components/DataTable";
import { Tabs } from "../../components/Tabs";
import { Empty, Field, PageHeader, Select, Spinner, StatusDot, TextInput } from "../../components/ui";
import { post, put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { money, num, pct, usd, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import type { Category, Option, StockItem } from "../../lib/types";
import { ActionDialog, Check, CurrencySelect, DeleteConfirm, NameFields, NumInput, RecipeEditor, RowActions, recipeBody, useSaver, type RecipeLine } from "../kit";

interface RecipeRow {
  itemId: string;
  qty: number;
  nameAr: string;
  nameEn: string;
  kind: string;
  unitCode: string;
  avgCostUsd: number;
}
interface Product {
  id: string;
  categoryId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  price: number;
  currency: Currency;
  shelfLifeHours: number;
  allergens: string;
  photo: string;
  sort: number;
  active: boolean;
  itemId: string | null;
  ownGroupIds: string[];
  groupIds: string[];
  recipe: RecipeRow[];
  costUsd: number;
}
interface Group {
  id: string;
  nameAr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  sort: number;
}

/** Groups a category gives its products: a product's links minus its own ones. */
function categoryGroupIds(products: Product[], categoryId: string) {
  const s = new Set<string>();
  for (const p of products.filter((x) => x.categoryId === categoryId)) for (const g of p.groupIds) if (!p.ownGroupIds.includes(g)) s.add(g);
  return [...s];
}

/** Shrink a photo to max 400px and JPEG so it stays small (the server allows ~300 KB). */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const scale = Math.min(1, 400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL("image/jpeg", q);
      if (d.length < 290_000) return d;
    }
    throw new Error("too big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProductDialog({ product, categories, groups, items, catGroups, onClose, onSaved }: { product: Product | null; categories: Category[]; groups: Group[]; items: StockItem[]; catGroups: (c: string) => string[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const { s } = useAppSettings();
  const seeCost = can("costing", "see_cost");
  const { errors, busy, run } = useSaver();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [f, setF] = useState({
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    code: product?.code ?? "",
    nameAr: product?.nameAr ?? "",
    nameEn: product?.nameEn ?? "",
    price: product ? String(product.price) : "",
    currency: product?.currency ?? s?.defaultCurrency ?? "USD",
    shelfLifeHours: String(product?.shelfLifeHours ?? 24),
    allergens: product?.allergens ?? "",
    photo: product?.photo ?? "",
    sort: String(product?.sort ?? 0),
    active: product?.active ?? true,
    own: product?.ownGroupIds ?? [],
  });
  const [lines, setLines] = useState<RecipeLine[]>(product?.recipe.map((r) => ({ itemId: r.itemId, qty: String(r.qty) })) ?? []);
  const inherited = catGroups(f.categoryId);

  const save = async () => {
    const body = {
      categoryId: f.categoryId,
      code: f.code.trim(),
      nameAr: f.nameAr,
      nameEn: f.nameEn,
      price: num(f.price),
      currency: f.currency,
      shelfLifeHours: Math.round(num(f.shelfLifeHours)),
      allergens: f.allergens,
      photo: f.photo,
      sort: Math.round(num(f.sort) || 0),
      active: f.active,
      optionGroupIds: f.own.filter((g) => !inherited.includes(g)),
      recipe: recipeBody(lines),
    };
    if (await run(() => (product ? put(`/menu/products/${product.id}`, body) : post("/menu/products", body)))) onSaved();
  };

  return (
    <ActionDialog wide title={product ? tr("تعديل منتج", "Edit product") : tr("منتج جديد", "New product")} onClose={onClose} onSave={save} busy={busy} disabled={!f.categoryId || !f.nameAr || !f.nameEn || f.price === "" || !f.shelfLifeHours}>
      <div className="flex gap-4">
        <div className="shrink-0">
          <button type="button" className="grid h-24 w-24 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-sunken text-xs text-faint" onClick={() => fileRef.current?.click()}>
            {f.photo ? <img src={f.photo} alt="" className="h-full w-full object-cover" /> : tr("+ صورة", "+ Photo")}
          </button>
          {f.photo && (
            <button className="mt-1 block w-24 text-center text-xs text-bad" onClick={() => setF({ ...f, photo: "" })}>
              {tr("إزالة", "Remove")}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                setPhotoErr("");
                setF((x) => ({ ...x, photo: "" }));
                const d = await shrinkPhoto(file);
                setF((x) => ({ ...x, photo: d }));
              } catch {
                setPhotoErr(tr("ما قدرنا نقرأ الصورة.", "Could not read that image."));
              }
            }}
          />
          {photoErr && <p className="mt-1 w-24 text-xs text-bad">{photoErr}</p>}
        </div>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <Field label={tr("الصنف", "Category")} htmlFor="p-cat" error={errors.categoryId}>
            <Select id="p-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("الكود (للباركود)", "Code (for barcode)")} htmlFor="p-code" error={errors.code} hint={tr("فاضي = تلقائي", "Empty = automatic")}>
            <TextInput id="p-code" dir="ltr" className="uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
        </div>
      </div>
      <NameFields f={f} set={setF} errors={errors} idp="p" />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={tr("السعر", "Price")} htmlFor="p-price" error={errors.price}>
          <NumInput id="p-price" value={f.price} onChange={(v) => setF({ ...f, price: v })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="p-cur">
          <CurrencySelect id="p-cur" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
        <Field label={tr("الصلاحية (ساعات)", "Shelf life (hours)")} htmlFor="p-life" error={errors.shelfLifeHours}>
          <NumInput id="p-life" step="1" min={1} value={f.shelfLifeHours} onChange={(v) => setF({ ...f, shelfLifeHours: v })} />
        </Field>
        <Field label={tr("الترتيب", "Order")} htmlFor="p-sort">
          <NumInput id="p-sort" step="1" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
        </Field>
      </div>
      <Field label={tr("مسبّبات الحساسية (تنطبع على الملصق)", "Allergens (printed on the label)")} htmlFor="p-all" error={errors.allergens}>
        <TextInput id="p-all" value={f.allergens} placeholder={tr("مثلاً: غلوتين، ألبان", "e.g. Gluten, Dairy")} onChange={(e) => setF({ ...f, allergens: e.target.value })} />
      </Field>
      {groups.length > 0 && (
        <div>
          <div className="label">{tr("الإضافات المتاحة", "Add-ons offered")}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {groups.map((g) =>
              inherited.includes(g.id) ? (
                <Check key={g.id} checked disabled onChange={() => undefined}>
                  {pick(g)} <span className="text-xs text-faint">{tr("(من الصنف)", "(from category)")}</span>
                </Check>
              ) : (
                <Check key={g.id} checked={f.own.includes(g.id)} onChange={(v) => setF({ ...f, own: v ? [...f.own, g.id] : f.own.filter((x) => x !== g.id) })}>
                  {pick(g)}
                </Check>
              ),
            )}
          </div>
        </div>
      )}
      <RecipeEditor lines={lines} setLines={setLines} items={items} seeCost={seeCost} />
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {tr("ظاهر بشاشة الطلبات", "Shown on the order screen")}
      </Check>
    </ActionDialog>
  );
}

function ProductsTab() {
  const { tr, pick, lang } = useI18n();
  const { can, simple } = useAuth();
  const seeCost = can("costing", "see_cost") && !simple;
  const prods = useData<{ rows: Product[] }>("/menu/products");
  const cats = useData<{ rows: Category[] }>("/menu/categories");
  const groups = useData<{ rows: Group[] }>("/menu/option-groups");
  const items = useData<{ rows: StockItem[] }>(can("menu", "edit") || can("menu", "create") ? "/stock/items" : null);
  const fx = useData<{ rate: number | null }>("/fx/current");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);

  if (!prods.data || !cats.data || !groups.data) return <Spinner />;
  const catName = (id: string) => {
    const c = cats.data!.rows.find((x) => x.id === id);
    return c ? pick(c) : "—";
  };
  const rate = fx.data?.rate ?? null;
  const priceUsd = (p: Product) => (p.currency === "USD" ? p.price : rate ? p.price / rate : null);
  const rows = prods.data.rows.filter((p) => !cat || p.categoryId === cat);
  const reload = () => void prods.reload();

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.code} ${r.nameAr} ${r.nameEn}`}
        onRowClick={can("menu", "edit") ? (r) => setEditing(r) : undefined}
        toolbar={
          <>
            <Select aria-label={tr("الصنف", "Category")} className="!w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{tr("كل الأصناف", "All categories")}</option>
              {cats.data.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c)}
                </option>
              ))}
            </Select>
            {can("menu", "create") && (
              <button className="btn btn-primary" onClick={() => setEditing("new")} disabled={!cats.data.rows.length}>
                {tr("+ منتج", "+ Product")}
              </button>
            )}
          </>
        }
        columns={[
          {
            key: "photo",
            header: "",
            className: "w-14",
            render: (p) => (p.photo ? <img src={p.photo} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-sunken" />),
          },
          { key: "code", header: tr("الكود", "Code"), render: (p) => <span className="num ltr text-muted">{p.code}</span>, sortValue: (p) => p.code },
          {
            key: "name",
            header: tr("المنتج", "Product"),
            render: (p) => (
              <div>
                <div className="font-semibold">{pick(p)}</div>
                {p.allergens && <div className="text-xs text-faint">{p.allergens}</div>}
              </div>
            ),
            sortValue: (p) => pick(p),
          },
          { key: "cat", header: tr("الصنف", "Category"), render: (p) => catName(p.categoryId), sortValue: (p) => catName(p.categoryId) },
          { key: "price", header: tr("السعر", "Price"), align: "end", render: (p) => <span className="num ltr">{money(p.price, p.currency, lang)}</span>, sortValue: (p) => priceUsd(p) ?? 0 },
          ...(seeCost
            ? [
                {
                  key: "cost",
                  header: tr("الكلفة", "Cost"),
                  align: "end" as const,
                  render: (p: Product) => (p.recipe.length ? <span className="num ltr">{usd(p.costUsd)}</span> : <span className="text-xs text-warn">{tr("بلا وصفة", "No recipe")}</span>),
                  sortValue: (p: Product) => p.costUsd,
                },
                {
                  key: "margin",
                  header: tr("الهامش", "Margin"),
                  align: "end" as const,
                  render: (p: Product) => {
                    const pu = priceUsd(p);
                    if (!pu || !p.recipe.length) return "—";
                    const m = ((pu - p.costUsd) / pu) * 100;
                    return <span className={`num ltr ${m < 0 ? "text-bad" : ""}`}>{pct(m)}</span>;
                  },
                  sortValue: (p: Product) => {
                    const pu = priceUsd(p);
                    return pu ? (pu - p.costUsd) / pu : 0;
                  },
                },
              ]
            : []),
          {
            key: "st",
            header: tr("الحالة", "Status"),
            render: (p) => (
              <span className="chip">
                <StatusDot tone={p.active ? "good" : "mute"} />
                {p.active ? tr("ظاهر", "Shown") : tr("مخفي", "Hidden")}
              </span>
            ),
          },
          ...(can("menu", "delete") ? [{ key: "x", header: "", render: (p: Product) => <RowActions canEdit={false} canDelete onDelete={() => setToDelete(p)} /> }] : []),
        ]}
      />
      {editing && (
        <ProductDialog
          product={editing === "new" ? null : editing}
          categories={cats.data.rows}
          groups={groups.data.rows}
          items={items.data?.rows ?? []}
          catGroups={(c) => categoryGroupIds(prods.data!.rows, c)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {toDelete && <DeleteConfirm name={pick(toDelete)} path={`/menu/products/${toDelete.id}`} onClose={() => setToDelete(null)} onDone={reload} />}
    </>
  );
}

function CategoryDialog({ cat, groups, linked, onClose, onSaved }: { cat: Category | null; groups: Group[]; linked: string[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, t } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: cat?.nameAr ?? "", nameEn: cat?.nameEn ?? "", sort: String(cat?.sort ?? 0), active: cat?.active ?? true, groups: linked });
  const save = async () => {
    const ok = await run(async () => {
      const body = { nameAr: f.nameAr, nameEn: f.nameEn, sort: Math.round(num(f.sort) || 0), active: f.active };
      const r = cat ? await put<{ row: Category }>(`/menu/categories/${cat.id}`, body) : await post<{ row: Category }>("/menu/categories", body);
      await put(`/menu/categories/${r.row.id}/groups`, { groupIds: f.groups });
    });
    if (ok) onSaved();
  };
  return (
    <ActionDialog title={cat ? tr("تعديل صنف", "Edit category") : tr("صنف جديد", "New category")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="c" />
      <Field label={t("common.sort")} htmlFor="c-sort">
        <NumInput id="c-sort" step="1" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
      </Field>
      {groups.length > 0 && (
        <div>
          <div className="label">{tr("إضافات لكل منتجات هالصنف", "Add-ons for every product in this category")}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {groups.map((g) => (
              <Check key={g.id} checked={f.groups.includes(g.id)} onChange={(v) => setF({ ...f, groups: v ? [...f.groups, g.id] : f.groups.filter((x) => x !== g.id) })}>
                {pick(g)}
              </Check>
            ))}
          </div>
        </div>
      )}
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {t("common.active")}
      </Check>
    </ActionDialog>
  );
}

function CategoriesTab() {
  const { tr, pick, t } = useI18n();
  const { can } = useAuth();
  const cats = useData<{ rows: Category[] }>("/menu/categories");
  const prods = useData<{ rows: Product[] }>("/menu/products");
  const groups = useData<{ rows: Group[] }>("/menu/option-groups");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  if (!cats.data || !prods.data || !groups.data) return <Spinner />;
  const reload = () => {
    void cats.reload();
    void prods.reload();
  };
  const gName = (id: string) => {
    const g = groups.data!.rows.find((x) => x.id === id);
    return g ? pick(g) : "";
  };
  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex justify-end">
        {can("menu", "create") && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            {tr("+ صنف", "+ Category")}
          </button>
        )}
      </div>
      {cats.data.rows.length === 0 ? (
        <Empty text={tr("ما في أصناف بعد. ابدأ بصنف مثل «ساندويشات».", "No categories yet. Start with one like “Sandwiches”.")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">{t("common.sort")}</th>
                <th className="th">{tr("الصنف", "Category")}</th>
                <th className="th">{tr("منتجات", "Products")}</th>
                <th className="th">{tr("الإضافات", "Add-ons")}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {cats.data.rows.map((c) => {
                const linked = categoryGroupIds(prods.data!.rows, c.id);
                return (
                  <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                    <td className="td num w-14">{c.sort}</td>
                    <td className="td font-semibold">{pick(c)}</td>
                    <td className="td num">{prods.data!.rows.filter((p) => p.categoryId === c.id).length}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {linked.map((g) => (
                          <span key={g} className="chip">
                            {gName(g)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="td">
                      <RowActions canEdit={can("menu", "edit")} canDelete={can("menu", "delete")} onEdit={() => setEditing(c)} onDelete={() => setToDelete(c)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CategoryDialog
          cat={editing === "new" ? null : editing}
          groups={groups.data.rows}
          linked={editing === "new" ? [] : categoryGroupIds(prods.data.rows, editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {toDelete && <DeleteConfirm name={pick(toDelete)} path={`/menu/categories/${toDelete.id}`} onClose={() => setToDelete(null)} onDone={reload} />}
    </div>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: () => void }) {
  const { tr, t } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: group?.nameAr ?? "", nameEn: group?.nameEn ?? "", minSelect: String(group?.minSelect ?? 0), maxSelect: String(group?.maxSelect ?? 3), sort: String(group?.sort ?? 0) });
  const save = async () => {
    const body = { nameAr: f.nameAr, nameEn: f.nameEn, minSelect: Math.round(num(f.minSelect) || 0), maxSelect: Math.round(num(f.maxSelect) || 1), sort: Math.round(num(f.sort) || 0) };
    if (await run(() => (group ? put(`/menu/option-groups/${group.id}`, body) : post("/menu/option-groups", body)))) onSaved();
  };
  return (
    <ActionDialog title={group ? tr("تعديل مجموعة إضافات", "Edit add-on group") : tr("مجموعة إضافات جديدة", "New add-on group")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="g" />
      <div className="grid grid-cols-3 gap-3">
        <Field label={tr("أقل اختيار", "Min to pick")} htmlFor="g-min" error={errors.minSelect} hint={tr("0 = اختياري", "0 = optional")}>
          <NumInput id="g-min" step="1" value={f.minSelect} onChange={(v) => setF({ ...f, minSelect: v })} />
        </Field>
        <Field label={tr("أكثر اختيار", "Max to pick")} htmlFor="g-max" error={errors.maxSelect}>
          <NumInput id="g-max" step="1" min={1} value={f.maxSelect} onChange={(v) => setF({ ...f, maxSelect: v })} />
        </Field>
        <Field label={t("common.sort")} htmlFor="g-sort">
          <NumInput id="g-sort" step="1" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
        </Field>
      </div>
    </ActionDialog>
  );
}

function OptionDialog({ groupId, option, items, onClose, onSaved }: { groupId: string; option: Option | null; items: StockItem[]; onClose: () => void; onSaved: () => void }) {
  const { tr, t } = useI18n();
  const { can } = useAuth();
  const { s } = useAppSettings();
  const { errors, busy, run } = useSaver();
  const recipe = useData<{ recipe: RecipeRow[] }>(option ? `/menu/options/${option.id}/recipe` : null);
  const [f, setF] = useState({ nameAr: option?.nameAr ?? "", nameEn: option?.nameEn ?? "", priceDelta: String(option?.priceDelta ?? 0), currency: option?.currency ?? s?.defaultCurrency ?? "USD", sort: String(option?.sort ?? 0), active: option?.active ?? true });
  const [lines, setLines] = useState<RecipeLine[] | null>(option ? null : []);
  const shown = lines ?? recipe.data?.recipe.map((r) => ({ itemId: r.itemId, qty: String(r.qty) })) ?? [];
  const save = async () => {
    const ok = await run(async () => {
      const body = { groupId, nameAr: f.nameAr, nameEn: f.nameEn, priceDelta: num(f.priceDelta) || 0, currency: f.currency, sort: Math.round(num(f.sort) || 0), active: f.active };
      const r = option ? await put<{ row: Option }>(`/menu/options/${option.id}`, body) : await post<{ row: Option }>("/menu/options", body);
      await put(`/menu/options/${r.row.id}/recipe`, { recipe: recipeBody(shown) });
    });
    if (ok) onSaved();
  };
  return (
    <ActionDialog wide title={option ? tr("تعديل إضافة", "Edit add-on") : tr("إضافة جديدة", "New add-on")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn || (!!option && !recipe.data && lines === null)}>
      <NameFields f={f} set={setF} errors={errors} idp="o" />
      <div className="grid grid-cols-3 gap-3">
        <Field label={tr("فرق السعر", "Price change")} htmlFor="o-price" error={errors.priceDelta} hint={tr("0 = مجاناً", "0 = free")}>
          <NumInput id="o-price" min={-1000} value={f.priceDelta} onChange={(v) => setF({ ...f, priceDelta: v })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="o-cur">
          <CurrencySelect id="o-cur" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
        <Field label={t("common.sort")} htmlFor="o-sort">
          <NumInput id="o-sort" step="1" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
        </Field>
      </div>
      <p className="text-sm text-muted">{tr("الوصفة اختيارية: مثلاً «حشوة مضاعفة» تسحب 0.08 كغ حبش إضافي من المخزن.", "The recipe is optional: e.g. “Double filling” takes an extra 0.08 kg of turkey from stock.")}</p>
      <RecipeEditor lines={shown} setLines={setLines} items={items} seeCost={can("costing", "see_cost")} />
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {t("common.active")}
      </Check>
    </ActionDialog>
  );
}

function GroupCard({ group, items, onEdit, onDelete }: { group: Group; items: StockItem[]; onEdit: () => void; onDelete: () => void }) {
  const { tr, pick, lang } = useI18n();
  const { can } = useAuth();
  const opts = useData<{ rows: Option[] }>(`/menu/options?groupId=${group.id}`);
  const [editing, setEditing] = useState<Option | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Option | null>(null);
  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="min-w-0">
          <div className="font-bold">{pick(group)}</div>
          <div className="text-xs text-muted">
            {group.minSelect > 0 ? tr(`لازم يختار ${group.minSelect} على الأقل`, `Must pick at least ${group.minSelect}`) : tr("اختياري", "Optional")} · {tr(`حتى ${group.maxSelect}`, `up to ${group.maxSelect}`)}
          </div>
        </div>
        <div className="ms-auto">
          <RowActions
            canEdit={can("menu", "edit")}
            canDelete={can("menu", "delete")}
            onEdit={onEdit}
            onDelete={onDelete}
            extra={
              can("menu", "create") && (
                <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing("new")}>
                  {tr("+ خيار", "+ Option")}
                </button>
              )
            }
          />
        </div>
      </div>
      {!opts.data ? (
        <Spinner />
      ) : opts.data.rows.length === 0 ? (
        <p className="p-3 text-sm text-faint">{tr("ما في خيارات بعد.", "No options yet.")}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {opts.data.rows.map((o) => (
              <tr key={o.id} className={o.active ? "" : "opacity-60"}>
                <td className="td">{pick(o)}</td>
                <td className="td text-end">
                  <span className="num ltr">{o.priceDelta ? `${o.priceDelta > 0 ? "+" : ""}${money(o.priceDelta, o.currency, lang)}` : tr("مجاناً", "free")}</span>
                </td>
                <td className="td w-1">
                  <RowActions canEdit={can("menu", "edit")} canDelete={can("menu", "delete")} onEdit={() => setEditing(o)} onDelete={() => setToDelete(o)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <OptionDialog
          groupId={group.id}
          option={editing === "new" ? null : editing}
          items={items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void opts.reload();
          }}
        />
      )}
      {toDelete && <DeleteConfirm name={pick(toDelete)} path={`/menu/options/${toDelete.id}`} onClose={() => setToDelete(null)} onDone={() => void opts.reload()} />}
    </div>
  );
}

function AddonsTab() {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const groups = useData<{ rows: Group[] }>("/menu/option-groups");
  const items = useData<{ rows: StockItem[] }>(can("menu", "edit") ? "/stock/items" : null);
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Group | null>(null);
  if (!groups.data) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">{tr("مجموعات مثل «إضافات» و«بدون». اربطها بصنف كامل (من تبويب الأصناف) أو بمنتج واحد.", "Groups like “Extras” and “Remove”. Link them to a whole category (Categories tab) or to one product.")}</p>
        {can("menu", "create") && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            {tr("+ مجموعة", "+ Group")}
          </button>
        )}
      </div>
      {groups.data.rows.length === 0 ? (
        <Empty text={tr("ما في مجموعات إضافات بعد.", "No add-on groups yet.")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.data.rows.map((g) => (
            <GroupCard key={g.id} group={g} items={items.data?.rows ?? []} onEdit={() => setEditing(g)} onDelete={() => setToDelete(g)} />
          ))}
        </div>
      )}
      {editing && (
        <GroupDialog
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void groups.reload();
          }}
        />
      )}
      {toDelete && <DeleteConfirm name={pick(toDelete)} path={`/menu/option-groups/${toDelete.id}`} onClose={() => setToDelete(null)} onDone={() => void groups.reload()} />}
    </>
  );
}

/** Read-only menu for the kitchen (manager & members). */
function SimpleMenu() {
  const { tr, pick, lang } = useI18n();
  const prods = useData<{ rows: Product[] }>("/menu/products");
  const cats = useData<{ rows: Category[] }>("/menu/categories");
  const byCat = useMemo(() => (cats.data?.rows ?? []).map((c) => ({ c, list: (prods.data?.rows ?? []).filter((p) => p.categoryId === c.id && p.active) })), [cats.data, prods.data]);
  if (!prods.data || !cats.data) return <Spinner />;
  return (
    <div className="grid gap-6">
      {byCat
        .filter((x) => x.list.length)
        .map(({ c, list }) => (
          <section key={c.id}>
            <h2 className="mb-2 text-lg font-bold">{pick(c)}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((p) => (
                <div key={p.id} className="card flex items-center gap-3">
                  {p.photo ? <img src={p.photo} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-sunken" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{pick(p)}</div>
                    <div className="text-xs text-faint">
                      {p.allergens || tr("بلا مسبّبات حساسية", "No allergens")} · {tr(`صلاحية ${p.shelfLifeHours} ساعة`, `${p.shelfLifeHours} h shelf life`)}
                    </div>
                  </div>
                  <span className="num ltr font-bold">{money(p.price, p.currency, lang)}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

export function MenuPage() {
  const { tr } = useI18n();
  const { simple, can } = useAuth();
  if (simple || !can("menu", "edit")) {
    return (
      <>
        <PageHeader title={tr("المنيو", "Menu")} />
        <SimpleMenu />
      </>
    );
  }
  return (
    <>
      <PageHeader title={tr("المنيو", "Menu")} subtitle={tr("المنتجات وأسعارها ووصفاتها، والأصناف، والإضافات مثل الحشوة المضاعفة.", "Products with prices and recipes, categories, and add-ons like double filling.")} />
      <Tabs
        base="/menu"
        tabs={[
          { key: "products", label: tr("المنتجات", "Products") },
          { key: "categories", label: tr("الأصناف", "Categories") },
          { key: "addons", label: tr("الإضافات", "Add-ons") },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="products" replace />} />
        <Route path="products" element={<ProductsTab />} />
        <Route path="categories" element={<CategoriesTab />} />
        <Route path="addons" element={<AddonsTab />} />
      </Routes>
    </>
  );
}
