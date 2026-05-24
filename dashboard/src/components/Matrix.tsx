// Exec × Client grid. Each cell shows revenue and activity count. Cells link
// through to the per-exec deep-dive scoped to that client (via the client
// drill-down for now — exec×company filter can come later).

import Link from "next/link";
import { formatCurrency } from "@/lib/format";

export type MatrixInput = {
  execs: string[];
  companies: { id: string; name: string; slug: string }[];
  cellsByKey: Map<string, { revenue: number; activities: number; wins: number }>;
};

export function Matrix({ execs, companies, cellsByKey }: MatrixInput) {
  if (execs.length === 0 || companies.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
        No matrix data in this period.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left font-normal">Exec</th>
            {companies.map(c => (
              <th key={c.id} className="px-3 py-2 text-right font-normal">{c.name}</th>
            ))}
            <th className="px-3 py-2 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {execs.map(exec => {
            let rowRevenue = 0, rowActivities = 0;
            return (
              <tr key={exec} className="border-t border-zinc-800">
                <td className="px-4 py-2.5 font-medium">
                  <Link href={`/execs/${encodeURIComponent(exec)}`} className="text-zinc-100 hover:text-white">
                    {exec}
                  </Link>
                </td>
                {companies.map(c => {
                  const cell = cellsByKey.get(`${exec}|${c.id}`);
                  if (cell) {
                    rowRevenue += cell.revenue;
                    rowActivities += cell.activities;
                  }
                  return (
                    <td key={c.id} className="px-3 py-2.5 text-right text-xs">
                      {cell && cell.activities > 0 ? (
                        <Link href={`/companies/${c.slug}`} className="block hover:bg-zinc-900/50 rounded -m-0.5 p-0.5">
                          {cell.revenue > 0 && (
                            <div className="tabular-nums text-emerald-400">{formatCurrency(cell.revenue)}</div>
                          )}
                          <div className="tabular-nums text-zinc-500">{cell.activities} acts{cell.wins > 0 ? ` · ${cell.wins}w` : ""}</div>
                        </Link>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right text-xs">
                  {rowRevenue > 0 && (
                    <div className="tabular-nums text-emerald-400">{formatCurrency(rowRevenue)}</div>
                  )}
                  <div className="tabular-nums text-zinc-400">{rowActivities}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
