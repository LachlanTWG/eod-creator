import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAppAccess } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";
import { loadConversionSnapshot, EVENT_LABEL } from "@/lib/conversion";
import { formatCurrency, todayInTz, SYDNEY_TZ } from "@/lib/format";
import { mondayOf, addDaysIso, shortDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ConversionPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; from?: string; to?: string }>;
}) {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const params = await searchParams;
  const supabase = await createClient();

  const today = todayInTz(SYDNEY_TZ);
  const monthStart = `${today.slice(0, 8)}01`;
  let from = DATE_RE.test(params.from || "") ? params.from! : monthStart;
  let to = DATE_RE.test(params.to || "") ? params.to! : today;
  if (from > to) [from, to] = [to, from];

  const companies = await listCompanies(supabase);
  const selected = companies.find(c => c.slug === params.company);
  const snap = await loadConversionSnapshot(supabase, {
    from,
    to,
    companyId: selected?.id,
  });

  const maxFunnel = Math.max(1, ...snap.funnel.map(f => f.count));
  const qs = (next: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const company = next.company ?? params.company;
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (company) u.set("company", company);
    if (f) u.set("from", f);
    if (t) u.set("to", t);
    const s = u.toString();
    return s ? `/conversion?${s}` : "/conversion";
  };

  const presets = [
    { label: "Today", from: today, to: today },
    { label: "This week", from: mondayOf(today), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last 30 days", from: addDaysIso(today, -29), to: today },
  ];

  const rangeLabel = from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;

  return (
    <div className="px-8 py-6 space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Conversion</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            First-party funnel — leads, calls, quotes, visits, wins. {rangeLabel}
            {selected ? ` · ${selected.name}` : viewer.seesAll ? " · all clients" : " · your clients"}.
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
          <select
            name="company"
            defaultValue={selected?.slug || ""}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            <option value="">All clients</option>
            {companies.map(c => (
              <option key={c.id} value={c.slug}>{c.name}</option>
            ))}
          </select>
          <input type="date" name="from" defaultValue={from} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs" />
          <input type="date" name="to" defaultValue={to} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs" />
          <button type="submit" className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
            Apply
          </button>
        </form>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {presets.map(p => (
          <Link
            key={p.label}
            href={qs({ from: p.from, to: p.to })}
            className={`rounded-md border px-2 py-1 ${
              from === p.from && to === p.to
                ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Funnel</h2>
        <div className="mt-3 grid gap-2">
          {snap.funnel.map(step => (
            <div key={step.event} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-xs text-zinc-400">{step.label}</div>
              <div className="h-7 flex-1 rounded bg-zinc-900">
                <div
                  className="h-7 rounded bg-emerald-700/70"
                  style={{ width: `${Math.max(step.count ? 4 : 0, (step.count / maxFunnel) * 100)}%` }}
                />
              </div>
              <div className="w-12 shrink-0 text-right text-sm tabular-nums text-zinc-200">{step.count}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">By source</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Source</th>
                <th className="px-4 py-2 text-right font-normal">Leads</th>
                <th className="px-4 py-2 text-right font-normal">Quotes</th>
                <th className="px-4 py-2 text-right font-normal">Wins</th>
                <th className="px-4 py-2 text-right font-normal">Won $</th>
              </tr>
            </thead>
            <tbody>
              {snap.sources.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No events in this range.</td>
                </tr>
              ) : (
                snap.sources.map(s => (
                  <tr key={s.source} className="border-t border-zinc-800">
                    <td className="px-4 py-2 text-zinc-200">{s.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.leads}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.quotes}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.wins}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-300">{formatCurrency(s.wonValue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Recent events</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">When</th>
                <th className="px-4 py-2 text-left font-normal">Event</th>
                <th className="px-4 py-2 text-left font-normal">Contact</th>
                <th className="px-4 py-2 text-left font-normal">Client</th>
                <th className="px-4 py-2 text-left font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {snap.recent.map(r => (
                <tr key={r.id} className="border-t border-zinc-800">
                  <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">{r.occurred_on}</td>
                  <td className="px-4 py-2 text-zinc-200">{EVENT_LABEL[r.event] || r.event}</td>
                  <td className="px-4 py-2 text-zinc-300">{r.contact_name || "—"}</td>
                  <td className="px-4 py-2 text-zinc-400">{r.companyName}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
