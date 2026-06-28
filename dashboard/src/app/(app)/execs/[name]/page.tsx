// Per-exec dashboard. Top: live formatted EOD/EOW/etc messages scoped to
// THIS exec (same panel /me uses). Below: the 12-week analytics —
// revenue trend, per-company table, top outcomes, recent activity.
//
// Admin can view any exec. Exec can only view their own (gateExecName redirects).

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, gateExecName } from "@/lib/viewer";
import { loadExecDetail, loadExecHeatmap } from "@/lib/analytics";
import { Heatmap } from "@/components/Heatmap";
import { loadExecWonJobsSummary } from "@/lib/wonJobs";
import { EVENT_LABELS, formatCurrency, relativeTime, quoteGroupValue, todayInTz, SYDNEY_TZ } from "@/lib/format";
import { mondayOf, addDaysIso, shortDate, type Period } from "@/lib/dates";
import { BarChart, HBars } from "@/components/BarChart";
import { LiveMessagesPanel } from "@/components/LiveMessagesPanel";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

const VALID_PERIODS: Period[] = ["day", "week", "month", "quarter", "year"];
function parsePeriod(raw: string | string[] | undefined): Period {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (VALID_PERIODS as string[]).includes(v ?? "") ? (v as Period) : "day";
}

const PERIOD_LABELS: Record<Period, string> = {
  day:     "Today (EOD)",
  week:    "This week (EOW)",
  month:   "This month (EOM)",
  quarter: "This quarter (EOQ)",
  year:    "This year (EOY)",
};

