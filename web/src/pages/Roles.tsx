import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIONS, ACTION_LABEL, MODULES, MODULE_LABEL, MODULE_STAGE, perm, usesSimpleMode } from "@shared/permissions";
import { CURRENT_STAGE } from "../components/Layout";
import { ConfirmDialog, Field, PageHeader, Spinner, TextInput } from "../components/ui";
import { ApiError, del, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

interface Role {
  id: string;
  nameAr: string;
  nameEn: string;
  systemKey: "admin" | "manager" | "member" | null;
  permissions: string[];
  userCount: number;
}

const blank = (): Omit<Role, "id" | "userCount" | "systemKey"> & { id?: string; systemKey: Role["systemKey"] } => ({
  nameAr: "",
  nameEn: "",
  systemKey: null,
  permissions: ["home:view"],
});

export function RolesPage() {
  const { t, pick, err, fieldErrors } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(blank());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await get<{ roles: Role[] }>("/roles");
    setRoles(r.roles);
    return r.roles;
  }, []);

  useEffect(() => {
    load()
      .then((list) => {
        const first = list[0];
        if (first) {
          setSelected(first.id);
          setDraft({ ...first });
        }
      })
      .catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const choose = (r: Role | "new") => {
    setErrors({});
    if (r === "new") {
      setSelected("new");
      setDraft(blank());
    } else {
      setSelected(r.id);
      setDraft({ ...r });
    }
  };

  const locked = draft.systemKey === "admin";
  const editable = selected === "new" ? can("roles", "create") : can("roles", "edit");
  const set = useMemo(() => new Set(draft.permissions), [draft.permissions]);
  const toggle = (p: string) => {
    if (locked || !editable) return;
    const next = new Set(set);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setDraft({ ...draft, permissions: [...next] });
  };
  const toggleRow = (m: (typeof MODULES)[number]) => {
    if (locked || !editable) return;
    const all = ACTIONS.every((a) => set.has(perm(m, a)));
    const next = new Set(set);
    for (const a of ACTIONS) all ? next.delete(perm(m, a)) : next.add(perm(m, a));
    setDraft({ ...draft, permissions: [...next] });
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { nameAr: draft.nameAr, nameEn: draft.nameEn, permissions: draft.permissions };
      const r = selected === "new" ? await post<{ role: Role }>("/roles", body) : await put<{ role: Role }>(`/roles/${selected}`, body);
      toast(t("roles.saved"));
      await load();
      choose(r.role);
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirm(false);
    try {
      await del(`/roles/${selected}`);
      toast(t("common.deleted"));
      const list = await load();
      if (list[0]) choose(list[0]);
    } catch (e) {
      toast(err(e), "error");
    }
  };

  if (!roles) return <Spinner />;
  return (
    <>
      <PageHeader
        title={t("roles.title")}
        subtitle={t("roles.subtitle")}
        actions={
          can("roles", "create") && (
            <button className="btn btn-primary" onClick={() => choose("new")}>
              {t("roles.new")}
            </button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="card flex flex-col gap-1 p-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => choose(r)}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-start ${selected === r.id ? "bg-sunken font-semibold" : "hover:bg-sunken"}`}
            >
              <span>{pick(r)}</span>
              <span className="text-xs text-faint num">{t("roles.users", { n: r.userCount })}</span>
            </button>
          ))}
          {selected === "new" && <div className="rounded-lg bg-sunken px-3 py-2.5 font-semibold">{t("roles.new")}</div>}
        </div>

        <div className="card min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.nameAr")} htmlFor="r-ar" error={errors.nameAr}>
              <TextInput id="r-ar" dir="rtl" value={draft.nameAr} disabled={!editable} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
            </Field>
            <Field label={t("common.nameEn")} htmlFor="r-en" error={errors.nameEn}>
              <TextInput id="r-en" dir="ltr" value={draft.nameEn} disabled={!editable} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
            </Field>
          </div>
          <p className="mt-3 text-sm text-muted">
            {draft.systemKey && <span className="chip me-2">{t("roles.system")}</span>}
            {locked ? t("roles.adminLocked") : usesSimpleMode(draft.permissions) ? t("roles.simpleMode") : t("roles.fullMode")}
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">{t("roles.module")}</th>
                  <th className="th text-center">{t("roles.selectAll")}</th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="th text-center">
                      {pick(ACTION_LABEL[a])}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((m) => {
                  const all = ACTIONS.every((a) => set.has(perm(m, a)));
                  return (
                    <tr key={m}>
                      <td className="td whitespace-nowrap">
                        {pick(MODULE_LABEL[m])}
                        {MODULE_STAGE[m] > CURRENT_STAGE && <span className="ms-2 text-xs text-faint">{t("nav.stage", { n: MODULE_STAGE[m] })}</span>}
                      </td>
                      <td className="td text-center">
                        <input type="checkbox" className="h-4 w-4 accent-ink" checked={all} disabled={locked || !editable} onChange={() => toggleRow(m)} aria-label={`${pick(MODULE_LABEL[m])} — ${t("roles.selectAll")}`} />
                      </td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="td text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ink"
                            checked={set.has(perm(m, a))}
                            disabled={locked || !editable}
                            onChange={() => toggle(perm(m, a))}
                            aria-label={`${pick(MODULE_LABEL[m])} — ${pick(ACTION_LABEL[a])}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editable && (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {selected !== "new" && !draft.systemKey && can("roles", "delete") && (
                <button className="btn btn-danger" onClick={() => setConfirm(true)}>
                  {t("common.delete")}
                </button>
              )}
              <button className="btn btn-primary" onClick={save} disabled={busy || !draft.nameAr || !draft.nameEn}>
                {busy ? t("common.saving") : t("common.save")}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirm && <ConfirmDialog text={t("common.confirmDelete", { name: pick(draft) })} onConfirm={remove} onClose={() => setConfirm(false)} />}
    </>
  );
}
