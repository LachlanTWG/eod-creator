// /wins — won_jobs pipeline tracker. Filterable table with inline edit +
// "advance to next stage" per row. RLS scopes: admin sees all; exec sees own.

import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";
import { formatCurrency } from "@/lib/format";
import { WonJobRow } from "./WonJobRow";
import type { Stage } from "./actions";
import type { WonJobRowForEdit } from "./EditWonJobDrawer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = {
  company?: string;
  person?: string;
  stage?: string;
  q?: string;
  page?: string;
};

const STAGE_DISPLAY_ORDER: Stage[] = ["verbal_confirmation", "client_approved", "invoiced", "paid"];
const STAGE_LABEL: Record<Stage, string> = {
  verbal_confirmation: "Verbal",
  client_approved:     "Approved",
  invoiced:            "Invoiced",
  paid:                "Paid",
};

export default async function WinsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  const filters = {
    company: sp.company || "",
    person:  sp.person  || "",
    stage:   sp.stage   || "",
    q:       sp.q       || "",
  };
  const page = Math.max(1, parseInt(sp.page || "1", 10));

  const viewer = await getViewer();
  const supabase = await createClient();

  const { data: mineRows } = await supabase
    .from("sales_people")
    .select("id, company_id")
    .eq("user_id", viewer.user.id);
  const mySalesPersonIds = new Set((mineRows || []).map(r => r.id as string));

  const companies = await listCompanies(supabase);
  const { data: peopleRows } = await supabase
    .from("sales_people")
    .select("id, name, company_id")
    .order("name");
  const salesPeople = (peopleRows || []) as { id: string; name: string; company_id: string }[];

  // Pipeline totals (all matching rows, not paged) — for the stat strip.
  let totalsQ = supabase
    .from("won_jobs")
    .select("stage, commission_amount, job_value");
  if (filters.company) totalsQ = totalsQ.eq("company_id", filters.company);
  if (filters.person)  totalsQ = totalsQ.eq("sales_person_id", filters.person);
  if (filters.q)       totalsQ = totalsQ.ilike("contact_name", `%${filters.q}%`);
  const { data: allRows } = await totalsQ;

  const stageStats: Record<Stage, { count: number; commission: number; jobValue: number }> = {
    verbal_confirmation: { count: 0, commission: 0, jobValue: 0 },
    client_approved:     { count: 0, commission: 0, jobValue: 0 },
    invoiced:            { count: 0, commission: 0, jobValue: 0 },
    paid:                { count: 0, commission: 0, jobValue: 0 },
  };
  for (const r of allRows || []) {
    const s = r.stage as Stage;
    if (s in stageStats) {
      stageStats[s].count++;
      stageStats[s].commission += Number(r.commission_amount || 0);
      stageStats[s].jobValue   += Number(r.job_value || 0);
    }
  }

  // Paged table query
  let q = supabase
    .from("won_jobs")
    .select(
      "id, company_id, sales_person_id, contact_name, contact_address, contact_id, job_value, commission_amount, type, stage, verbal_at, approved_at, invoiced_at, paid_at, invoice_number, notes",
      { count: "exact" },
    );
  if (filters.company) q = q.eq("company_id", filters.company);
  if (filters.person)  q = q.eq("sales_person_id", filters.person);
  if (filters.stage)   q = q.eq("stage", filters.stage);
  if (filters.q)       q = q.ilike("contact_name", `%${filters.q}%`);

  q = q
    .order("paid_at",     { ascending: false, nullsFirst: false })
    .order("invoiced_at", { ascending: false, nullsFirst: false })
    .order("created_at",  { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;
  const { data: rows, count, error } = await q.range(from, to);
  if (error) throw error;

  const companyById = new Map(companies.map(c => [c.id, c.name]));
  const personById  = new Map(salesPeople.map(p => [p.id, p.name]));
  const totalPages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));

  return (
    <div className="px-6 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Won jobs pipeline</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {viewer.isAdmin
              ? "Every won job across every exec. Move through verbal → approved → invoiced → paid."
              : viewer.isViewer
              ? "Every won job across every exec."
              : "Your won jobs. Track from verbal confirmation through to paid."}
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {count?.toLocaleString() ?? 0} match{count === 1 ? "" : "es"}
        </div>
      </header>

      {/* Stage stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STAGE_DISPLAY_ORDER.map(stage => {
          const s = stageStats[stage];
          return (
            <StageCard key={stage} stage={stage} label={STAGE_LABEL[stage]} count={s.count} commission={s.commission} />
          );
        })}
      </div>

      {/* Filters */}
      <FiltersForm
        companies={companies}
        salesPeople={salesPeople}
        defaults={filters}
      />

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Stage</th>
              <th className="px-3 py-2 text-left font-normal">Company</th>
              <th className="px-3 py-2 text-left font-normal">Sales person</th>
              <th className="px-3 py-2 text-left font-normal">Contact</th>
              <th className="px-3 py-2 text-left font-normal">Invoice #</th>
              <th className="px-3 py-2 text-right font-normal">Job $</th>
              <th className="px-3 py-2 text-right font-normal">Commission $</th>
              <th className="px-3 py-2 text-right font-normal">Stage date</th>
              <th className="px-2 py-2 text-right font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-zinc-500">
                  No won jobs match the filters.
                </td>
              </tr>
            )}
            {(rows || []).map(r => {
              const canEdit = viewer.isAdmin || (r.sales_person_id ? mySalesPersonIds.has(r.sales_person_id) : false);
              const editRow: WonJobRowForEdit = {
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
              return (
                <WonJobRow
                  key={r.id}
                  row={editRow}
                  companyName={companyById.get(r.company_id) || "—"}
                  salesPersonName={r.sales_person_id ? (personById.get(r.sales_person_id) || "—") : ""}
                  companies={companies.map(c => ({ id: c.id, name: c.name }))}
                  salesPeople={salesPeople}
                  canEdit={canEdit}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pager page={page} totalPages={totalPages} searchParams={sp} />
      )}
    </div>
  );
}

function StageCard({ stage, label, count, commission }: { stage: Stage; label: string; count: number; commission: number }) {
  const accentBg: Record<Stage, string> = {
    verbal_confirmation: "border-zinc-800 from-zinc-900/40 to-zinc-900/10",
    client_approved:     "border-amber-900/40 from-amber-950/30 to-zinc-950/20",
    invoiced:            "border-sky-900/40 from-sky-950/30 to-zinc-950/20",
    paid:                "border-emerald-900/40 from-emerald-950/30 to-zinc-950/20",
  };
  const accentText: Record<Stage, string> = {
    verbal_confirmation: "text-zinc-200",
    client_approved:     "text-amber-300",
    invoiced:            "text-sky-300",
    paid:                "text-emerald-300",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${accentBg[stage]}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-2xl font-semibold tabular-nums ${accentText[stage]}`}>{count}</div>
        <div className="text-xs text-zinc-500">jobs</div>
      </div>
      <div className="mt-1 text-sm tabular-nums text-zinc-300">
        {commission > 0 ? formatCurrency(commission) : <span className="text-zinc-600">$0</span>}
      </div>
    </div>
  );
}

import Link from "next/link";

function Pager({ page, totalPages, searchParams }: { page: number; totalPages: number; searchParams: SearchParams }) {
  function href(p: number) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== "page") u.set(k, String(v));
    }
    u.set("page", String(p));
    return `/wins?${u.toString()}`;
  }
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
      <div>Page <span className="text-zinc-300">{page}</span> of {totalPages}</div>
      <div className="flex gap-1">
        {page > 1 && <Link href={href(page - 1)} className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 hover:text-zinc-200">← Prev</Link>}
        {page < totalPages && <Link href={href(page + 1)} className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 hover:text-zinc-200">Next →</Link>}
      </div>
    </div>
  );
}

function FiltersForm({
  companies,
  salesPeople,
  defaults,
}: {
  companies: { id: string; name: string }[];
  salesPeople: { id: string; name: string; company_id: string }[];
  defaults: { company: string; person: string; stage: string; q: string };
}) {
  // Server-rendered form; submits as GET, which becomes new searchParams.
  return (
    <form className="mt-5 grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 md:grid-cols-5" action="/wins" method="get">
      <select name="company" defaultValue={defaults.company} className={selectClass}>
        <option value="">All companies</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select name="person" defaultValue={defaults.person} className={selectClass}>
        <option value="">All sales people</option>
        {salesPeople.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} ({companies.find(c => c.id === p.company_id)?.name ?? "?"})
          </option>
        ))}
      </select>
      <select name="stage" defaultValue={defaults.stage} className={selectClass}>
        <option value="">All stages</option>
        <option value="verbal_confirmation">Verbal confirmation</option>
        <option value="client_approved">Client approved</option>
        <option value="invoiced">Invoiced</option>
        <option value="paid">Paid</option>
      </select>
      <input type="text" name="q" defaultValue={defaults.q} placeholder="Contact name…" className={selectClass} />
      <button type="submit" className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700">
        Apply
      </button>
    </form>
  );
}

const selectClass =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none";
