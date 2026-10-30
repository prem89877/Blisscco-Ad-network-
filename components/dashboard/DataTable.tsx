import type { ReactNode } from "react";

export type Column<T> = { header: string; cell: (row: T) => ReactNode; numeric?: boolean };

type Props<T> = {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
};

/** Table on md+ screens, stacked cards on phones. First column is the card title. */
export default function DataTable<T>({ caption, columns, rows, rowKey }: Props<T>) {
  const [first, ...rest] = columns;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface text-mist/70">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={`px-4 py-3 font-medium ${c.numeric ? "text-right" : ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-line">
                {columns.map((c) => (
                  <td key={c.header} className={`px-4 py-3 ${c.numeric ? "text-right font-mono" : ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-2 font-medium">{first.cell(r)}</div>
            <dl>
              {rest.map((c) => (
                <div key={c.header} className="flex items-center justify-between gap-4 py-1 text-sm">
                  <dt className="text-mist/60">{c.header}</dt>
                  <dd className="text-right">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