export default async function ExecDetail({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const sp = await searchParams;
  const period = parsePeriod(sp.period);

  const viewer = await getViewer();
  gateExecName(viewer, name);

  const supabase = await createClient();

  // Resolve target exec's sales_people rows (one per company). All rows for
  // the same exec share the canonical first name.
  const { data: targetRows } = await supabase
    .from("sales_people")
    .select("id, company_id")
    .ilike("name", name);
  const targetSalesPersonIds = new Set((targetRows || []).map(r => r.id as string));
  const targetCompanyIds = new Set((targetRows || []).map(r => r.company_id as string));

  const [{ totals, perCompany, weekly, outcomes, recent }, heatmap, pipeline] = await Promise.all([
    loadExecDetail(supabase, name),
    loadExecHeatmap(supabase, name),
    loadExecWonJobsSummary(supabase, name),
  ]);
  const heatmapPeak = Math.max(0, ...heatmap.days.map(d => d.count));

  if (totals.eod_update + totals.quote_sent + totals.job_won + totals.site_visit_booked + totals.email_sent === 0) {
    notFound();
  }

  const closeRate = totals.quote_sent > 0 ? (totals.job_won / totals.quote_sent) * 100 : null;
  const quoteRate = totals.eod_update > 0 ? (totals.quote_sent / totals.eod_update) * 100 : null;
  const avgDeal = totals.job_won > 0 ? totals.job_won_value / totals.job_won : 0;

  const weeklyBars = (() => {
    const map = new Map(weekly.map(w => [w.week_start, w]));
    const out: { label: string; value: number; sub?: string }[] = [];
    const currentMonday = mondayOf(todayInTz(SYDNEY_TZ));
    for (let i = 11; i >= 0; i--) {
      const wk = addDaysIso(currentMonday, -i * 7);
      const bucket = map.get(wk);
      out.push({
        label: shortDate(wk),
        value: bucket?.won_value || 0,
        sub: `${bucket?.activity_count || 0} activities`,
      });
    }
    return out;
  })();

  const isOwnPage = viewer.salesPersonName?.toLowerCase() === name.toLowerCase();
  const basePath = `/execs/${encodeURIComponent(name)}`;
  const fetchedAt = new Date().toISOString();

  return (
    <div className="px-6 py-6 lg:px-8">
      {/* Crumb (admins + viewers drilling in from the leaderboard) */}
      {(viewer.isAdmin || viewer.isViewer) && !isOwnPage && (
        <div className="flex items-center gap-3 text-sm">
          <Link href="/execs" className="text-zinc-500 hover:text-zinc-300">← Execs</Link>
          <span className="text-zinc-700">/</span>
          <span className="text-zinc-300">{name}</span>
        </div>
      )}

      {/* Header */}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isOwnPage && !viewer.isAdmin ? `Hi ${name}` : name}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {PERIOD_LABELS[period]} · 12-week analytics below
          </p>
        </div>
        <LiveRefresh fetchedAtIso={fetchedAt} />
      </div>

      {/* Live messages panel */}
      <div className="mt-5">
        <LiveMessagesPanel
          supabase={supabase}
          period={period}
          targetExecName={name}
          targetSalesPersonIds={targetSalesPersonIds}
          targetCompanyIds={targetCompanyIds}
          isAdmin={viewer.isAdmin}
          basePath={basePath}
        />
      </div>

      {/* Won-jobs pipeline */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Won-jobs pipeline
          </h2>
          <Link
            href="/wins"
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            All wins →
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {pipeline.byStage.map(s => {
            const accentBg: Record<typeof s.stage, string> = {
              verbal_confirmation: "border-zinc-800 from-zinc-900/40 to-zinc-900/10",
              client_approved:     "border-amber-900/40 from-amber-950/30 to-zinc-950/20",
              invoiced:            "border-sky-900/40 from-sky-950/30 to-zinc-950/20",
              paid:                "border-emerald-900/40 from-emerald-950/30 to-zinc-950/20",
            };
            const accentText: Record<typeof s.stage, string> = {
              verbal_confirmation: "text-zinc-200",
              client_approved:     "text-amber-300",
              invoiced:            "text-sky-300",
              paid:                "text-emerald-300",
            };
            const label: Record<typeof s.stage, string> = {
              verbal_confirmation: "Verbal",
              client_approved:     "Approved",
              invoiced:            "Invoiced",
              paid:                "Paid",
            };
            return (
              <div key={s.stage} className={`rounded-xl border bg-gradient-to-br p-4 ${accentBg[s.stage]}`}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label[s.stage]}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className={`text-2xl font-semibold tabular-nums ${accentText[s.stage]}`}>{s.count}</div>
                  <div className="text-xs text-zinc-500">jobs</div>
                </div>
                <div className="mt-1 text-sm tabular-nums text-zinc-300">
                  {s.commission > 0 ? formatCurrency(s.commission) : <span className="text-zinc-600">$0</span>}
                </div>
              </div>
            );
          })}
        </div>
        {pipeline.totalJobs > 0 && (
          <div className="mt-2 text-[11px] text-zinc-500">
            {pipeline.totalJobs} jobs · {formatCurrency(pipeline.totalCommission)} commission · {formatCurrency(pipeline.totalJobValue)} job value
          </div>
        )}
      </section>

      {/* Heatmap */}
      <section className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Activity heatmap · last 90 days
          </h2>
          <span className="text-[11px] text-zinc-500">
            {heatmap.totalActivities.toLocaleString()} activities
            {heatmapPeak > 0 ? ` · peak ${heatmapPeak}/day` : ""}
          </span>
        </div>
        <div className="mt-4">
          {heatmap.totalActivities === 0 ? (
            <div className="text-sm text-zinc-500 italic">No activity in the last 90 days.</div>
          ) : (
            <Heatmap days={heatmap.days} />
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="mt-12 border-t border-zinc-800 pt-8">
        <h2 className="text-lg font-semibold tracking-tight">Analytics (last 12 weeks)</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {perCompany.length} {perCompany.length === 1 ? "company" : "companies"}
        </p>
      </div>

      {/* Top stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Revenue" value={formatCurrency(totals.job_won_value)} accent />
        <Stat label="Wins" value={totals.job_won} />
        <Stat label="Avg deal" value={avgDeal > 0 ? formatCurrency(avgDeal) : "—"} />
        <Stat label="Quote→Win" value={closeRate !== null ? `${closeRate.toFixed(0)}%` : "—"} />
        <Stat label="EOD→Quote" value={quoteRate !== null ? `${quoteRate.toFixed(0)}%` : "—"} />
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Activity (12w)</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={EVENT_LABELS.eod_update} value={totals.eod_update} />
          <Stat label={EVENT_LABELS.quote_sent} value={totals.quote_sent} />
          <Stat label={EVENT_LABELS.site_visit_booked} value={totals.site_visit_booked} />
          <Stat label={EVENT_LABELS.email_sent} value={totals.email_sent} />
          <Stat label={EVENT_LABELS.job_won} value={totals.job_won} />
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Weekly revenue</h2>
        <div className="mt-4">
          <BarChart bars={weeklyBars} height={150} format="currency" highlightLast />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Per company</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Company</th>
                <th className="px-3 py-2 text-right font-normal">EODs</th>
                <th className="px-3 py-2 text-right font-normal">Quotes</th>
                <th className="px-3 py-2 text-right font-normal">Visits</th>
                <th className="px-3 py-2 text-right font-normal">Wins</th>
                <th className="px-3 py-2 text-right font-normal">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {perCompany.map(({ company, totals: t }) => (
                <tr key={company.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/companies/${company.slug}`} className="font-medium text-zinc-100 hover:text-white">
                      {company.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">{t.eod_update}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">{t.quote_sent}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">{t.site_visit_booked}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">{t.job_won}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-400">
                    {t.job_won_value > 0 ? formatCurrency(t.job_won_value) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Top outcomes (12w)</h2>
          <div className="mt-4">
            {outcomes.length === 0
              ? <div className="text-sm text-zinc-500">No outcomes logged.</div>
              : <HBars rows={outcomes.map(o => ({ label: o.outcome, value: o.n }))} />}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Recent activity</h2>
          <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-zinc-800">
            {recent.map(r => (
              <div key={r.id} className="py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                    {EVENT_LABELS[r.event_type] || r.event_type}
                  </span>
                  <span className="text-zinc-400 truncate">{r.contact_name || "—"}</span>
                  <span className="ml-auto text-zinc-500">{relativeTime(r.created_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-zinc-500">
                  <span>{r.company_name}</span>
                  {r.event_type === "job_won" && r.quote_job_value && (
                    <span className="text-emerald-400">{formatCurrency(quoteGroupValue(r.quote_job_value))}</span>
                  )}
                </div>
                {r.outcome && <div className="mt-0.5 truncate text-zinc-600">{r.outcome}</div>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className={`text-xl font-semibold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
