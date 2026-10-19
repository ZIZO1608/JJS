import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { Empty } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: "start" | "end";
  className?: string;
}

/** Search + sort + pagination on the client. Fine for the hundreds of rows a deli shop has. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  pageSize = 15,
  toolbar,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  searchText?: (r: T) => string;
  pageSize?: number;
  toolbar?: ReactNode;
  onRowClick?: (r: T) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = needle && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(needle)) : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sortValue && sort) {
      const sv = col.sortValue;
      list = [...list].sort((a, b) => {
        const x = sv(a);
        const y = sv(b);
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return list;
  }, [rows, q, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div className="card p-0">
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {searchText && (
            <input
              className="input max-w-xs"
              type="search"
              placeholder={t("common.search")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              aria-label={t("common.search")}
            />
          )}
          <div className="ms-auto flex flex-wrap gap-2">{toolbar}</div>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="p-4">
          <Empty text={t("common.none")} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`th ${c.align === "end" ? "text-end" : ""} ${c.className ?? ""}`}>
                    {c.sortValue ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        <span aria-hidden>{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={rowKey(r)} className={onRowClick ? "cursor-pointer hover:bg-sunken" : ""} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {columns.map((c) => (
                    <td key={c.key} className={`td ${c.align === "end" ? "text-end" : ""} ${c.className ?? ""}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 p-3 text-sm text-muted">
        <span>{t("common.total", { n: filtered.length })}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost px-2 py-1" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              {t("common.prev")}
            </button>
            <span className="num">{t("common.page", { page: current, pages })}</span>
            <button className="btn btn-ghost px-2 py-1" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              {t("common.next")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
