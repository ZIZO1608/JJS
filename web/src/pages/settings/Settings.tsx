import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useI18n } from "../../lib/i18n";
import { BackupsTab } from "./Backups";
import { BusinessTab } from "./Business";
import { CurrencyTab } from "./Currency";
import { ListsTab } from "./Lists";
import { TaxesTab } from "./Taxes";

const TABS = ["business", "lists", "currency", "taxes", "backups"] as const;

export function SettingsPage() {
  const { t } = useI18n();
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
            {t(`settings.tabs.${k}`)}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="business" replace />} />
        <Route path="business" element={<BusinessTab />} />
        <Route path="lists" element={<ListsTab />} />
        <Route path="currency" element={<CurrencyTab />} />
        <Route path="taxes" element={<TaxesTab />} />
        <Route path="backups" element={<BackupsTab />} />
      </Routes>
    </>
  );
}
