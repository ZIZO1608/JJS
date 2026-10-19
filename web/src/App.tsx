import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { MODULES, type Module } from "@shared/permissions";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AuditPage } from "./pages/Audit";
import { LoginPage, SetupPage } from "./pages/Auth";
import { ComingLater, HomePage } from "./pages/Home";
import { RolesPage } from "./pages/Roles";
import { SettingsPage } from "./pages/settings/Settings";
import { UsersPage } from "./pages/Users";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";

/** The UI hides what a role cannot use; the server refuses it anyway. */
function Guard({ module, children }: { module: Module; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (!can(module, "view")) return <p className="py-10 text-center text-muted">{t("errors.forbidden")}</p>;
  return <>{children}</>;
}

function ModuleRoute() {
  const { module } = useParams();
  if (!module || !(MODULES as readonly string[]).includes(module)) return <Navigate to="/" replace />;
  return (
    <Guard module={module as Module}>
      <ComingLater module={module as Module} />
    </Guard>
  );
}

export function App() {
  const { status } = useAuth();
  if (status === "loading") return <Spinner />;
  if (status === "setup") return <SetupPage />;
  if (status === "login") return <LoginPage />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="users" element={<Guard module="users"><UsersPage /></Guard>} />
          <Route path="roles" element={<Guard module="roles"><RolesPage /></Guard>} />
          <Route path="audit" element={<Guard module="audit"><AuditPage /></Guard>} />
          <Route path="settings/*" element={<Guard module="settings"><SettingsPage /></Guard>} />
          <Route path="m/:module" element={<ModuleRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
