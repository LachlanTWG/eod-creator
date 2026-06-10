import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAdmin } from "@/lib/viewer";
import {
  loadOverviewByPeriod,
  loadRecentActivityFeed,
  type OverviewClient,
  type OverviewExec,
  type PeriodMetrics,
} from "@/lib/queries";
import {
  loadQuotieBreakdown,
  quotieByClientExecOnly,
  quotieByExec,
  quotieOurExecSlice,
} from "@/lib/quotie";
import type { Period, PeriodRange } from "@/lib/dates";
import { shortDate, businessDaysBetween } from "@/lib/dates";
import { EVENT_LABELS, formatCurrency, relativeTime, quoteGroupValue } from "@/lib/format";
import { BarChart, HBars } from "@/components/BarChart";
import { Heatmap } from "@/components/Heatmap";
import { Matrix } from "@/components/Matrix";
import { LiveBadge } from "./LiveBadge";
import { loadAllExecHeatmaps } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const viewer = await getViewer();
  requireAdmin(viewer);

  const params = await searchParams;
  const requested = (params.p || "week") as Period;
  const period: Period = PERIODS.some(p => p.key === requested) ? requested : "week";

  const supabase = await createClient();

  // Kick every loader off up-front (they run concurrently), then stream each
  // region in via <Suspense> as it resolves. The shell + period tabs paint
  // immediately instead of blocking on the slowest of the four queries (incl.
  // the external Quotie call). The core waits only on the heavy overview
  // aggregation; Quotie, exec heatmaps and the recent feed stream in after.
  const dataP = loadOverviewByPeriod(supabase, period);
  const quotieP = loadQuotieBreakdown().catch(e => {
    console.warn("[quotie] fetch failed:", e?.message || e);
    return null;
  });
  const heatmapsP = loadAllExecHeatmaps(supabase);
  const recentP = loadRecentActivityFeed(supabase, 15);

  return (
    <Suspense fallback={<OverviewSkeleton period={period} />}>
      <OverviewCore
        period={period}
        dataP={dataP}
        quotieP={quotieP}
        heatmapsP={heatmapsP}
        recentP={recentP}
      />
    </Suspense>
  );
}

type OverviewData = Awaited<ReturnType<typeof loadOverviewByPeriod>>;

