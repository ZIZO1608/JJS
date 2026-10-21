import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppSettings } from "../../lib/appSettings";
import { money, today, usd } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import type { Catalog, Lookup } from "../../lib/types";
import type { RouteSheet } from "./Distribution";

/** A4 route sheet the rep carries: shops in order, what to deliver, what to collect, blanks for returns. */
export function PrintRouteSheet() {
  const [sp] = useSearchParams();
  const { tr, pick, fmtDate, lang } = useI18n();
  const { s } = useAppSettings();
  const date = sp.get("date") ?? today();
  const repId = sp.get("repId");
  const sheet = useData<RouteSheet>(`/route-sheet?date=${date}${repId ? `&repId=${repId}` : ""}`);
  const catalog = useData<Catalog>("/menu/catalog");
  const areas = useData<{ items: Lookup[] }>("/lookups?type=area");
  const ready = !!sheet.data && !!catalog.data && !!areas.data;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [ready]);
  if (!ready) return <p className="p-6">…</p>;
  const prod = (id: string) => {
    const p = catalog.data!.products.find((x) => x.id === id);
    return p ? pick(p) : "?";
  };
  const totalOwed = sheet.data!.stops.reduce((t, x) => t + Math.max(0, -x.balanceUsd), 0);
  return (
    <div className="mx-auto max-w-[190mm] bg-white p-6 text-[12px] text-black">
      <style>{`@page { size: A4; margin: 12mm } body { background: #fff }`}</style>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <button className="btn" onClick={() => window.print()}>
          {tr("اطبع", "Print")}
        </button>
        <button className="btn btn-ghost" onClick={() => window.close()}>
          {tr("إغلاق", "Close")}
        </button>
      </div>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <div className="text-xl font-bold">{s ? pick(s.business) : "JJ's"}</div>
          <div>{tr("ورقة خط التوزيع", "Route sheet")}</div>
        </div>
        <div className="text-end">
          <div className="font-bold">{fmtDate(date)}</div>
          <div>{sheet.data!.rep?.name ?? tr("كل المندوبين", "All reps")}</div>
          <div>
            {tr("للتحصيل", "To collect")}: <b className="num ltr">{usd(totalOwed)}</b>
          </div>
        </div>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-start">
            <th className="w-6 py-1 text-start">#</th>
            <th className="py-1 text-start">{tr("المحل", "Shop")}</th>
            <th className="py-1 text-start">{tr("يسلَّم", "Deliver")}</th>
            <th className="w-24 py-1 text-end">{tr("الرصيد", "Balance")}</th>
            <th className="w-20 py-1 text-center">{tr("مرتجع", "Returned")}</th>
            <th className="w-20 py-1 text-center">{tr("مقبوض", "Collected")}</th>
          </tr>
        </thead>
        <tbody>
          {sheet.data!.stops.map((x, i) => (
            <tr key={x.clientId} className="border-b border-gray-400 align-top">
              <td className="py-1.5 num">{i + 1}</td>
              <td className="py-1.5">
                <b>{x.name}</b>
                <div className="text-[11px]">{[areas.data!.items.find((a) => a.id === x.areaId) ? pick(areas.data!.items.find((a) => a.id === x.areaId)!) : "", x.address, x.phone].filter(Boolean).join(" · ")}</div>
              </td>
              <td className="py-1.5">
                {x.standing.flatMap((st) => st.lines.map((l) => `${l.qty} × ${prod(l.productId)}`)).join("، ")}
                {x.orders.map((o) => (
                  <div key={o.id}>
                    #{o.number} · {o.items} {tr("قطعة", "pcs")} · <span className="num ltr">{money(o.total, o.currency, lang)}</span>
                  </div>
                ))}
                {x.consignments.map((c) => (
                  <div key={c.id}>
                    C{c.number}: {tr("عدّ الباقي عند المحل", "count what is left at the shop")}
                  </div>
                ))}
              </td>
              <td className="py-1.5 text-end num ltr">
                {x.balanceUsd < -0.009 ? usd(-x.balanceUsd) : "—"}
                {x.overdueDays > 0 && <div className="text-[11px]">{tr(`متأخر ${x.overdueDays} يوم`, `${x.overdueDays}d late`)}</div>}
              </td>
              <td className="py-1.5 text-center">______</td>
              <td className="py-1.5 text-center">______</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 grid grid-cols-3 gap-6 text-[11px]">
        <div className="border-t border-black pt-1">{tr("مصاريف الطريق / وقود", "Road expenses / fuel")}</div>
        <div className="border-t border-black pt-1">{tr("توقيع المندوب", "Rep signature")}</div>
        <div className="border-t border-black pt-1">{tr("استلم الكاش", "Cash received by")}</div>
      </div>
    </div>
  );
}
