import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAppAccess } from "@/lib/viewer";
import { loadConversionByCompany } from "@/lib/conversion";
import { todayInTz, SYDNEY_TZ } from "@/lib/format";
import { mondayOf, addDaysIso, shortDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ConversionIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
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

  const boards = await loadConversionByCompany(supabase, { from, to });
  if (boards.length === 1) {
    const q = new URLSearchParams({ from, to });
    redirect(`/conversion/${boards[0].companySlug}?${q}`);
  }

  const rangeLabel = from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
  const qs = (next: { from: string; to: string }) =>
    `/conversion?from=${next.from}&to=${next.to}`;
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "This week", from: mondayOf(today), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last 30 days", from: addDaysIso(today, -29), to: today },
  ];

  return (
    <div className="px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Conversion</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            One funnel per client. {rangeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {presets.map(p => (
            <Link
              key={p.label}
              href={qs(p)}
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
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {boards.map(board => {
          const leads = board.funnel.find(s => s.event === "lead_in")?.count || 0;
          const quotes = board.funnel.find(s => s.event === "quote_sent")?.count || 0;
          const wins = board.funnel.find(s => s.event === "won")?.count || 0;
          const max = Math.max(1, ...board.funnel.map(s => s.count));
          return (
            <Link
              key={board.companyId}
              href={`/conversion/${board.companySlug}?from=${from}&to=${to}`}
              className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 hover:border-zinc-600"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-medium text-zinc-100">{board.companyName}</h2>
                <span className="text-[11px] text-zinc-500">{wins} won</span>
              </div>
              <div className="mt-3 space-y-1.5">
                {board.funnel.filter(s => (s.event !== "vsl_view" && s.event !== "vsl_complete") || s.count > 0).map(step => (
                  <div key={step.event} className="flex items-center gap-2">
                    <div className="w-20 shrink-0 text-[11px] text-zinc-500">{step.label}</div>
                    <div className="h-1.5 flex-1 rounded bg-zinc-900">
                      <div
                        className="h-1.5 rounded bg-emerald-700/70"
                        style={{ width: `${step.count ? Math.max(6, (step.count / max) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="w-8 text-right text-[11px] tabular-nums text-zinc-300">{step.count}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-zinc-600">
                {leads} leads · {quotes} quotes · {wins} wins
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
