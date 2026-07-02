// /missing — admin-only data-quality tool. Scans activities (quotes / jobs won /
// site visits) and won jobs for records with blank fields that SHOULD be filled
// (rules live in @/lib/missingInfo), groups them by client, and lets you fix
// each one in place via the same edit drawers used on /activities and /wins.
// Read-only until you open a record and hit Save.

import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAdmin } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";
import {
  scanActivities,
  scanWonJobs,
  SCANNED_EVENT_TYPES,
  type ScanActivity,
  type ScanWonJob,
  type ActivityGaps,
  type WonJobGaps,
} from "@/lib/missingInfo";
import type { ActivityRowForEdit } from "../activities/EditDrawer";
import type { WonJobRowForEdit } from "../wins/EditWonJobDrawer";
import type { Stage } from "../wins/actions";
import { MissingActivityCard } from "./MissingActivityCard";
import { MissingWonJobCard } from "./MissingWonJobCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

const KINDS = ["all", "activities", "wins"] as const;
type Kind = (typeof KINDS)[number];

type SearchParams = { company?: string; kind?: string };

export default async function MissingInfoPage({
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
  const kind: Kind = (KINDS as readonly string[]).includes(sp.kind || "")
    ? (sp.kind as Kind)
    : "all";

  // Pull scanned activities + won jobs (paging past PostgREST's 1k cap), then
  // detect gaps in memory. Records on archived clients are dropped via the
  // companyById lookup, so this stays focused on live work.
  const scanAct = kind !== "wins";
  const scanWon = kind !== "activities";

  const actGaps = scanAct
    ? scanActivities(
        await pageAll<ScanActivity>(async (from, to) => {
          let q = supabase
            .from("activities")
            .select(
              "id, company_id, sales_person_id, sales_person_name, occurred_on, event_type, contact_name, contact_address, outcome, quote_job_value, appointment_at",
            )
            .in("event_type", SCANNED_EVENT_TYPES as readonly string[])
            .order("occurred_on", { ascending: false })
            .range(from, to);
          if (companyFilter) q = q.eq("company_id", companyFilter);
          const { data, error } = await q;
          if (error) throw error;
          return (data || []) as ScanActivity[];
        }),
      ).filter(x => companyById.has(x.row.company_id))
    : [];

  const wonGaps = scanWon
    ? scanWonJobs(
        await pageAll<ScanWonJob>(async (from, to) => {
          let q = supabase
            .from("won_jobs")
            .select(
              "id, company_id, sales_person_id, contact_name, contact_address, contact_id, job_value, commission_amount, type, stage, verbal_at, approved_at, invoiced_at, paid_at, invoice_number, notes",
            )
            .order("created_at", { ascending: false })
            .range(from, to);
          if (companyFilter) q = q.eq("company_id", companyFilter);
          const { data, error } = await q;
          if (error) throw error;
          return (data || []) as ScanWonJob[];
        }),
      ).filter(x => companyById.has(x.row.company_id))
    : [];

  const total = actGaps.length + wonGaps.length;

  // Reference data for the edit drawers.
  const { data: peopleRows } = await supabase
    .from("sales_people")
    .select("id, name, company_id")
    .order("name");
  const salesPeople = (peopleRows || []) as { id: string; name: string; company_id: string }[];
  const companyOptions = companies.map(c => ({ id: c.id, name: c.name }));

  // Group by company so the page reads client-by-client.
  type Section = { id: string; name: string; activities: ActivityGaps[]; wonJobs: WonJobGaps[] };
  const byCompany = new Map<string, Section>();
  const section = (id: string): Section => {
    let s = byCompany.get(id);
    if (!s) {
      s = { id, name: companyById.get(id) || "Unknown", activities: [], wonJobs: [] };
      byCompany.set(id, s);
    }
    return s;
  };
  for (const a of actGaps) section(a.row.company_id).activities.push(a);
  for (const w of wonGaps) section(w.row.company_id).wonJobs.push(w);
  const sections = [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-6 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Missing information</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
            Records with blank fields that should be filled in. Quotes &amp; jobs won want a
            contact + value; site visits want an address + time; won jobs want a value (and an
            invoice # once invoiced). Hit <span className="text-zinc-300">Fix</span> on any record
            to complete it — it disappears from this list once saved.
          </p>
        </div>
        <span className="text-xs text-zinc-500">
          {total.toLocaleString()} record{total === 1 ? "" : "s"} with gaps
        </span>
      </header>

      <FilterBar companies={companyOptions} company={companyFilter} kind={kind} />

      {total === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-800 px-3 py-10 text-center text-sm text-zinc-500">
          Nothing missing{companyFilter || kind !== "all" ? " for this filter" : ""}. 🎉
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {sections.map(sec => (
            <section key={sec.id}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-300">
                {sec.name}
                <span className="text-xs font-normal text-zinc-600">
                  {sec.activities.length + sec.wonJobs.length} record
                  {sec.activities.length + sec.wonJobs.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="space-y-2">
                {sec.activities.map(a => (
                  <MissingActivityCard
                    key={a.row.id}
                    row={a.row as ActivityRowForEdit}
                    gaps={a.gaps}
                    salesPeople={salesPeople}
                  />
                ))}
                {sec.wonJobs.map(w => (
                  <MissingWonJobCard
                    key={w.row.id}
                    row={toWonJobEdit(w.row)}
                    gaps={w.gaps}
                    companies={companyOptions}
                    salesPeople={salesPeople}
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

// Page through a PostgREST query past the 1000-row cap.
async function pageAll<T>(fetchPage: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// won_jobs numeric columns arrive as strings from PostgREST; normalise for the
// drawer (mirrors /wins).
function toWonJobEdit(r: ScanWonJob): WonJobRowForEdit {
  return {
    id: r.id,
    company_id: r.company_id,
    sales_person_id: r.sales_person_id,
    contact_name: r.contact_name,
    contact_address: r.contact_address,
    contact_id: r.contact_id,
    job_value: r.job_value !== null ? Number(r.job_value) : null,
    commission_amount: r.commission_amount !== null ? Number(r.commission_amount) : null,
    type: r.type,
    stage: r.stage as Stage,
    verbal_at: r.verbal_at,
    approved_at: r.approved_at,
    invoiced_at: r.invoiced_at,
    paid_at: r.paid_at,
    invoice_number: r.invoice_number,
    notes: r.notes,
  };
}

function FilterBar({
  companies,
  company,
  kind,
}: {
  companies: { id: string; name: string }[];
  company: string;
  kind: Kind;
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
      <select name="kind" defaultValue={kind} className={selectClass}>
        <option value="all">Everything</option>
        <option value="activities">Activities only</option>
        <option value="wins">Won jobs only</option>
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
