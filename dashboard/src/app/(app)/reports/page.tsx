import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { loadReports, listCompanies } from "@/lib/queries";
import { loadBacklog } from "@/lib/analytics";
import { fetchLivePreview, isPreviewConfigured } from "@/lib/preview";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

const REPORT_TYPES = [
  { key: "eod", label: "EOD" },
  { key: "eow", label: "EOW" },
  { key: "eom", label: "EOM" },
  { key: "eoq", label: "EOQ" },
  { key: "eoy", label: "EOY" },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; company?: string; live?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const supabase = await createClient();

  const requestedType = params.type as typeof REPORT_TYPES[number]["key"] | undefined;
  const reportType = REPORT_TYPES.some(t => t.key === requestedType) ? requestedType : "eod";
  const companyFilter = params.company || "";
  const wantLive = params.live === "1";

  const companies = await listCompanies(supabase);
  const selectedCompany = companies.find(c => c.slug === companyFilter);

  const reports = await loadReports(supabase, {
    reportType,
    companyId: selectedCompany?.id,
    limit: 50,
  });

  // Live preview for the selected company (only if a company is selected
  // AND the Node service is configured)
  const liveAvailable = isPreviewConfigured();
  let livePreview: Awaited<ReturnType<typeof fetchLivePreview>> | null = null;
  let liveError: string | null = null;
  if (wantLive && selectedCompany && liveAvailable && reportType) {
    try {
      livePreview = await fetchLivePreview(reportType, selectedCompany.name);
    } catch (e) {
      liveError = e instanceof Error ? e.message : String(e);
    }
  }

  // Backlog data alongside (RLS-scoped automatically)
  const { openQuotes, pendingVisits } = await loadBacklog(supabase);
  const filteredOpenQuotes = selectedCompany
    ? openQuotes.filter(q => q.company_id === selectedCompany.id)
    : openQuotes;
  const filteredPendingVisits = selectedCompany
    ? pendingVisits.filter(v => v.company_id === selectedCompany.id)
    : pendingVisits;
  const openValue = filteredOpenQuotes.reduce((s, q) => s + q.last_event_value, 0);

  return (
    <div className="px-8 py-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Archived EOD / EOW / EOM / EOQ / EOY messages. {viewer.isAdmin ? "All clients." : "Your reports only."}
        </p>
      </header>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
          {REPORT_TYPES.map(t => {
            const active = t.key === reportType;
            const href = buildHref({ type: t.key, company: companyFilter, live: wantLive ? "1" : undefined });
            return (
              <Link
                key={t.key}
                href={href}
                className={`px-3 py-1.5 rounded-sm transition-colors ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5 text-xs">
          <Link
            href={buildHref({ type: reportType, company: "", live: undefined })}
            className={`px-3 py-1.5 rounded-sm transition-colors ${!selectedCompany ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            All clients
          </Link>
          {companies.map(c => {
            const active = c.slug === companyFilter;
            return (
              <Link
                key={c.id}
                href={buildHref({ type: reportType, company: c.slug, live: wantLive ? "1" : undefined })}
                className={`px-3 py-1.5 rounded-sm transition-colors ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {c.name}
              </Link>
            );
          })}
        </div>

        {selectedCompany && (
          <Link
            href={buildHref({ type: reportType, company: companyFilter, live: wantLive ? undefined : "1" })}
            className={`text-xs rounded-md border px-3 py-1.5 transition-colors ${wantLive ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
            title={liveAvailable ? "Generate a fresh report from current activity data" : "Set NODE_SERVICE_URL to enable"}
          >
            {wantLive ? "● Live preview on" : "Generate live preview"}
          </Link>
        )}
      </section>

      {/* Live preview block */}
      {wantLive && selectedCompany && (
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-900/10 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-emerald-200">
              Live preview · {selectedCompany.name} · {reportType.toUpperCase()}
            </h2>
            <span className="text-[11px] text-emerald-300/70">freshly generated, not archived</span>
          </div>

          {liveError && (
            <div className="mt-3 rounded border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-200 font-mono">
              {liveError}
            </div>
          )}

          {!liveAvailable && !liveError && (
            <div className="mt-3 text-xs text-zinc-500">
              <code className="rounded bg-zinc-900 px-1.5 py-0.5">NODE_SERVICE_URL</code> not set.
              Add it to <code className="rounded bg-zinc-900 px-1.5 py-0.5">dashboard/.env.local</code> pointing at your Railway URL.
            </div>
          )}

          {livePreview && (
            <div className="mt-4 space-y-4">
              {livePreview.team && (
                <ReportBlock title="Team" text={livePreview.team.formatted} />
              )}
              {livePreview.people?.map(p => (
                <ReportBlock key={p.name} title={p.name} text={p.formatted} />
              ))}
            </div>
          )}
        </section>
      )}

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

      {/* Archived reports */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">
          Archived {reportType.toUpperCase()} messages
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Populated automatically when cron archives at 11:55pm AEST (EOD/EOW) or end-of-period (EOM/EOQ/EOY).
        </p>

        {reports.length === 0 ? (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center text-sm text-zinc-500">
            No archived {reportType.toUpperCase()} reports yet
            {selectedCompany ? ` for ${selectedCompany.name}` : ""}.
            {selectedCompany && liveAvailable && " Use the live preview button above to generate one now."}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {reports.map(r => (
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
                  <ReportBlock text={r.formatted_text} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function buildHref(opts: { type: string; company: string; live?: string | undefined }): string {
  const params = new URLSearchParams();
  params.set("type", opts.type);
  if (opts.company) params.set("company", opts.company);
  if (opts.live) params.set("live", opts.live);
  return `/reports?${params.toString()}`;
}

function ReportBlock({ title, text }: { title?: string; text: string }) {
  return (
    <div>
      {title && (
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      )}
      <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-200">
        {text}
      </pre>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