async function OverviewCore({
  period,
  dataP,
  quotieP,
  heatmapsP,
  recentP,
}: {
  period: Period;
  dataP: Promise<OverviewData>;
  quotieP: Promise<Awaited<ReturnType<typeof loadQuotieBreakdown>> | null>;
  heatmapsP: ReturnType<typeof loadAllExecHeatmaps>;
  recentP: ReturnType<typeof loadRecentActivityFeed>;
}) {
  const data = await dataP;
  const { range, totals, perClient, perExec, trend, wins, sources, outcomes, matrix, heatmap, productivity, valueBuckets } = data;

  // Pre-compute matrix cell index for fast lookup in the component
  const matrixIndex = new Map(matrix.map(c => [`${c.exec}|${c.company_id}`, {
    revenue: c.revenue, activities: c.activities, wins: c.wins,
  }]));
  const execNames = perExec.map(e => e.name);
  const heatmapMax = Math.max(0, ...heatmap.map(d => d.count));

  // Per-day average denominators for the hero stats. Pace-matching keeps
  // these aligned, so the comparison reads like-for-like rather than
  // partial-period vs. full-period.
  const currentBizDays = Math.max(1, businessDaysBetween(range.start, range.end));
  const prevBizDays = Math.max(1, businessDaysBetween(range.prevStart, range.prevEnd));

  return (
    <div className="px-8 py-6 space-y-8">
      {/* Header + period selector */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {range.label} · {perClient.length} active {perClient.length === 1 ? "client" : "clients"}
            <span className="ml-2 text-zinc-600">vs {range.prevLabel.toLowerCase()}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodTabs current={period} />
          <LiveBadge />
        </div>
      </header>

      {/* Hero stats — 8 cards */}
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
        <HeroStat label="Revenue"     value={formatCurrency(totals.current.revenue)}      current={totals.current.revenue}     previous={totals.previous.revenue}     currentDays={currentBizDays} previousDays={prevBizDays} fmt="currency" accent />
        <HeroStat label="Pipeline $"  value={formatCurrency(totals.current.pipeline)}     sub={`${totals.current.pipelineCount} open`}                              accent />
        <HeroStat label="Wins"        value={totals.current.wins}        current={totals.current.wins}        previous={totals.previous.wins}        currentDays={currentBizDays} previousDays={prevBizDays} />
        <HeroStat label="Avg deal"    value={totals.current.avgDeal > 0 ? formatCurrency(totals.current.avgDeal) : "—"} />
        <HeroStat label="Quotes"      value={totals.current.quotes}      current={totals.current.quotes}      previous={totals.previous.quotes}      currentDays={currentBizDays} previousDays={prevBizDays} />
        <HeroStat label="People quoted" value={totals.current.peopleQuoted} current={totals.current.peopleQuoted} previous={totals.previous.peopleQuoted} currentDays={currentBizDays} previousDays={prevBizDays} />
        <HeroStat label="Calls (EOD)" value={totals.current.calls}       current={totals.current.calls}       previous={totals.previous.calls}       currentDays={currentBizDays} previousDays={prevBizDays} />
        <HeroStat label="Site visits" value={totals.current.visits}      current={totals.current.visits}      previous={totals.previous.visits}      currentDays={currentBizDays} previousDays={prevBizDays} />
      </section>

      <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <HeroStat label="Quote→Win"   value={pct(totals.current.closeRate)}   sub={`vs ${pct(totals.previous.closeRate)}`} />
        <HeroStat label="Call→Quote"  value={pct(totals.current.callToQuote)} sub={`vs ${pct(totals.previous.callToQuote)}`} />
        <HeroStat label="People worked" value={totals.current.peopleWorked} current={totals.current.peopleWorked} previous={totals.previous.peopleWorked} currentDays={currentBizDays} previousDays={prevBizDays} />
        <HeroStat label="Emails"      value={totals.current.emails}      current={totals.current.emails}      previous={totals.previous.emails}      currentDays={currentBizDays} previousDays={prevBizDays} />
      </section>

      {/* Quotie band + tables — streamed independently (external API, cached
          5 min). perClient comes from the already-resolved overview data, so
          this only awaits the Quotie fetch. */}
      <Suspense fallback={<QuotieSkeleton />}>
        <QuotieSection quotieP={quotieP} perClient={perClient} />
      </Suspense>

      {/* Trend chart */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title={`Revenue · last ${trend.length} ${range.bucketBy}s`} hint="Wins $ per period, all clients">
          <BarChart
            bars={trend.map(t => ({ label: t.label, value: t.revenue, sub: `${t.wins} wins · ${t.activities} acts` }))}
            height={160}
            format="currency"
            highlightLast
          />
        </Panel>
        <Panel title={`Activity · last ${trend.length} ${range.bucketBy}s`} hint="All event types combined">
          <BarChart
            bars={trend.map(t => ({ label: t.label, value: t.activities }))}
            height={160}
            format="number"
            highlightLast
          />
        </Panel>
      </section>

      {/* Wins list + heatmap */}
      <section className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Panel
          title={`Wins · ${range.label.toLowerCase()}`}
          hint={wins.length > 0 ? `${wins.length} closed · ${formatCurrency(totals.current.revenue)} total` : "Every win in the period"}
        >
          {wins.length === 0 ? (
            <div className="py-6 text-center text-sm text-zinc-500">No wins yet.</div>
          ) : (
            <div className="divide-y divide-zinc-800 -my-2 max-h-96 overflow-y-auto">
              {wins.map(w => (
                <div key={w.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-100 truncate">{w.contact_name || "—"}</div>
                    <div className="text-zinc-500 truncate">
                      <Link href={`/companies/${w.company_slug}`} className="hover:text-zinc-300">{w.company_name}</Link>
                      {" · "}
                      <Link href={`/execs/${encodeURIComponent(w.sales_person_name)}`} className="hover:text-zinc-300">{w.sales_person_name}</Link>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular-nums text-emerald-400">{formatCurrency(w.value)}</div>
                    <div className="text-[10px] text-zinc-500">{relativeTime(w.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Activity heatmap · last 90 days" hint={heatmapMax > 0 ? `Peak day: ${heatmapMax} activities` : "No activity yet"}>
          <Heatmap days={heatmap} />
        </Panel>
      </section>

      {/* Per-exec heatmaps — streamed independently (extra 90-day query). */}
      <Suspense fallback={<ExecHeatmapsSkeleton />}>
        <ExecHeatmaps heatmapsP={heatmapsP} />
      </Suspense>

      {/* Per-exec × per-client matrix */}
      <section>
        <SectionHeader title="Exec × Client matrix" hint={`Revenue + activity per cell · ${range.label.toLowerCase()}`} />
        <div className="mt-4">
          <Matrix
            execs={execNames}
            companies={perClient.map(c => ({ id: c.id, name: c.name, slug: c.slug }))}
            cellsByKey={matrixIndex}
          />
        </div>
      </section>

      {/* Per-client table */}
      <section>
        <SectionHeader
          title="By client"
          hint={`${range.label} (${shortDate(range.start)} → ${shortDate(range.end)}) · vs ${range.prevLabel} (${shortDate(range.prevStart)} → ${shortDate(range.prevEnd)}) · tap a row to drill down`}
        />
        <MetricTable
          range={range}
          rows={perClient.map(c => ({
            key: c.id,
            href: `/companies/${c.slug}`,
            primary: c.name,
            secondary: c.timezone,
            current: c.current,
            previous: c.previous,
            currentDays: c.currentActiveDays,
            previousDays: c.previousActiveDays,
            stale: c.lastActivityAt
              ? (Date.now() - new Date(c.lastActivityAt).getTime()) / 3600000 > 48
              : true,
            lastActivityAt: c.lastActivityAt,
          }))}
        />
      </section>

      {/* Per-exec table */}
      <section>
        <SectionHeader
          title="By exec"
          hint={`${range.label} (${shortDate(range.start)} → ${shortDate(range.end)}) · vs ${range.prevLabel} (${shortDate(range.prevStart)} → ${shortDate(range.prevEnd)}) · roster only — owners and one-offs excluded`}
        />
        <MetricTable
          range={range}
          rows={perExec.map(e => ({
            key: e.name,
            href: `/execs/${encodeURIComponent(e.name)}`,
            primary: e.name,
            secondary: e.companies.map(c => c.name).join(" · ") || "—",
            current: e.current,
            previous: e.previous,
            currentDays: e.currentActiveDays,
            previousDays: e.previousActiveDays,
          }))}
          execStyle
        />
      </section>

      {/* Sources + Outcomes */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Lead sources" hint={`Quotes + wins by channel · ${range.label.toLowerCase()}`}>
          {sources.length === 0 ? (
            <div className="py-6 text-center text-sm text-zinc-500">No source data in this period.</div>
          ) : (
            <div className="overflow-hidden rounded border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-normal">Source</th>
                    <th className="px-3 py-1.5 text-right font-normal">Quotes</th>
                    <th className="px-3 py-1.5 text-right font-normal">Wins</th>
                    <th className="px-3 py-1.5 text-right font-normal">Close%</th>
                    <th className="px-3 py-1.5 text-right font-normal">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.source} className="border-t border-zinc-800">
                      <td className="px-3 py-1.5 truncate max-w-[14ch] text-zinc-200">{s.source}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">{s.quotes || ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">{s.wins || ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">
                        {s.quotes > 0 ? `${Math.round(s.closeRate * 100)}%` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">
                        {s.revenue > 0 ? formatCurrency(s.revenue) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="EOD outcomes" hint={`Top 10 outcomes logged · ${range.label.toLowerCase()}`}>
          {outcomes.length === 0
            ? <div className="py-6 text-center text-sm text-zinc-500">No outcomes in this period.</div>
            : <HBars rows={outcomes.map(o => ({ label: o.outcome, value: o.n }))} />}
        </Panel>
      </section>

      {/* Lead value distribution — pipeline aging lives in Quotie, not here */}
      <section>
        <Panel title="Open quote sizes" hint="Pipeline value buckets">
          {valueBuckets.every(b => b.count === 0) ? (
            <div className="py-6 text-center text-sm text-zinc-500">No open quotes.</div>
          ) : (
            <div className="space-y-2">
              {valueBuckets.map(b => {
                const max = Math.max(1, ...valueBuckets.map(x => x.value));
                const pct = (b.value / max) * 100;
                return (
                  <div key={b.label} className="grid grid-cols-[6ch_1fr_8ch] items-center gap-3 text-xs">
                    <div className="text-zinc-300">{b.label}</div>
                    <div className="relative h-5 overflow-hidden rounded bg-zinc-900">
                      <div className="absolute inset-y-0 left-0 bg-emerald-700" style={{ width: `${pct}%` }} />
                      <div className="relative px-2 leading-5 text-zinc-300 tabular-nums">{b.count} open</div>
                    </div>
                    <div className="text-right tabular-nums text-emerald-400">{formatCurrency(b.value)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </section>

      {/* Productivity */}
      <section>
        <SectionHeader title="Productivity" hint={`Activities per business day (Mon-Fri) · ${range.label.toLowerCase()}`} />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {productivity.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
              No exec activity in this period.
            </div>
          ) : productivity.map(p => (
            <div key={p.name} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="flex items-baseline justify-between">
                <Link href={`/execs/${encodeURIComponent(p.name)}`} className="text-sm font-medium text-zinc-100 hover:text-white">{p.name}</Link>
                <div className="text-2xl font-semibold tabular-nums text-emerald-400">{p.activitiesPerDay.toFixed(1)}</div>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">activities / business day</div>
              <div className="mt-1 text-[10px] text-zinc-600">{p.totalActivities} acts over {p.workingDays} workdays</div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent activity — streamed independently (separate feed query). */}
      <Suspense fallback={<RecentActivitySkeleton />}>
        <RecentActivity recentP={recentP} />
      </Suspense>
    </div>
  );
}

/* ─── streamed sub-sections ───────────────────────────────────────── */

async function QuotieSection({
  quotieP,
  perClient,
}: {
  quotieP: Promise<Awaited<ReturnType<typeof loadQuotieBreakdown>> | null>;
  perClient: OverviewClient[];
}) {
  const quotie = await quotieP;
  if (!quotie) return null;

  const quotieSlice = quotieOurExecSlice(quotie);
  const quotieByClientMap = quotieByClientExecOnly(quotie);
  const quotieByExecMap = quotieByExec(quotie);

  return (
    <>
      {/* Quotie band — lifetime totals, filtered to sales-exec-attributed
          jobs only (via Quotie's lead-owner attribution). Client-added job-
          management entries with no sales-exec touch are excluded. */}
      <section>
        <SectionHeader title="Quotie (lifetime, sales-exec-attributed only)" hint="Direct from quotie.com.au — only jobs where a roster exec owns the lead. Client-added jobs excluded. Updates every 5 min." />
        <div className="mt-3 grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <HeroStat label="Pipeline $"   value={formatCurrency(quotieSlice.groups.pipeline_value)} sub={`${quotieSlice.groups.pending} open`}                                  accent />
          <HeroStat label="Quotie Won $" value={formatCurrency(quotieSlice.groups.won_value)}      sub={`${quotieSlice.groups.won} wins`}                                       accent />
          <HeroStat label="Groups sent"  value={quotieSlice.groups.total_sent}                     sub={`${quotieSlice.groups.sent_this_month} this month`} />
          <HeroStat label="Quotes sent"  value={quotieSlice.quotes.sent}                           sub={`${quotieSlice.quotes.sent_this_month} this month`} />
          <HeroStat label="Pending"      value={quotieSlice.groups.pending} />
          <HeroStat label="Lost"         value={quotieSlice.groups.lost} />
          <HeroStat label="Expired"      value={quotieSlice.groups.expired} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Quotie · by client" hint="Lifetime totals · sales-exec-attributed only">
          <div className="overflow-hidden rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-normal">Client</th>
                  <th className="px-3 py-1.5 text-right font-normal">Pipeline</th>
                  <th className="px-3 py-1.5 text-right font-normal">Quoties Won</th>
                  <th className="px-3 py-1.5 text-right font-normal">Pending</th>
                  <th className="px-3 py-1.5 text-right font-normal">Lost / Exp</th>
                  <th className="px-3 py-1.5 text-right font-normal">Quotes</th>
                </tr>
              </thead>
              <tbody>
                {perClient.map(c => {
                  const q = quotieByClientMap[c.name];
                  if (!q) {
                    return (
                      <tr key={c.id} className="border-t border-zinc-800">
                        <td className="px-3 py-1.5 font-medium text-zinc-100">{c.name}</td>
                        <td colSpan={5} className="px-3 py-1.5 text-zinc-600">no Quotie mapping</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={c.id} className="border-t border-zinc-800">
                      <td className="px-3 py-1.5 font-medium text-zinc-100">{c.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">{formatCurrency(q.groups.pipeline_value)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">
                        {formatCurrency(q.groups.won_value)}
                        <div className="text-[9px] text-zinc-500">{q.groups.won} wins</div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">{q.groups.pending}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">{q.groups.lost} / {q.groups.expired}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">
                        {q.quotes.sent}
                        <div className="text-[9px] text-zinc-500">{q.quotes.sent_this_month} mo</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Quotie · by exec" hint="Roster only, summed across all their active clients">
          <div className="overflow-hidden rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-normal">Exec</th>
                  <th className="px-3 py-1.5 text-right font-normal">Pipeline</th>
                  <th className="px-3 py-1.5 text-right font-normal">Quoties Won</th>
                  <th className="px-3 py-1.5 text-right font-normal">Pending</th>
                  <th className="px-3 py-1.5 text-right font-normal">Lost / Exp</th>
                  <th className="px-3 py-1.5 text-right font-normal">Quotes</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(quotieByExecMap)
                  .sort((a, b) => b.groups.won_value - a.groups.won_value)
                  .map(e => (
                  <tr key={e.ourName} className="border-t border-zinc-800">
                    <td className="px-3 py-1.5 font-medium">
                      <Link href={`/execs/${encodeURIComponent(e.ourName)}`} className="text-zinc-100 hover:text-white">
                        {e.ourName}
                      </Link>
                      <div className="text-[9px] text-zinc-500">{e.perCompany.length} clients in Quotie</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">{formatCurrency(e.groups.pipeline_value)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">
                      {formatCurrency(e.groups.won_value)}
                      <div className="text-[9px] text-zinc-500">{e.groups.won} wins</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">{e.groups.pending}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">{e.groups.lost} / {e.groups.expired}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300">
                      {e.quotes.sent}
                      <div className="text-[9px] text-zinc-500">{e.quotes.sent_this_month} mo</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </>
  );
}

async function ExecHeatmaps({ heatmapsP }: { heatmapsP: ReturnType<typeof loadAllExecHeatmaps> }) {
  const execHeatmaps = await heatmapsP;
  return (
    <section>
      <SectionHeader title="Per-exec activity · last 90 days" hint={`${execHeatmaps.length} exec${execHeatmaps.length === 1 ? "" : "s"} active`} />
      {execHeatmaps.length === 0 ? (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
          No exec activity in the last 90 days.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {execHeatmaps.map(h => {
            const peak = Math.max(0, ...h.days.map(d => d.count));
            return (
              <Link
                key={h.execName}
                href={`/execs/${encodeURIComponent(h.execName)}`}
                className="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-zinc-100">{h.execName}</div>
                  <div className="text-[11px] text-zinc-500">
                    {h.totalActivities.toLocaleString()} acts · peak {peak}/day
                  </div>
                </div>
                <div className="mt-3">
                  <Heatmap days={h.days} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

async function RecentActivity({ recentP }: { recentP: ReturnType<typeof loadRecentActivityFeed> }) {
  const recent = await recentP;
  return (
    <section>
      <Panel title="Recent activity" hint="Last 15 across all clients" right={<Link href="/backlog" className="text-xs text-zinc-500 hover:text-zinc-300">Backlog →</Link>}>
        {recent.length === 0 ? (
          <div className="py-6 text-center text-sm text-zinc-500">Nothing yet.</div>
        ) : (
          <div className="divide-y divide-zinc-800 -my-2">
            {recent.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                      {EVENT_LABELS[r.event_type] || r.event_type}
                    </span>
                    <span className="text-zinc-300 truncate">{r.sales_person_name}</span>
                    {r.contact_name && <span className="text-zinc-500 truncate">→ {r.contact_name}</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-zinc-500">
                    <Link href={`/companies/${r.company_slug}`} className="hover:text-zinc-300">
                      {r.company_name}
                    </Link>
                    {r.outcome && <span className="truncate">· {r.outcome.split("|")[0].trim()}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-zinc-500">
                  {r.event_type === "job_won" && r.quote_job_value && (
                    <div className="text-emerald-400">{formatCurrency(quoteGroupValue(r.quote_job_value))}</div>
                  )}
                  <div>{relativeTime(r.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}

/* ─── skeleton fallbacks (paint instantly while data streams) ─────── */

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-900/60 ${className}`} />;
}

function OverviewSkeleton({ period }: { period: Period }) {
  return (
    <div className="px-8 py-6 space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Loading…</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodTabs current={period} />
          <LiveBadge />
        </div>
      </header>
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonBlock key={i} className="h-20" />)}
      </section>
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-20" />)}
      </section>
      <SkeletonBlock className="h-48" />
    </div>
  );
}

function QuotieSkeleton() {
  return (
    <section className="space-y-3">
      <SkeletonBlock className="h-24" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonBlock className="h-48" />
        <SkeletonBlock className="h-48" />
      </div>
    </section>
  );
}

function ExecHeatmapsSkeleton() {
  return (
    <section>
      <SectionHeader title="Per-exec activity · last 90 days" hint="Loading…" />
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-32" />)}
      </div>
    </section>
  );
}

function RecentActivitySkeleton() {
  return <SkeletonBlock className="h-64" />;
}

/* ─── components ──────────────────────────────────────────────────── */

function PeriodTabs({ current }: { current: Period }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
      {PERIODS.map(p => {
        const active = p.key === current;
        return (
          <Link
            key={p.key}
            href={`/?p=${p.key}`}
            className={`px-3 py-1.5 rounded-sm transition-colors ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function HeroStat({
  label, value, sub, current, previous, currentDays, previousDays,
  fmt = "number", accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  current?: number;
  previous?: number;
  /** Business-day denominator for the per-day average sub-label. */
  currentDays?: number;
  previousDays?: number;
  fmt?: "number" | "currency";
  accent?: boolean;
}) {
  const trend = (() => {
    if (current === undefined || previous === undefined) return null;
    if (previous === 0 && current === 0) return null;
    if (previous === 0) return { dir: "up" as const, pct: 100 };
    const p = Math.round(((current - previous) / previous) * 100);
    return { dir: p >= 0 ? ("up" as const) : ("down" as const), pct: Math.abs(p) };
  })();
  const valueColor = accent ? "text-emerald-400" : "text-zinc-100";

  const fmtVal = (n: number) =>
    fmt === "currency" ? formatCurrency(n) : n.toLocaleString();
  const fmtAvg = (n: number) =>
    fmt === "currency" ? formatCurrency(Math.round(n)) : n.toFixed(1);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <div className={`text-xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
        {trend && (
          <div className={`text-[11px] tabular-nums ${trend.dir === "up" ? "text-emerald-500" : "text-red-400"}`}>
            {trend.dir === "up" ? "▲" : "▼"} {trend.pct}%
          </div>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      {sub
        ? <div className="mt-0.5 text-[10px] text-zinc-600">{sub}</div>
        : current !== undefined && currentDays && currentDays > 0 ? (
          <div className="mt-0.5 text-[10px] text-zinc-600 tabular-nums">
            {fmtAvg(current / currentDays)}/day
            {previous !== undefined && previousDays && previousDays > 0 && (
              <span className="ml-1 text-zinc-700">· prev {fmtAvg(previous / previousDays)}</span>
            )}
          </div>
        ) : previous !== undefined && (
          <div className="mt-0.5 text-[10px] text-zinc-600 tabular-nums">
            prev {fmtVal(previous)}
          </div>
        )}
    </div>
  );
}

function Panel({
  title, hint, right, children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">{title}</h2>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

type MetricRow = {
  key: string;
  href: string;
  primary: string;
  secondary?: string;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  // Active business days for per-day averages — based on the entity's
  // first activity in each window, so a newly-onboarded exec/client isn't
  // penalised by a full-period denominator.
  currentDays: number;
  previousDays: number;
  stale?: boolean;
  lastActivityAt?: string | null;
};

function MetricTable({
  rows,
  range,
  execStyle = false,
}: {
  rows: MetricRow[];
  range: PeriodRange;
  execStyle?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-500">
        Nothing in {range.label.toLowerCase()}.
      </div>
    );
  }
  // Compact period strings reused in column headers + sub-labels.
  const periodLabel = range.label.toLowerCase();        // "this week"
  const prevLabel   = range.prevLabel.toLowerCase();    // "last week"

  // Per-day denominators for the metric cells. Each entity carries its own
  // active-day count so a new exec/client with fewer days in the window
  // still shows a meaningful pace number.
  const dashLabel = execStyle ? "exec dashboard" : "client dashboard";
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left font-normal">{execStyle ? "Exec" : "Client"}</th>
            <PeriodHeader label="Revenue" period={periodLabel} />
            {!execStyle && <PeriodHeader label="Open quotes" period="last 180d" />}
            <PeriodHeader label="Wins" period={periodLabel} />
            <PeriodHeader label="Quotes" period={periodLabel} />
            <PeriodHeader label="People Qd" period={periodLabel} />
            <PeriodHeader label="Calls" period={periodLabel} />
            <PeriodHeader label="Visits" period={periodLabel} />
            <PeriodHeader label="Close%" period={periodLabel} />
            <PeriodHeader label="Avg deal" period={periodLabel} />
            {!execStyle && <th className="px-4 py-2 text-right font-normal">Last activity</th>}
            <th className="px-3 py-2 text-right font-normal"><span className="sr-only">Open dashboard</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="group border-t border-zinc-800 transition-colors hover:bg-zinc-800/60">
              <td className="px-4 py-2.5">
                <Link href={r.href} className="font-medium text-zinc-100 underline-offset-4 hover:text-white hover:underline">
                  {r.primary}
                </Link>
                {r.secondary && <div className="text-[10px] text-zinc-500 truncate">{r.secondary}</div>}
              </td>
              <CurrencyCell
                current={r.current.revenue}
                previous={r.previous.revenue}
                currentDays={r.currentDays}
                previousDays={r.previousDays}
                prevLabel={prevLabel}
                accent="emerald"
              />
              {!execStyle && (
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                  {r.current.pipeline > 0 ? formatCurrency(r.current.pipeline) : "$0"}
                  <div className="text-[10px] text-zinc-600">
                    {r.current.pipelineCount} open
                  </div>
                </td>
              )}
              <NumCell current={r.current.wins} previous={r.previous.wins} currentDays={r.currentDays} previousDays={r.previousDays} prevLabel={prevLabel} />
              <NumCell current={r.current.quotes} previous={r.previous.quotes} currentDays={r.currentDays} previousDays={r.previousDays} prevLabel={prevLabel} />
              <NumCell current={r.current.peopleQuoted} previous={r.previous.peopleQuoted} currentDays={r.currentDays} previousDays={r.previousDays} prevLabel={prevLabel} />
              <NumCell current={r.current.calls} previous={r.previous.calls} currentDays={r.currentDays} previousDays={r.previousDays} prevLabel={prevLabel} />
              <NumCell current={r.current.visits} previous={r.previous.visits} currentDays={r.currentDays} previousDays={r.previousDays} prevLabel={prevLabel} />
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                {pct(r.current.closeRate)}
                {r.previous.closeRate > 0 && (
                  <div className="text-[10px] text-zinc-600">{prevLabel} {pct(r.previous.closeRate)}</div>
                )}
              </td>
              <CurrencyCell current={r.current.avgDeal} previous={r.previous.avgDeal} prevLabel={prevLabel} />
              {!execStyle && (
                <td className="px-4 py-2.5 text-right text-xs">
                  <div className={r.stale ? "text-amber-400" : "text-zinc-500"}>
                    {r.stale ? "⚠ " : ""}{relativeTime(r.lastActivityAt || null)}
                  </div>
                </td>
              )}
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={r.href}
                  aria-label={`Open ${r.primary} ${dashLabel}`}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-300 group-hover:border-zinc-600 group-hover:text-zinc-100"
                >
                  Dashboard
                  <span aria-hidden>→</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A two-line column header: bold metric name + small period qualifier so
 * every column makes its time-window explicit at a glance.
 */
function PeriodHeader({ label, period }: { label: string; period: string }) {
  return (
    <th className="px-3 py-2 text-right font-normal align-bottom">
      <div>{label}</div>
      <div className="mt-0.5 text-[9px] font-normal lowercase tracking-normal text-zinc-600">{period}</div>
    </th>
  );
}

function NumCell({
  current, previous, prevLabel, currentDays, previousDays,
}: {
  current: number; previous: number; prevLabel: string;
  currentDays?: number; previousDays?: number;
}) {
  // Show explicit "0" rather than "—" when prev had data, so you can see
  // the comparison is "0 now vs N then" not "value unknown".
  const showZero = current === 0 && previous > 0;
  const curAvg = current > 0 && currentDays && currentDays > 0 ? current / currentDays : null;
  const prevAvg = previous > 0 && previousDays && previousDays > 0 ? previous / previousDays : null;
  return (
    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
      {current > 0 ? current : (showZero ? <span className="text-zinc-500">0</span> : "—")}
      {curAvg !== null && <div className="text-[10px] text-zinc-600">{curAvg.toFixed(1)}/day</div>}
      {previous > 0 && (
        <div className="text-[10px] text-zinc-600">
          {prevLabel} {previous}{prevAvg !== null && ` · ${prevAvg.toFixed(1)}/day`}
        </div>
      )}
    </td>
  );
}

function CurrencyCell({
  current,
  previous,
  prevLabel,
  currentDays,
  previousDays,
  accent,
}: {
  current: number;
  previous: number;
  prevLabel: string;
  currentDays?: number;
  previousDays?: number;
  accent?: "emerald";
}) {
  const showZero = current === 0 && previous > 0;
  const colour = accent === "emerald" ? "text-emerald-400" : "text-zinc-300";
  const curAvg = current > 0 && currentDays && currentDays > 0 ? current / currentDays : null;
  const prevAvg = previous > 0 && previousDays && previousDays > 0 ? previous / previousDays : null;
  return (
    <td className={`px-3 py-2.5 text-right tabular-nums ${colour}`}>
      {current > 0 ? formatCurrency(current) : (showZero ? <span className="text-zinc-500">$0</span> : "—")}
      {curAvg !== null && <div className="text-[10px] text-zinc-600">{formatCurrency(Math.round(curAvg))}/day</div>}
      {previous > 0 && (
        <div className="text-[10px] text-zinc-600">
          {prevLabel} {formatCurrency(previous)}{prevAvg !== null && ` · ${formatCurrency(Math.round(prevAvg))}/day`}
        </div>
      )}
    </td>
  );
}
