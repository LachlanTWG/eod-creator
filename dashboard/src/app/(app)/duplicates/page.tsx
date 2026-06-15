// /duplicates — admin-only cleanup tool. Scans the whole activities table for
// suspected duplicates (rules live in @/lib/duplicates), groups them into
// clusters, and lets you delete the redundant copies. Read-only until you hit
// delete; nothing is auto-removed.

import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAdmin } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";
import { EVENT_LABELS } from "@/lib/format";
import {
  findDuplicateClusters,
  SCANNED_EVENT_TYPES,
  type DupActivity,
} from "@/lib/duplicates";
import { DuplicateCluster } from "./DuplicateCluster";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

type SearchParams = { company?: string; type?: string };

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await getViewer();
  requireAdmin(viewer);

  const sp = await searchParams;
  const supabase = await createClient();
  const companies = await listCompanies(supabase);
  const companyById = new Map(companies.map(c => [c.id, c.name]));

  const companyFilter = sp.company && companyById.has(sp.company) ? sp.company : "";
  const typeFilter = (SCANNED_EVENT_TYPES as readonly string[]).includes(sp.type || "")
    ? (sp.type as string)
    : "";

  // Pull every scanned row (paging past PostgREST's 1k cap), then cluster in
  // memory. occurred_on/created_at ascending keeps the oldest row first.
  const rows: DupActivity[] = [];
  let from = 0;
  for (;;) {
    let q = supabase
      .from("activities")
      .select(
        "id, company_id, sales_person_id, sales_person_name, occurred_on, event_type, contact_name, contact_address, quote_job_value, appointment_at, source, created_at",
      )
      .in("event_type", typeFilter ? [typeFilter] : (SCANNED_EVENT_TYPES as readonly string[]))
      .order("occurred_on", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (companyFilter) q = q.eq("company_id", companyFilter);

    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as DupActivity[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const clusters = findDuplicateClusters(rows);
  const dupRowTotal = clusters.reduce((n, c) => n + (c.rows.length - 1), 0);

  // Group clusters by company so the page reads client-by-client.
  const byCompany = new Map<string, typeof clusters>();
  for (const c of clusters) {
    const arr = byCompany.get(c.company_id);
    if (arr) arr.push(c);
    else byCompany.set(c.company_id, [c]);
  }
  const companySections = [...byCompany.entries()]
    .map(([id, cs]) => ({ id, name: companyById.get(id) || "Unknown", clusters: cs }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-6 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Duplicates</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
            Suspected duplicate activities across every client. Jobs &amp; quotes match on
            same customer + same value (any date); site visits match on same person + same
            day (a visit re-booked on a later day is kept). Review each cluster and delete the
            redundant copies — the oldest is suggested to keep.
          </p>
        </div>
        <span className="text-xs text-zinc-500">
          {clusters.length.toLocaleString()} cluster{clusters.length === 1 ? "" : "s"} ·{" "}
          {dupRowTotal.toLocaleString()} redundant row{dupRowTotal === 1 ? "" : "s"}
        </span>
      </header>

      <FilterBar companies={companies} company={companyFilter} type={typeFilter} />

      {clusters.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-800 px-3 py-10 text-center text-sm text-zinc-500">
          No duplicates found{companyFilter || typeFilter ? " for this filter" : ""}. 🎉
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {companySections.map(section => (
            <section key={section.id}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-300">
                {section.name}
                <span className="text-xs font-normal text-zinc-600">
                  {section.clusters.length} cluster{section.clusters.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="space-y-3">
                {section.clusters.map(cluster => (
                  <DuplicateCluster
                    key={cluster.key}
                    cluster={cluster}
                    companyName={section.name}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBar({
  companies,
  company,
  type,
}: {
  companies: { id: string; name: string }[];
  company: string;
  type: string;
}) {
  const selectClass =
    "rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none";
  return (
    <form method="get" className="mt-5 flex flex-wrap items-center gap-2">
      <select name="company" defaultValue={company} className={selectClass}>
        <option value="">All clients</option>
        {companies.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select name="type" defaultValue={type} className={selectClass}>
        <option value="">All types</option>
        {SCANNED_EVENT_TYPES.map(t => (
          <option key={t} value={t}>{EVENT_LABELS[t] || t}</option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
      >
        Apply
      </button>
    </form>
  );
}
