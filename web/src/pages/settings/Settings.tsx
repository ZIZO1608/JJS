import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useI18n } from "../../lib/i18n";
import { BackupsTab } from "./Backups";
import { BusinessTab } from "./Business";
import { CurrencyTab } from "./Currency";
import { ListsTab } from "./Lists";
import { TaxesTab } from "./Taxes";
import { MoneyTab } from "./Money";
import { NetworkTab } from "./Network";
import { PriceListsTab } from "./PriceLists";
import { PrintingTab } from "./Printing";
import { SalesTab } from "./Sales";

const TABS = ["business", "lists", "currency", "taxes", "money", "sales", "prices", "printing", "network", "backups"] as const;
const EXTRA_LABEL: Record<string, { ar: string; en: string }> = {
  money: { ar: "الصناديق والدفع", en: "Money" },
  sales: { ar: "البيع والولاء", en: "Sales rules" },
  prices: { ar: "قوائم الأسعار", en: "Price lists" },
  printing: { ar: "الطباعة", en: "Printing" },
  network: { ar: "الشبكة والسحابة", en: "Network & cloud" },
};

export function SettingsPage() {
  const { t, pick } = useI18n();
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label={t("settings.title")}>
        {TABS.map((k) => (
          <NavLink
            key={k}
            to={`/settings/${k}`}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 font-semibold ${isActive ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`
            }
          >
            {EXTRA_LABEL[k] ? pick(EXTRA_LABEL[k]!) : t(`settings.tabs.${k as "business"}`)}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="business" replace />} />
        <Route path="business" element={<BusinessTab />} />
        <Route path="lists" element={<ListsTab />} />
        <Route path="currency" element={<CurrencyTab />} />
        <Route path="taxes" element={<TaxesTab />} />
        <Route path="money" element={<MoneyTab />} />
        <Route path="sales" element={<SalesTab />} />
        <Route path="prices" element={<PriceListsTab />} />
        <Route path="printing" element={<PrintingTab />} />
        <Route path="network" element={<NetworkTab />} />
        <Route path="backups" element={<BackupsTab />} />
      </Routes>
    </>
  );
}
