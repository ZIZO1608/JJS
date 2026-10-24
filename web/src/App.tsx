import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Module } from "@shared/permissions";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AssetsPage } from "./pages/Assets";
import { AuditPage } from "./pages/Audit";
import { LoginPage, SetupPage } from "./pages/Auth";
import { ClientDetailPage } from "./pages/clients/ClientDetail";
import { ClientsPage } from "./pages/clients/Clients";
import { CostingPage } from "./pages/Costing";
import { DailyClosePage } from "./pages/DailyClose";
import { DashboardPage } from "./pages/Dashboard";
import { ExpensesPage } from "./pages/Expenses";
import { HomePage } from "./pages/Home";
import { MenuPage } from "./pages/menu/Menu";
import { NewOrderPage } from "./pages/orders/NewOrder";
import { OrdersPage } from "./pages/orders/Orders";
import { PeoplePage } from "./pages/People";
import { PrintLabels, PrintReceipt, PrintReport, PrintStatement } from "./pages/print/Print";
import { PurchasingPage } from "./pages/Purchasing";
import { ReportsPage } from "./pages/Reports";
import { RolesPage } from "./pages/Roles";
import { SettingsPage } from "./pages/settings/Settings";
import { UsersPage } from "./pages/Users";
import { WarehousePage } from "./pages/warehouse/Warehouse";
import { DistributionPage } from "./pages/distribution/Distribution";
import { PrintRouteSheet } from "./pages/distribution/PrintRoute";
import { ProductionPage } from "./pages/production/Production";
import { RequestsPage } from "./pages/requests/Requests";
import { AppSettingsProvider } from "./lib/appSettings";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";

/** The UI hides what a role cannot use; the server refuses it anyway. */
function Guard({ module, children }: { module: Module; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (!can(module, "view")) return <p className="py-10 text-center text-muted">{t("errors.forbidden")}</p>;
  return <>{children}</>;
}
const g = (m: Module, el: ReactNode) => <Guard module={m}>{el}</Guard>;

export function App() {
  const { status } = useAuth();
  if (status === "loading") return <Spinner />;
  if (status === "setup") return <SetupPage />;
  if (status === "login") return <LoginPage />;
  return (
    <AppSettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* print views: no menus, sized for the printer */}
          <Route path="print/receipt/:id" element={g("orders", <PrintReceipt />)} />
          <Route path="print/labels" element={g("warehouse", <PrintLabels />)} />
          <Route path="print/statement/:id" element={g("clients", <PrintStatement />)} />
          <Route path="print/report" element={g("reports", <PrintReport />)} />
          <Route path="print/route" element={g("orders", <PrintRouteSheet />)} />
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="dashboard" element={g("dashboard", <DashboardPage />)} />
            <Route path="orders" element={g("orders", <OrdersPage />)} />
            <Route path="orders/new" element={g("orders", <NewOrderPage />)} />
            <Route path="requests" element={g("orders", <RequestsPage />)} />
            <Route path="close" element={g("daily_close", <DailyClosePage />)} />
            <Route path="distribution/*" element={g("orders", <DistributionPage />)} />
            <Route path="production/*" element={g("warehouse", <ProductionPage />)} />
            <Route path="clients" element={g("clients", <ClientsPage />)} />
            <Route path="clients/:id" element={g("clients", <ClientDetailPage />)} />
            <Route path="menu/*" element={g("menu", <MenuPage />)} />
            <Route path="warehouse/*" element={g("warehouse", <WarehousePage />)} />
            <Route path="purchasing/*" element={g("purchasing", <PurchasingPage />)} />
            <Route path="costing/*" element={g("costing", <CostingPage />)} />
            <Route path="expenses" element={g("expenses", <ExpensesPage />)} />
            <Route path="assets" element={g("assets", <AssetsPage />)} />
            <Route path="people/*" element={g("people", <PeoplePage />)} />
            <Route path="reports" element={g("reports", <ReportsPage />)} />
            <Route path="users" element={g("users", <UsersPage />)} />
            <Route path="roles" element={g("roles", <RolesPage />)} />
            <Route path="audit" element={g("audit", <AuditPage />)} />
            <Route path="settings/*" element={g("settings", <SettingsPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppSettingsProvider>
  );
}
