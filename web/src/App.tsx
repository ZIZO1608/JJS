import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Module } from "@shared/permissions";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { LoginPage, SetupPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";

// Each screen is its own small file, fetched the first time it is opened (fast start on slow internet).
const loadAssets = () => import("./pages/Assets");
const AssetsPage = lazy(() => loadAssets().then((m) => ({ default: m.AssetsPage })));
const loadAudit = () => import("./pages/Audit");
const AuditPage = lazy(() => loadAudit().then((m) => ({ default: m.AuditPage })));
const loadClientdetail = () => import("./pages/clients/ClientDetail");
const ClientDetailPage = lazy(() => loadClientdetail().then((m) => ({ default: m.ClientDetailPage })));
const loadClients = () => import("./pages/clients/Clients");
const ClientsPage = lazy(() => loadClients().then((m) => ({ default: m.ClientsPage })));
const loadCosting = () => import("./pages/Costing");
const CostingPage = lazy(() => loadCosting().then((m) => ({ default: m.CostingPage })));
const loadDailyclose = () => import("./pages/DailyClose");
const DailyClosePage = lazy(() => loadDailyclose().then((m) => ({ default: m.DailyClosePage })));
const loadDashboard = () => import("./pages/Dashboard");
const DashboardPage = lazy(() => loadDashboard().then((m) => ({ default: m.DashboardPage })));
const loadExpenses = () => import("./pages/Expenses");
const ExpensesPage = lazy(() => loadExpenses().then((m) => ({ default: m.ExpensesPage })));
const loadMenu = () => import("./pages/menu/Menu");
const MenuPage = lazy(() => loadMenu().then((m) => ({ default: m.MenuPage })));
const loadMyday = () => import("./pages/MyDay");
const MyDayPage = lazy(() => loadMyday().then((m) => ({ default: m.MyDayPage })));
const loadNeworder = () => import("./pages/orders/NewOrder");
const NewOrderPage = lazy(() => loadNeworder().then((m) => ({ default: m.NewOrderPage })));
const loadOrders = () => import("./pages/orders/Orders");
const OrdersPage = lazy(() => loadOrders().then((m) => ({ default: m.OrdersPage })));
const loadPeople = () => import("./pages/People");
const PeoplePage = lazy(() => loadPeople().then((m) => ({ default: m.PeoplePage })));
const loadPrint = () => import("./pages/print/Print");
const PrintClientReport = lazy(() => loadPrint().then((m) => ({ default: m.PrintClientReport })));
const PrintClientsSheet = lazy(() => loadPrint().then((m) => ({ default: m.PrintClientsSheet })));
const PrintLabels = lazy(() => loadPrint().then((m) => ({ default: m.PrintLabels })));
const PrintReceipt = lazy(() => loadPrint().then((m) => ({ default: m.PrintReceipt })));
const PrintReport = lazy(() => loadPrint().then((m) => ({ default: m.PrintReport })));
const PrintStatement = lazy(() => loadPrint().then((m) => ({ default: m.PrintStatement })));
const loadPurchasing = () => import("./pages/Purchasing");
const PurchasingPage = lazy(() => loadPurchasing().then((m) => ({ default: m.PurchasingPage })));
const loadReports = () => import("./pages/Reports");
const ReportsPage = lazy(() => loadReports().then((m) => ({ default: m.ReportsPage })));
const loadRoles = () => import("./pages/Roles");
const RolesPage = lazy(() => loadRoles().then((m) => ({ default: m.RolesPage })));
const loadSettings = () => import("./pages/settings/Settings");
const SettingsPage = lazy(() => loadSettings().then((m) => ({ default: m.SettingsPage })));
const loadUsers = () => import("./pages/Users");
const UsersPage = lazy(() => loadUsers().then((m) => ({ default: m.UsersPage })));
const loadWarehouse = () => import("./pages/warehouse/Warehouse");
const WarehousePage = lazy(() => loadWarehouse().then((m) => ({ default: m.WarehousePage })));
const loadDistribution = () => import("./pages/distribution/Distribution");
const DistributionPage = lazy(() => loadDistribution().then((m) => ({ default: m.DistributionPage })));
const loadPrintroute = () => import("./pages/distribution/PrintRoute");
const PrintRouteSheet = lazy(() => loadPrintroute().then((m) => ({ default: m.PrintRouteSheet })));
const loadProduction = () => import("./pages/production/Production");
const ProductionPage = lazy(() => loadProduction().then((m) => ({ default: m.ProductionPage })));
const loadRequests = () => import("./pages/requests/Requests");
const RequestsPage = lazy(() => loadRequests().then((m) => ({ default: m.RequestsPage })));

/** The screens people open most, fetched quietly after the first screen is up. */
const PREFETCH = [loadOrders, loadNeworder, loadMyday, loadClients, loadClientdetail, loadDailyclose];

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
  useEffect(() => {
    if (status !== "ready") return;
    const t = setTimeout(() => PREFETCH.forEach((load) => void load().catch(() => undefined)), 2500);
    return () => clearTimeout(t);
  }, [status]);
  if (status === "loading") return <Spinner />;
  if (status === "setup") return <SetupPage />;
  if (status === "login") return <LoginPage />;
  return (
    <AppSettingsProvider>
      <BrowserRouter>
        <Suspense fallback={<Spinner />}>
          <Routes>
          {/* print views: no menus, sized for the printer */}
          <Route path="print/receipt/:id" element={g("orders", <PrintReceipt />)} />
          <Route path="print/labels" element={g("warehouse", <PrintLabels />)} />
          <Route path="print/statement/:id" element={g("clients", <PrintStatement />)} />
          <Route path="print/report" element={g("reports", <PrintReport />)} />
          <Route path="print/client-report/:id" element={g("clients", <PrintClientReport />)} />
          <Route path="print/clients-sheet" element={g("reports", <PrintClientsSheet />)} />
          <Route path="print/route" element={g("orders", <PrintRouteSheet />)} />
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="day" element={g("dashboard", <MyDayPage />)} />
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
        </Suspense>
      </BrowserRouter>
    </AppSettingsProvider>
  );
}
