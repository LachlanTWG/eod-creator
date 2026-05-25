import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireRosterOrAdmin } from "@/lib/viewer";
import { loadExecSummaries } from "@/lib/analytics";
import { formatCurrency, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExecsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const viewer = await getViewer();
  requireRosterOrAdmin(viewer);

  const params = await searchParams;
  const days = Math.min(365, Math.max(1, parseInt(params.days || "30", 10)));
  const supabase = await createClient();
  const summaries = await loadExecSummaries(supabase, { sinceDays: days });

  const totalRevenue = summaries.reduce((s, x) => s + x.totals.job_won_value, 0);
  const totalWins = summaries.reduce((s, x) => s + x.totals.job_won, 0);

  return (
    <div className="px-8 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Execs</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Cross-company leaderboard · last {days} days · {summaries.length} active
          </p>
        </div>
        <div className="flex gap-1.5 text-xs">
          {[7, 30, 90, 365].map(d => (
            <Link
              key={d}
              href={`/execs?days=${d}`}
              className={`rounded px-2 py-1 border ${d === days ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
            >
              {d === 365 ? "1y" : `${d}d`}
            </Link>
          ))}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-3 gap-3 max-w-2xl">
        <Stat label="Total revenue" value={formatCurrency(totalRevenue)} accent />
        <Stat label="Wins" value={totalWins} />
        <Stat label="Active execs" value={summaries.length} />
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 text-left font-normal">Exec</th>
              <th className="px-4 py-2.5 text-left font-normal">Companies</th>
              <th className="px-3 py-2.5 text-right font-normal">EODs</th>
              <th className="px-3 py-2.5 text-right font-normal">Quotes</th>
              <th className="px-3 py-2.5 text-right font-normal">Visits</th>
              <th className="px-3 py-2.5 text-right font-normal">Wins</th>
              <th className="px-3 py-2.5 text-right font-normal">Revenue</th>
              <th className="px-4 py-2.5 text-right font-normal">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">No exec activity in this window.</td></tr>
            )}
            {summaries.map(s => {
              const closeRate = s.totals.quote_sent > 0
                ? (s.totals.job_won / s.totals.quote_sent) * 100
                : null;
              return (
                <tr key={s.name} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <Link href={`/execs/${encodeURIComponent(s.name)}`} className="font-medium text-zinc-100 hover:text-white">
                      {s.name}
                    </Link>
                    {closeRate !== null && (
                      <div className="text-[10px] text-zinc-500">{closeRate.toFixed(0)}% quote→win</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {s.companies.map(c => c.name).join(" · ")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{s.totals.eod_update}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{s.totals.quote_sent}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{s.totals.site_visit_booked}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-300">{s.totals.job_won}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-400">
                    {s.totals.job_won_value > 0 ? formatCurrency(s.totals.job_won_value) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-zinc-500">{relativeTime(s.lastActivityAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
