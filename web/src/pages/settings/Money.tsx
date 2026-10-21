import { useState } from "react";
import { Empty, Field, Modal, Select, Spinner, TextInput } from "../../components/ui";
import { post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, num, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import type { CashBox, Employee, PaymentMethod } from "../../lib/types";
import { WithdrawDialog } from "../five/FiveAnswers";
import { ActionDialog, Check, CurrencySelect, DeleteConfirm, NameFields, NumInput, RowActions, useSaver } from "../kit";

const BOX_KIND: Record<CashBox["kind"], { ar: string; en: string }> = {
  cash: { ar: "كاش", en: "Cash" },
  wallet: { ar: "محفظة إلكترونية", en: "Wallet" },
  rep: { ar: "مع مندوب", en: "With a rep" },
  bank: { ar: "بنك", en: "Bank" },
};
const METHOD_KIND: Record<PaymentMethod["kind"], { ar: string; en: string }> = {
  box: { ar: "بيدخل على صندوق", en: "Goes into a box" },
  credit: { ar: "على الحساب (دين)", en: "On account (credit)" },
  salary: { ar: "خصم من الراتب", en: "From salary" },
};
const MOVE_LABEL: Record<string, { ar: string; en: string }> = {
  sale: { ar: "بيع", en: "Sale" },
  client_payment: { ar: "دفعة زبون", en: "Client payment" },
  topup: { ar: "شحن رصيد", en: "Top-up" },
  expense: { ar: "مصروف", en: "Expense" },
  purchase: { ar: "مشتريات", en: "Purchase" },
  transfer: { ar: "تحويل", en: "Transfer" },
  handover: { ar: "تسليم مندوب", en: "Rep handover" },
  count_adjust: { ar: "فرق جرد", en: "Count difference" },
  salary: { ar: "رواتب", en: "Salaries" },
  advance: { ar: "سلفة", en: "Advance" },
  opening: { ar: "رصيد افتتاحي", en: "Opening" },
  withdrawal: { ar: "سحب شخصي", en: "Withdrawal" },
  refund: { ar: "استرداد", en: "Refund" },
};

function BoxDialog({ box, onClose, onSaved }: { box: CashBox | null; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const { errors, busy, run } = useSaver();
  const emps = useData<{ rows: Employee[] }>(can("people", "view") ? "/people/employees" : null);
  const [f, setF] = useState({ nameAr: box?.nameAr ?? "", nameEn: box?.nameEn ?? "", kind: box?.kind ?? ("cash" as CashBox["kind"]), currency: box?.currency ?? ("SYP" as Currency), employeeId: box?.employeeId ?? "", active: box?.active ?? true });
  const save = async () => {
    const body = { ...f, employeeId: f.kind === "rep" ? f.employeeId || null : null };
    if (await run(() => (box ? put(`/money/boxes/${box.id}`, body) : post("/money/boxes", body)))) onSaved();
  };
  return (
    <ActionDialog title={box ? tr("تعديل صندوق", "Edit box") : tr("صندوق جديد", "New box")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="bx" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("النوع", "Kind")} htmlFor="bx-k">
          <Select id="bx-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CashBox["kind"] })}>
            {(Object.keys(BOX_KIND) as CashBox["kind"][]).map((k) => (
              <option key={k} value={k}>
                {pick(BOX_KIND[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="bx-c" hint={box ? tr("ما بتتغيّر إذا في حركات", "Cannot change once it has moves") : undefined}>
          <CurrencySelect id="bx-c" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
      </div>
      {f.kind === "rep" && emps.data && (
        <Field label={tr("المندوب", "Rep")} htmlFor="bx-e">
          <Select id="bx-e" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">—</option>
            {emps.data.rows.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {tr("فعّال", "Active")}
      </Check>
    </ActionDialog>
  );
}

function MethodDialog({ m, boxes, onClose, onSaved }: { m: PaymentMethod | null; boxes: CashBox[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: m?.nameAr ?? "", nameEn: m?.nameEn ?? "", kind: m?.kind ?? ("box" as PaymentMethod["kind"]), boxId: m?.boxId ?? "", sort: String(m?.sort ?? 0), active: m?.active ?? true });
  const save = async () => {
    const body = { nameAr: f.nameAr, nameEn: f.nameEn, kind: f.kind, boxId: f.kind === "box" ? f.boxId || null : null, sort: Math.round(num(f.sort) || 0), active: f.active };
    if (await run(() => (m ? put(`/money/methods/${m.id}`, body) : post("/money/methods", body)))) onSaved();
  };
  return (
    <ActionDialog title={m ? tr("تعديل طريقة دفع", "Edit payment method") : tr("طريقة دفع جديدة", "New payment method")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn || (f.kind === "box" && !f.boxId)}>
      <NameFields f={f} set={setF} errors={errors} idp="pm" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("النوع", "Kind")} htmlFor="pm-k">
          <Select id="pm-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PaymentMethod["kind"] })} disabled={!!m?.systemKey}>
            {(Object.keys(METHOD_KIND) as PaymentMethod["kind"][]).map((k) => (
              <option key={k} value={k}>
                {pick(METHOD_KIND[k])}
              </option>
            ))}
          </Select>
        </Field>
        {f.kind === "box" && (
          <Field label={tr("الصندوق", "Box")} htmlFor="pm-b" error={errors.boxId}>
            <Select id="pm-b" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })}>
              <option value="">—</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {tr("ظاهرة بشاشة الدفع", "Shown when paying")}
      </Check>
    </ActionDialog>
  );
}

interface Move {
  id: string;
  type: string;
  amount: number;
  currency: Currency;
  note: string;
  businessDate: string;
  createdAt: string;
  userName: string | null;
}

function MovesDialog({ box, onClose }: { box: CashBox; onClose: () => void }) {
  const { tr, pick, fmtDate, lang } = useI18n();
  const d = useData<{ box: CashBox; rows: Move[] }>(`/money/boxes/${box.id}/moves`);
  return (
    <Modal wide title={pick(box)} onClose={onClose} footer={<button className="btn" onClick={onClose}>{tr("إغلاق", "Close")}</button>}>
      {!d.data ? (
        <Spinner />
      ) : d.data.rows.length === 0 ? (
        <Empty text={tr("ما في حركات.", "No moves.")} />
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {d.data.rows.map((m) => (
                <tr key={m.id}>
                  <td className="td whitespace-nowrap">{fmtDate(m.createdAt, true)}</td>
                  <td className="td">{pick(MOVE_LABEL[m.type] ?? { ar: m.type, en: m.type })}</td>
                  <td className="td text-muted">{m.note}</td>
                  <td className={`td text-end num ltr ${m.amount < 0 ? "text-bad" : ""}`}>{money(m.amount, m.currency, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function TransferDialog({ boxes, onClose, onSaved }: { boxes: CashBox[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { busy, run } = useSaver();
  const [f, setF] = useState({ from: "", to: "", amount: "", note: "" });
  const from = boxes.find((b) => b.id === f.from);
  const save = async () => {
    if (await run(() => post("/money/transfer", { fromBoxId: f.from, toBoxId: f.to, amount: num(f.amount), note: f.note }), tr("تم التحويل.", "Transferred."))) onSaved();
  };
  return (
    <ActionDialog title={tr("تحويل بين صندوقين", "Move money between boxes")} onClose={onClose} onSave={save} busy={busy} disabled={!f.from || !f.to || f.from === f.to || !(num(f.amount) > 0)}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("من", "From")} htmlFor="tf-f">
          <Select id="tf-f" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
            <option value="">—</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="tf-t">
          <Select id="tf-t" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
            <option value="">—</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={tr(`المبلغ${from ? ` (${from.currency})` : ""}`, `Amount${from ? ` (${from.currency})` : ""}`)} htmlFor="tf-a">
        <NumInput id="tf-a" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
      </Field>
      <Field label={tr("ملاحظة", "Note")} htmlFor="tf-n">
        <TextInput id="tf-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </ActionDialog>
  );
}

function OpeningDialog({ box, onClose, onSaved }: { box: CashBox; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { busy, run } = useSaver();
  const [amount, setAmount] = useState("");
  const save = async () => {
    if (await run(() => post("/money/opening", { boxId: box.id, amount: num(amount) }))) onSaved();
  };
  return (
    <ActionDialog title={tr(`الرصيد الافتتاحي: ${pick(box)}`, `Opening balance: ${pick(box)}`)} onClose={onClose} onSave={save} busy={busy} disabled={amount === "" || !Number.isFinite(num(amount))}>
      <p className="text-sm text-muted">{tr("المصاري اللي كانت بالصندوق لما بلّشت تستعمل النظام. بتنحط مرة وحدة بس.", "The money that was in the box when you started using the system. Set once only.")}</p>
      <Field label={`${tr("المبلغ", "Amount")} (${box.currency})`} htmlFor="op-a">
        <NumInput id="op-a" value={amount} onChange={setAmount} />
      </Field>
    </ActionDialog>
  );
}

interface Withdrawal {
  id: string;
  amount: number;
  currency: Currency;
  amountUsd: number;
  note: string;
  businessDate: string;
  box: { nameAr: string; nameEn: string };
}

export function MoneyTab() {
  const { tr, pick, lang, fmtDate } = useI18n();
  const { can } = useAuth();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const methods = useData<{ rows: PaymentMethod[] }>("/money/methods");
  const owner = can("daily_close", "edit");
  const withdrawals = useData<{ rows: Withdrawal[]; totalUsd: number }>(owner ? "/money/withdrawals" : null);
  const [boxDlg, setBoxDlg] = useState<CashBox | "new" | null>(null);
  const [methodDlg, setMethodDlg] = useState<PaymentMethod | "new" | null>(null);
  const [moves, setMoves] = useState<CashBox | null>(null);
  const [opening, setOpening] = useState<CashBox | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [delBox, setDelBox] = useState<CashBox | null>(null);
  const [delMethod, setDelMethod] = useState<PaymentMethod | null>(null);
  if (!boxes.data || !methods.data) return <Spinner />;
  const reload = () => {
    void boxes.reload();
    void methods.reload();
    void withdrawals.reload();
  };
  const activeBoxes = boxes.data.rows.filter((b) => b.active);
  return (
    <div className="grid max-w-4xl gap-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("الصناديق", "Cash boxes")}</h2>
          <div className="flex flex-wrap gap-2">
            {can("daily_close", "create") && (
              <button className="btn" onClick={() => setTransfer(true)}>
                {tr("تحويل", "Transfer")}
              </button>
            )}
            {owner && (
              <button className="btn" onClick={() => setWithdraw(true)}>
                {tr("سحب شخصي", "Withdraw")}
              </button>
            )}
            {can("settings", "create") && (
              <button className="btn btn-primary" onClick={() => setBoxDlg("new")}>
                {tr("+ صندوق", "+ Box")}
              </button>
            )}
          </div>
        </div>
        <div className="card p-0">
          <table className="w-full text-sm">
            <tbody>
              {boxes.data.rows.map((b) => (
                <tr key={b.id} className={b.active ? "" : "opacity-60"}>
                  <td className="td">
                    <div className="font-semibold">{pick(b)}</div>
                    <div className="text-xs text-faint">
                      {pick(BOX_KIND[b.kind])} · {b.currency}
                    </div>
                  </td>
                  <td className="td text-end text-lg font-bold num ltr">{b.balance === null ? "—" : money(b.balance, b.currency, lang)}</td>
                  <td className="td">
                    <RowActions
                      canEdit={can("settings", "edit")}
                      canDelete={can("settings", "delete") && !b.systemKey}
                      onEdit={() => setBoxDlg(b)}
                      onDelete={() => setDelBox(b)}
                      extra={
                        <>
                          <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setMoves(b)}>
                            {tr("الحركات", "Moves")}
                          </button>
                          {can("settings", "edit") && !(b as CashBox & { hasOpening?: boolean }).hasOpening && (
                            <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setOpening(b)}>
                              {tr("افتتاحي", "Opening")}
                            </button>
                          )}
                        </>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("طرق الدفع", "Payment methods")}</h2>
          {can("settings", "create") && (
            <button className="btn btn-primary" onClick={() => setMethodDlg("new")}>
              {tr("+ طريقة دفع", "+ Method")}
            </button>
          )}
        </div>
        <div className="card p-0">
          <table className="w-full text-sm">
            <tbody>
              {methods.data.rows.map((m) => (
                <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                  <td className="td font-semibold">{pick(m)}</td>
                  <td className="td text-muted">
                    {pick(METHOD_KIND[m.kind])}
                    {m.boxId && ` → ${pick(boxes.data!.rows.find((b) => b.id === m.boxId) ?? { nameAr: "?", nameEn: "?" })}`}
                  </td>
                  <td className="td">
                    <RowActions canEdit={can("settings", "edit")} canDelete={can("settings", "delete") && !m.systemKey} onEdit={() => setMethodDlg(m)} onDelete={() => setDelMethod(m)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {owner && withdrawals.data && (
        <section>
          <h2 className="mb-1 text-lg font-bold">{tr("السحوبات الشخصية", "Personal withdrawals")}</h2>
          <p className="mb-3 text-sm text-muted">{tr("مو مصاريف: بتنقص الصندوق بس ما بتأثر على ربح المحل.", "Not expenses: they lower the box, not the shop's profit.")}</p>
          {withdrawals.data.rows.length === 0 ? (
            <Empty text={tr("ما في سحوبات.", "No withdrawals.")} />
          ) : (
            <div className="card p-0">
              <table className="w-full text-sm">
                <tbody>
                  {withdrawals.data.rows.slice(0, 50).map((w) => (
                    <tr key={w.id}>
                      <td className="td">{fmtDate(w.businessDate)}</td>
                      <td className="td">{pick(w.box)}</td>
                      <td className="td text-muted">{w.note}</td>
                      <td className="td text-end num ltr">{money(-w.amount, w.currency, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {boxDlg && <BoxDialog box={boxDlg === "new" ? null : boxDlg} onClose={() => setBoxDlg(null)} onSaved={() => (setBoxDlg(null), reload())} />}
      {methodDlg && <MethodDialog m={methodDlg === "new" ? null : methodDlg} boxes={activeBoxes} onClose={() => setMethodDlg(null)} onSaved={() => (setMethodDlg(null), reload())} />}
      {moves && <MovesDialog box={moves} onClose={() => setMoves(null)} />}
      {opening && <OpeningDialog box={opening} onClose={() => setOpening(null)} onSaved={() => (setOpening(null), reload())} />}
      {transfer && <TransferDialog boxes={activeBoxes} onClose={() => setTransfer(false)} onSaved={() => (setTransfer(false), reload())} />}
      {withdraw && <WithdrawDialog onClose={() => setWithdraw(false)} onDone={() => (setWithdraw(false), reload())} />}
      {delBox && <DeleteConfirm name={pick(delBox)} path={`/money/boxes/${delBox.id}`} onClose={() => setDelBox(null)} onDone={reload} />}
      {delMethod && <DeleteConfirm name={pick(delMethod)} path={`/money/methods/${delMethod.id}`} onClose={() => setDelMethod(null)} onDone={reload} />}
    </div>
  );
}
