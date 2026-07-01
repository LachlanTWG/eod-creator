import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { loadReports, listCompanies } from "@/lib/queries";
import { loadBacklog } from "@/lib/analytics";
import { loadCompanyLiveReports, type CompanyLiveReport } from "@/lib/messages";
import { formatCurrency, todayInTz, SYDNEY_TZ } from "@/lib/format";
import { shiftPeriodAnchor, shortDate, monthLabel, weekdayShort, type Period } from "@/lib/dates";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

const REPORT_TYPES = [
  { key: "eod", label: "EOD", period: "day" },
  { key: "eow", label: "EOW", period: "week" },
  { key: "eom", label: "EOM", period: "month" },
  { key: "eoq", label: "EOQ", period: "quarter" },
  { key: "eoy", label: "EOY", period: "year" },
] as const;

type ReportType = typeof REPORT_TYPES[number]["key"];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; company?: string; date?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const supabase = await createClient();
  const canSeeTeam = viewer.isAdmin || viewer.isViewer;

  const typeEntry = REPORT_TYPES.find(t => t.key === params.type) ?? REPORT_TYPES[0];
  const reportType: ReportType = typeEntry.key;
  const period: Period = typeEntry.period;
  const companyFilter = params.company || "";

  const today = todayInTz(SYDNEY_TZ);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? params.date! : today;
  const isCurrentPeriod = !params.date;

  const companies = await listCompanies(supabase);
  const selectedCompany = companies.find(c => c.slug === companyFilter);
  const targetCompanies = selectedCompany ? [selectedCompany] : companies;

  // Live reports — computed straight from `activities` for the chosen period.
  const liveReports = (await Promise.all(
    targetCompanies.map(c => loadCompanyLiveReports(supabase, { companyId: c.id, period, anchor })),
  )).filter((r): r is CompanyLiveReport => r !== null);

  const range = liveReports[0] ?? null;
  const periodLabel = range ? labelForRange(period, range.rangeStart, range.rangeEnd) : "";

  // Sent history — what the cron actually delivered (immutable audit log).
  const sentReports = await loadReports(supabase, {
    reportType,
    companyId: selectedCompany?.id,
    limit: 20,
  });

  // Backlog data alongside (RLS-scoped automatically)
  const { openQuotes, pendingVisits } = await loadBacklog(supabase);
  const filteredOpenQuotes = selectedCompany
    ? openQuotes.filter(q => q.company_id === selectedCompany.id)
    : openQuotes;
  const filteredPendingVisits = selectedCompany
    ? pendingVisits.filter(v => v.company_id === selectedCompany.id)
    : pendingVisits;
  const openValue = filteredOpenQuotes.reduce((s, q) => s + q.last_event_value, 0);

  const prevHref = buildHref({ type: reportType, company: companyFilter, date: shiftPeriodAnchor(period, anchor, -1) });
  const nextHref = buildHref({ type: reportType, company: companyFilter, date: shiftPeriodAnchor(period, anchor, 1) });
  const currentHref = buildHref({ type: reportType, company: companyFilter });

  return (
    <div className="px-8 py-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Computed live from the activity database — edits and deletions are reflected immediately.{" "}
            {canSeeTeam ? "All clients." : "Your reports only."}
          </p>
        </div>
        <LiveRefresh fetchedAtIso={new Date().toISOString()} />
      </header>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
          {REPORT_TYPES.map(t => {
            const active = t.key === reportType;
            return (
              <Link
                key={t.key}
                href={buildHref({ type: t.key, company: companyFilter })}
                className={`px-3 py-1.5 rounded-sm transition-colors ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
          <Link
            href={buildHref({ type: reportType, company: "", date: params.date })}
            className={`px-3 py-1.5 rounded-sm transition-colors ${!selectedCompany ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            All clients
          </Link>
          {companies.map(c => {
            const active = c.slug === companyFilter;
            return (
              <Link
                key={c.id}
                href={buildHref({ type: reportType, company: c.slug, date: params.date })}
                className={`px-3 py-1.5 rounded-sm transition-colors ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {c.name}
              </Link>
            );
          })}
        </div>

        {/* Period navigation */}
        <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
          <Link href={prevHref} className="px-3 py-1.5 rounded-sm text-zinc-400 hover:text-zinc-200" title="Previous period">
            ‹ Prev
          </Link>
          <span className="px-3 py-1.5 text-zinc-100 font-medium tabular-nums">{periodLabel}</span>
          <Link href={nextHref} className="px-3 py-1.5 rounded-sm text-zinc-400 hover:text-zinc-200" title="Next period">
            Next ›
          </Link>
        </div>
        {!isCurrentPeriod && (
          <Link
            href={currentHref}
            className="text-xs rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            Jump to current
          </Link>
        )}
      </section>

      {/* Live reports */}
      <section className="space-y-6">
        {liveReports.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center text-sm text-zinc-500">
            No companies visible.
          </div>
        )}
        {liveReports.map(report => {
          const people = canSeeTeam
            ? report.people
            : report.people.filter(p => p.name === viewer.salesPersonName);
          const cards = [
            ...(canSeeTeam ? [report.team] : []),
            ...people,
          ];
          const anyActivity = cards.some(c => c.hasActivity);
          return (
            <div key={report.company.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">
                  {report.company.name} · {reportType.toUpperCase()} · {periodLabel}
                </h2>
                <span className="text-[11px] text-zinc-500">live from activity data</span>
              </div>

              {!anyActivity ? (
                <div className="mt-4 text-sm text-zinc-500">
                  No activity recorded for this period.
                </div>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {cards.map(c => (
                    <div key={c.name} className="rounded border border-zinc-800 bg-zinc-950/40 p-4">
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{c.name}</span>
                        {!c.hasActivity && <span className="text-[10px] text-zinc-600">no activity</span>}
                      </div>
                      {c.hasActivity ? (
                        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-200">
                          {c.message}
                        </pre>
                      ) : (
                        <div className="text-xs text-zinc-600">No activity for {c.name} in this period.</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Backlog summary */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">
            Backlog {selectedCompany ? `· ${selectedCompany.name}` : ""}
          </h2>
          <Link href="/backlog" className="text-xs text-zinc-500 hover:text-zinc-300">Open full backlog →</Link>
        </div>
        <div className="mt-4 grid gap-3 grid-cols-3">
          <Stat label="Open quotes" value={filteredOpenQuotes.length} />
          <Stat label="Open quote value" value={formatCurrency(openValue)} accent />
          <Stat label="Pending site visits" value={filteredPendingVisits.length} />
        </div>
        {filteredOpenQuotes.length > 0 && (
          <div className="mt-4 max-h-48 overflow-y-auto divide-y divide-zinc-800">
            {filteredOpenQuotes.slice(0, 10).map(q => (
              <div key={`${q.company_id}-${q.contact_id}`} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-zinc-200">{q.contact_name || "—"}</span>
                  <span className="text-zinc-500"> · {q.company_name} · {q.sales_person_name}</span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="tabular-nums text-emerald-400">{formatCurrency(q.last_event_value)}</span>
                  <span className="ml-2 tabular-nums text-zinc-500">{q.days_open}d</span>
                </div>
              </div>
            ))}
            {filteredOpenQuotes.length > 10 && (
              <div className="py-1.5 text-center text-[11px] text-zinc-600">… +{filteredOpenQuotes.length - 10} more</div>
            )}
          </div>
        )}
      </section>

      {/* Sent history — immutable audit log of what was actually delivered */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">
          Sent history · {reportType.toUpperCase()}
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          What was actually delivered to Slack/ClickUp at send time. Snapshots — they do NOT update
          when activities are edited or deleted; the live reports above are the source of truth.
        </p>

        {sentReports.length === 0 ? (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center text-sm text-zinc-500">
            No sent {reportType.toUpperCase()} reports yet
            {selectedCompany ? ` for ${selectedCompany.name}` : ""}.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {sentReports.map(r => (
              <details key={r.id} className="group rounded-lg border border-zinc-800 bg-zinc-900/40">
                <summary className="cursor-pointer list-none px-5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-900/70 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-100 truncate">
                      {r.sales_person_name} · {r.company_name}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {r.period_start === r.period_end ? r.period_start : `${r.period_start} → ${r.period_end}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500 group-open:hidden">Click to expand →</span>
                  <span className="shrink-0 text-xs text-zinc-500 hidden group-open:inline">▾</span>
                </summary>
                <div className="border-t border-zinc-800 px-5 py-4">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-200">
                    {r.formatted_text}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function labelForRange(period: Period, start: string, end: string): string {
  const year = start.slice(0, 4);
  switch (period) {
    case "day":     return `${weekdayShort(start)} ${shortDate(start)} ${year}`;
    case "week":    return `${shortDate(start)} – ${shortDate(end)} ${end.slice(0, 4)}`;
    case "month":   return monthLabel(start);
    case "quarter": {
      const m = Number(start.split("-")[1]);
      return `Q${Math.ceil(m / 3)} ${year}`;
    }
    case "year":    return year;
  }
}

function buildHref(opts: { type: string; company: string; date?: string }): string {
  const params = new URLSearchParams();
  params.set("type", opts.type);
  if (opts.company) params.set("company", opts.company);
  if (opts.date) params.set("date", opts.date);
  return `/reports?${params.toString()}`;
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
