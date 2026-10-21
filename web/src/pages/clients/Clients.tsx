import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type Column } from "../../components/DataTable";
import { Stat } from "../../components/Tabs";
import { Empty, PageHeader, Spinner } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { ClientSummary, Lookup } from "../../lib/types";
import { useData } from "../../lib/useData";
import { BalanceText, ClientDialog, PaymentDialog, type Tier } from "./ClientDialogs";

type Filter = "all" | "owes" | "subs" | "business" | "individual";

function LoyaltyCell({ c }: { c: ClientSummary }) {
  const { tr } = useI18n();
  if (!c.loyalty.enabled) return <span className="text-faint">—</span>;
  const pctDone = Math.min(100, (c.loyalty.progress / Math.max(1, c.loyalty.buyQty)) * 100);
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="num ltr">
          {c.loyalty.progress}/{c.loyalty.buyQty}
        </span>
        {c.loyalty.available > 0 && <span className="chip">{tr(`${c.loyalty.available} مجاناً`, `${c.loyalty.available} free`)}</span>}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-sunken">
        <div className="h-1.5 rounded-full bg-ink" style={{ width: `${pctDone}%` }} />
      </div>
    </div>
  );
}

/** Big-button list for the manager: find the client, tap, record the payment. */
function SimpleClients({ rows, onPay }: { rows: ClientSummary[]; onPay: (c: ClientSummary) => void }) {
  const { tr } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const shown = rows.filter((c) => !q.trim() || `${c.name} ${c.contactPerson} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <input className="input mb-4 py-3 text-lg" type="search" placeholder={tr("ابحث عن زبون…", "Find a client…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("بحث", "Search")} autoFocus />
      {shown.length === 0 ? (
        <Empty text={tr("ما في زبائن", "No clients")} />
      ) : (
        <div className="grid gap-2">
          {shown.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              <button className="min-w-0 flex-1 text-start" onClick={() => navigate(`/clients/${c.id}`)}>
                <div className="truncate text-lg font-bold">{c.name}</div>
                <div className="text-sm text-muted">{c.contactPerson || c.phone || " "}</div>
              </button>
              <BalanceText usd={c.balanceUsd} />
              <button className="btn btn-primary px-5 py-3" onClick={() => onPay(c)}>
                {tr("سجّل دفعة", "Record payment")}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ClientsPage() {
  const { tr, pick } = useI18n();
  const { can, simple } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useData<{ rows: ClientSummary[] }>("/clients");
  const tiers = useData<{ rows: Tier[] }>("/clients/tiers");
  const tags = useData<{ items: Lookup[] }>("/lookups?type=client_tag");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<ClientSummary | null>(null);

  const tierOf = useMemo(() => new Map((tiers.data?.rows ?? []).map((t) => [t.id, t])), [tiers.data]);
  const tagOf = useMemo(() => new Map((tags.data?.items ?? []).map((t) => [t.id, t])), [tags.data]);

  if (!data) return <Spinner />;
  const rows = data.rows;
  const owing = rows.filter((c) => c.balanceUsd < -0.009);
  const totalOwed = owing.reduce((s, c) => s - c.balanceUsd, 0);
  const subs = rows.filter((c) => c.subscription);

  const filtered = rows.filter((c) =>
    filter === "owes" ? c.balanceUsd < -0.009 : filter === "subs" ? !!c.subscription : filter === "business" ? c.type === "business" : filter === "individual" ? c.type === "individual" : true,
  );

  const columns: Column<ClientSummary>[] = [
    {
      key: "name",
      header: tr("الزبون", "Client"),
      sortValue: (c) => c.name,
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold">
            {c.name} {!c.active && <span className="chip ms-1">{tr("موقوف", "inactive")}</span>}
          </div>
          <div className="text-xs text-faint">{[c.contactPerson, c.phone].filter(Boolean).join(" · ") || (c.type === "business" ? tr("محل", "Business") : tr("فرد", "Individual"))}</div>
        </div>
      ),
    },
    { key: "tag", header: tr("التصنيف", "Tag"), render: (c) => (c.tagId && tagOf.get(c.tagId) ? <span className="chip">{pick(tagOf.get(c.tagId)!)}</span> : <span className="text-faint">—</span>) },
    { key: "tier", header: tr("الفئة", "Tier"), render: (c) => (c.tierId && tierOf.get(c.tierId) ? `${pick(tierOf.get(c.tierId)!)} · ${tierOf.get(c.tierId)!.discountPct}%` : <span className="text-faint">—</span>) },
    { key: "bal", header: tr("الرصيد", "Balance"), align: "end", sortValue: (c) => c.balanceUsd, render: (c) => <BalanceText usd={c.balanceUsd} /> },
    {
      key: "limit",
      header: tr("حد الدين", "Credit limit"),
      align: "end",
      sortValue: (c) => c.creditLimitUsd,
      render: (c) => (c.creditLimitUsd > 0 ? <span className="num ltr">{money(c.creditLimitUsd)}{c.creditBlock ? " ⛔" : ""}</span> : <span className="text-faint">{tr("بلا حد", "none")}</span>),
    },
    { key: "loyalty", header: tr("الولاء (هذا الشهر)", "Loyalty (this month)"), render: (c) => <LoyaltyCell c={c} /> },
    {
      key: "sub",
      header: tr("الاشتراك", "Subscription"),
      render: (c) =>
        c.subscription ? (
          <div className="text-xs">
            <div className="font-semibold">{pick({ nameAr: c.subscription.planNameAr, nameEn: c.subscription.planNameEn })}</div>
            <div className="text-faint">{tr(`باقي ${c.subscription.availableIncluded} قطعة`, `${c.subscription.availableIncluded} items left`)}</div>
          </div>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    { key: "last", header: tr("آخر طلب", "Last order"), sortValue: (c) => c.lastOrderDate ?? "", render: (c) => <span className="num ltr text-sm">{c.lastOrderDate ?? "—"}</span> },
  ];

  const FILTERS: { k: Filter; label: string; n: number }[] = [
    { k: "all", label: tr("الكل", "All"), n: rows.length },
    { k: "owes", label: tr("عليهم دين", "Owe money"), n: owing.length },
    { k: "subs", label: tr("مشتركين", "Subscribers"), n: subs.length },
    { k: "business", label: tr("محلات", "Businesses"), n: rows.filter((c) => c.type === "business").length },
    { k: "individual", label: tr("أفراد", "Individuals"), n: rows.filter((c) => c.type === "individual").length },
  ];

  return (
    <>
      <PageHeader
        title={tr("الزبائن", "Clients")}
        subtitle={simple ? tr("اختر الزبون لتسجيل دفعة أو لرؤية حسابه.", "Pick a client to record a payment or see their account.") : tr("حساب كل زبون (صندوقه)، الدين، الولاء والاشتراكات.", "Each client's box: balance, credit, loyalty and subscriptions.")}
        actions={
          can("clients", "create") && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              {tr("+ زبون جديد", "+ New client")}
            </button>
          )
        }
      />
      {simple ? (
        <SimpleClients rows={rows.filter((c) => c.active)} onPay={setPaying} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("عدد الزبائن", "Clients")} value={String(rows.filter((c) => c.active).length)} />
            <Stat label={tr("ديون على الزبائن", "Owed to the shop")} value={money(totalOwed)} tone={totalOwed > 0 ? "bad" : undefined} sub={tr(`${owing.length} زبون`, `${owing.length} client(s)`)} />
            <Stat label={tr("أرصدة مسبقة", "Prepaid balances")} value={money(rows.reduce((s, c) => s + Math.max(0, c.balanceUsd), 0))} />
            <Stat label={tr("مشتركين", "Subscribers")} value={String(subs.length)} />
          </div>
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(c) => c.id}
            searchText={(c) => `${c.name} ${c.contactPerson} ${c.phone}`}
            onRowClick={(c) => navigate(`/clients/${c.id}`)}
            toolbar={
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((x) => (
                  <button key={x.k} className={`btn px-3 py-1 text-sm ${filter === x.k ? "btn-primary" : "btn-ghost"}`} aria-pressed={filter === x.k} onClick={() => setFilter(x.k)}>
                    {x.label} <span className="num opacity-70">{x.n}</span>
                  </button>
                ))}
              </div>
            }
          />
        </>
      )}
      {creating && (
        <ClientDialog
          client={null}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            navigate(`/clients/${id}`);
          }}
        />
      )}
      {paying && (
        <PaymentDialog
          client={paying}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
