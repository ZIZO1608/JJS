import { useCallback, useEffect, useState } from "react";
import { DataTable } from "../components/DataTable";
import { Field, Modal, PageHeader, Select, Spinner, StatusDot, TextInput } from "../components/ui";
import { ApiError, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

interface User {
  id: string;
  name: string;
  username: string;
  roleId: string;
  language: "ar" | "en";
  active: boolean;
  createdAt: string;
}
interface Role {
  id: string;
  nameAr: string;
  nameEn: string;
  systemKey: string | null;
}

function UserDialog({ user, roles, onClose, onSaved }: { user: User | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { t, pick, err, fieldErrors } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    name: user?.name ?? "",
    username: user?.username ?? "",
    password: "",
    roleId: user?.roleId ?? roles.find((r) => r.systemKey === "member")?.id ?? "",
    language: user?.language ?? ("ar" as "ar" | "en"),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (user) await put(`/users/${user.id}`, f);
      else await post("/users", f);
      toast(t("common.saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") setErrors({ username: t("errors.duplicate") });
      else if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? t("users.editTitle") : t("users.newTitle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.name || !f.username || (!user && f.password.length < 6)}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t("common.name")} htmlFor="u-name" error={errors.name}>
          <TextInput id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t("users.username")} htmlFor="u-username" error={errors.username} hint={t("auth.usernameHint")}>
          <TextInput id="u-username" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={user ? t("users.passwordKeep") : t("users.passwordNew")} htmlFor="u-pass" error={errors.password} hint={t("auth.passwordHint")}>
          <TextInput id="u-pass" type="password" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("users.role")} htmlFor="u-role">
            <Select id="u-role" value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {pick(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("users.language")} htmlFor="u-lang">
            <Select id="u-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as "ar" | "en" })}>
              <option value="ar">عربي</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { t, pick, err, fmtDate, fieldErrors } = useI18n();
  const { me, can } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<User | null | "new">(null);

  const load = useCallback(async () => {
    const [u, r] = await Promise.all([get<{ users: User[] }>("/users"), can("roles", "view") ? get<{ roles: Role[] }>("/roles") : Promise.resolve({ roles: [] })]);
    setUsers(u.users);
    setRoles(r.roles);
  }, [can]);
  useEffect(() => {
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const roleName = (id: string) => {
    const r = roles.find((x) => x.id === id);
    return r ? pick(r) : "—";
  };

  const toggle = async (u: User) => {
    try {
      await post(`/users/${u.id}/active`, { active: !u.active });
      toast(u.active ? t("users.deactivated") : t("users.activated"));
      await load();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  if (!users) return <Spinner />;
  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          can("users", "create") && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              {t("users.new")}
            </button>
          )
        }
      />
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        searchText={(u) => `${u.name} ${u.username} ${roleName(u.roleId)}`}
        columns={[
          {
            key: "name",
            header: t("common.name"),
            sortValue: (u) => u.name,
            render: (u) => (
              <span className="font-semibold">
                {u.name} {u.id === me?.id && <span className="chip ms-1">{t("users.you")}</span>}
              </span>
            ),
          },
          { key: "username", header: t("users.username"), sortValue: (u) => u.username, render: (u) => <span className="ltr text-muted">{u.username}</span> },
          { key: "role", header: t("users.role"), sortValue: (u) => roleName(u.roleId), render: (u) => roleName(u.roleId) },
          {
            key: "status",
            header: t("common.status"),
            sortValue: (u) => (u.active ? 0 : 1),
            render: (u) => (
              <span className="chip">
                <StatusDot tone={u.active ? "good" : "mute"} />
                {u.active ? t("common.active") : t("common.inactive")}
              </span>
            ),
          },
          { key: "created", header: t("backups.date"), sortValue: (u) => u.createdAt, render: (u) => <span className="text-muted">{fmtDate(u.createdAt)}</span> },
          {
            key: "actions",
            header: "",
            align: "end",
            render: (u) =>
              can("users", "edit") && (
                <div className="flex justify-end gap-1">
                  <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(u)}>
                    {t("common.edit")}
                  </button>
                  {u.id !== me?.id && (
                    <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => void toggle(u)}>
                      {u.active ? t("common.deactivate") : t("common.activate")}
                    </button>
                  )}
                </div>
              ),
          },
        ]}
      />
      {editing && (
        <UserDialog
          user={editing === "new" ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}
