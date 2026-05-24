import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, gateCompanySlug } from "@/lib/viewer";
import { loadCompanyAnalytics } from "@/lib/analytics";
import { BarChart, HBars } from "@/components/BarChart";
import { Funnel } from "@/components/Funnel";
import { EVENT_LABELS, formatCurrency, relativeTime, quoteGroupValue, todayInTz } from "@/lib/format";
import { mondayOf, addDaysIso, shortDate, weekdayShort } from "@/lib/dates";

// Page-through helper — Supabase caps single responses at db-max-rows (1000).
const PAGE = 1000;
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export const dynamic = "force-dynamic";

const EVENT_TYPES = ["eod_update", "quote_sent", "job_won", "site_visit_booked", "email_sent"] as const;
type EventType = typeof EVENT_TYPES[number];

export default async function CompanyDrilldown({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const viewer = await getViewer();
  const company = await gateCompanySlug(viewer, supabase, slug);
  if (!company) notFound();

  const today = todayInTz(company.timezone);
  const startStr = mondayOf(today);
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

  // This week's rows for the per-day bars + per-exec table
  const weekRows = await pageAll<{
    event_type: string;
    sales_person_id: string | null;
    sales_person_name: string;
    occurred_on: string;
    quote_job_value: string | null;
  }>((from, to) =>
    supabase
      .from("activities")
      .select("event_type, sales_person_id, sales_person_name, occurred_on, quote_job_value")
      .eq("company_id", company.id)
      .gte("occurred_on", startStr)
      .lte("occurred_on", today)
      .range(from, to)
  );

  // Recent activity feed
  const { data: feedRows } = await supabase
    .from("activities")
    .select("id, event_type, sales_person_name, contact_name, outcome, quote_job_value, occurred_on, created_at")
    .eq("company_id", company.id)
    .gte("created_at", sevenDaysAgoIso)
    .order("created_at", { ascending: false })
    .limit(50);

  // Per-day totals for the week
  const dailyTotals = new Map<string, number>();
  const execTally = new Map<string, Record<EventType, number> & { won_value: number }>();

  for (const r of weekRows) {
    dailyTotals.set(r.occurred_on, (dailyTotals.get(r.occurred_on) || 0) + 1);
    // Roster only — skip owners / unknown for the exec table.
    if (!r.sales_person_id) continue;
    const name = r.sales_person_name;
    const slot = execTally.get(name) || {
      eod_update: 0, quote_sent: 0, job_won: 0,
      site_visit_booked: 0, email_sent: 0, won_value: 0,
    };
    if (EVENT_TYPES.includes(r.event_type as EventType)) slot[r.event_type as EventType]++;
    if (r.event_type === "job_won") slot.won_value += quoteGroupValue(r.quote_job_value);
    execTally.set(name, slot);
  }

  const days: { date: string; count: number; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(startStr, i);
    days.push({
      date: iso,
      count: dailyTotals.get(iso) || 0,
      label: weekdayShort(iso),
    });
  }
  const maxDayCount = Math.max(1, ...days.map(d => d.count));

  const execRows = Array.from(execTally.entries()).sort((a, b) => {
    const total = (e: typeof a[1]) => e.eod_update + e.quote_sent + e.job_won + e.site_visit_booked + e.email_sent;
    return total(b[1]) - total(a[1]);
  });

  // Heavier analytics (last 90 days): funnel, outcomes, sources, weekly revenue
  const { funnel, outcomes, weekly, sources } = await loadCompanyAnalytics(supabase, company.id, 90);

  // Pad weekly to 12 buckets
  const weeklyBars = (() => {
    const map = new Map(weekly.map(w => [w.week_start, w]));
    const out: { label: string; value: number; sub?: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const wk = addDaysIso(startStr, -i * 7);
      const bucket = map.get(wk);
      out.push({
        label: shortDate(wk),
        value: bucket?.won_value || 0,
        sub: `${bucket?.activity_count || 0} activities`,
      });
    }
    return out;
  })();

  return (
    <div className="px-8 py-6">
      <div className="flex items-center gap-3 text-sm">
        <Link href="/" className="text-zinc-500 hover:text-zinc-300">← Overview</Link>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300">{company.name}</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold">{company.name}</h1>
      <p className="mt-0.5 text-sm text-zinc-500">
        {company.timezone} · owner {company.owner_name || "—"} · week of {startStr}
      </p>

      {/* Per-day bars */}
      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">This week</h2>
        <div className="mt-3 flex items-end gap-2 h-32">
          {days.map(d => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1">
              <div
                className={`w-full rounded-sm ${d.date === today ? "bg-emerald-500/70" : "bg-zinc-700"}`}
                style={{ height: `${(d.count / maxDayCount) * 100}%`, minHeight: 2 }}
                title={`${d.label} — ${d.count} activities`}
              />
              <div className="text-[10px] text-zinc-500">{d.label}</div>
              <div className="text-[10px] text-zinc-400 tabular-nums">{d.count}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Per-exec week table */}
      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">By exec (week-to-date)</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Exec</th>
                {EVENT_TYPES.map(t => (
                  <th key={t} className="px-3 py-2 text-right font-normal">{EVENT_LABELS[t]}</th>
                ))}
                <th className="px-4 py-2 text-right font-normal">Won $</th>
              </tr>
            </thead>
            <tbody>
              {execRows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500">No activity this week.</td></tr>
              )}
              {execRows.map(([name, c]) => (
                <tr key={name} className="border-t border-zinc-800">
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/execs/${encodeURIComponent(name)}`} className="text-zinc-100 hover:text-white">
                      {name}
                    </Link>
                  </td>
                  {EVENT_TYPES.map(t => (
                    <td key={t} className="px-3 py-2 text-right tabular-nums text-zinc-300">{c[t] || ""}</td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-400">
                    {c.won_value > 0 ? formatCurrency(c.won_value) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Funnel + Revenue */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Funnel (90d)</h2>
            <span className="text-[10px] text-zinc-600">distinct contacts</span>
          </div>
          <div className="mt-4">
            <Funnel
              stages={[
                { label: "Contacts", value: funnel.contacts },
                { label: "Engaged", value: funnel.eod },
                { label: "Site visit", value: funnel.visit },
                { label: "Quoted", value: funnel.quote },
                { label: "Won", value: funnel.won },
              ]}
            />
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Weekly revenue (12w)</h2>
          <div className="mt-4">
            <BarChart bars={weeklyBars} height={160} format="currency" highlightLast />
          </div>
        </section>
      </div>

      {/* Outcomes + Sources */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Top outcomes (90d)</h2>
          <div className="mt-4">
            {outcomes.length === 0
              ? <div className="text-sm text-zinc-500">No outcomes logged.</div>
              : <HBars rows={outcomes.map(o => ({ label: o.outcome, value: o.n }))} />}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Lead sources (90d)</h2>
          <div className="mt-4">
            {sources.length === 0
              ? <div className="text-sm text-zinc-500">No source data.</div>
              : <HBars rows={sources.map(o => ({ label: o.outcome, value: o.n }))} />}
          </div>
        </section>
      </div>

      {/* Live feed */}
      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Recent activity (7d)</h2>
        <div className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
          {(feedRows || []).length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">Nothing logged in the last 7 days.</div>
          )}
          {(feedRows || []).map(r => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                    {EVENT_LABELS[r.event_type] || r.event_type}
                  </span>
                  <span className="text-zinc-400">{r.sales_person_name}</span>
                  {r.contact_name && <span className="text-zinc-500 truncate">→ {r.contact_name}</span>}
                </div>
                {r.outcome && <div className="mt-0.5 text-xs text-zinc-500 truncate">{r.outcome}</div>}
              </div>
              <div className="shrink-0 text-right text-xs text-zinc-500">
                {r.event_type === "job_won" && r.quote_job_value && (
                  <div className="text-emerald-400">{formatCurrency(quoteGroupValue(r.quote_job_value))}</div>
                )}
                <div>{relativeTime(r.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
