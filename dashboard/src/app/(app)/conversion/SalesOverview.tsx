import Link from "next/link";
import { formatPct } from "@/lib/quotieFunnel";
import type { SalesOverviewSnap } from "@/lib/salesOverview";
import { SalesSheet } from "./SalesSheet";

export function SalesOverview({
  snap,
  rangeLabel,
  presets,
  from,
  to,
}: {
  snap: SalesOverviewSnap;
  rangeLabel: string;
  presets: { label: string; from: string; to: string }[];
  from: string;
  to: string;
}) {
  const href = (next: { from: string; to: string }) =>
    `/conversion/sales?from=${next.from}&to=${next.to}`;
  const t = snap.team;
  const closerCash = snap.closers.reduce((n, r) => n + r.cash, 0);
  const setterCash = snap.setters.reduce((n, r) => n + r.cash, 0);

  return (
    <div className="px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-blue-600">Quotie · call funnel</p>
          <h1 className="mt-1 text-xl font-semibold">Sales overview</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {rangeLabel} · cash first. Everything else is how the cash got there.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          Beta · sample numbers
        </span>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {presets.map(p => (
          <Link
            key={p.label}
            href={href(p)}
            className={`rounded-md border px-2 py-1 ${
              from === p.from && to === p.to
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-300 bg-white">
        <div className="grid gap-0 md:grid-cols-[minmax(16rem,22rem)_1fr]">
          <div className="border-b border-slate-300 bg-neutral-800 px-5 py-4 text-white md:border-b-0 md:border-r">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Total cash collected</div>
            <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
              <Money n={t.cash} />
            </div>
            <p className="mt-1 text-xs text-neutral-400">The number. Closers + setters, this range.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[12px]">
              <thead>
                <tr className="bg-neutral-800 text-white">
                  {["Total leads", "Total dials", "Contacts answered", "Conversations", "Calls booked", "Live calls", "Units sold", "Total days worked"].map(h => (
                    <th key={h} className="border border-neutral-700 px-3 py-1.5 text-right font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[t.leads, t.dialled, t.answered, t.conversations, t.booked, t.live, t.sold, t.daysWorked].map((v, i) => (
                    <td key={i} className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800">{v}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <SalesSheet
        title="Closers"
        hint="Ranked by cash. Crown = #1 this range."
        cashHeaders={["Total cash collected", "Cash per day", "Cash per lead", "Cash per live call"]}
        workHeaders={["Total days worked", "Available slots", "Meetings booked", "Live calls sat", "No-shows", "Units sold", "Show rate", "Close rate"]}
        rows={snap.closers.map(r => ({
          name: r.name,
          href: "/conversion/closers",
          cash: [r.cash, r.cashPerDay, r.cashPerLead, r.cashPerLive],
          work: [r.daysWorked, r.slots, r.due, r.live, r.noShow, r.sold, formatPct(r.showRate), formatPct(r.closeRate)],
        }))}
        totals={{
          cash: [closerCash, per(closerCash, snap.closers.reduce((n, r) => n + r.daysWorked, 0)), per(closerCash, snap.closers.reduce((n, r) => n + r.due, 0)), per(closerCash, snap.closers.reduce((n, r) => n + r.live, 0))],
          work: [
            snap.closers.reduce((n, r) => n + r.daysWorked, 0),
            snap.closers.reduce((n, r) => n + r.slots, 0),
            snap.closers.reduce((n, r) => n + r.due, 0),
            snap.closers.reduce((n, r) => n + r.live, 0),
            snap.closers.reduce((n, r) => n + r.noShow, 0),
            snap.closers.reduce((n, r) => n + r.sold, 0),
            formatPct(rate(snap.closers.reduce((n, r) => n + r.live, 0), snap.closers.reduce((n, r) => n + r.due, 0))),
            formatPct(rate(snap.closers.reduce((n, r) => n + r.sold, 0), snap.closers.reduce((n, r) => n + r.live, 0))),
          ],
        }}
      />

      <SalesSheet
        title="Setters"
        hint="Ranked by attributed cash (closer cash × share of bookings). Crown = #1 this range."
        cashHeaders={["Total cash collected", "Cash per day", "Cash per lead", "Cash per booked call"]}
        workHeaders={["Total days worked", "Leads assigned", "Contacts dialled", "Contacts answered", "Conversations", "Qualified answers", "Calls booked", "Manual / direct bookings", "Disqualified", "Lost", "Answer rate", "Lead to booked rate"]}
        rows={snap.setters.map(r => ({
          name: r.name,
          href: "/conversion/setters",
          cash: [r.cash, r.cashPerDay, r.cashPerLead, r.cashPerBooked],
          work: [
            r.daysWorked, r.leads, r.dialled, r.answered, r.conversations, r.qualified,
            r.booked, `${r.bookedManual} / ${r.bookedDirect}`, r.dq, r.lost,
            formatPct(r.answerRate), formatPct(r.leadToBook),
          ],
        }))}
        totals={{
          cash: [setterCash, per(setterCash, snap.setters.reduce((n, r) => n + r.daysWorked, 0)), per(setterCash, snap.setters.reduce((n, r) => n + r.leads, 0)), per(setterCash, snap.setters.reduce((n, r) => n + r.booked, 0))],
          work: [
            snap.setters.reduce((n, r) => n + r.daysWorked, 0),
            snap.setters.reduce((n, r) => n + r.leads, 0),
            snap.setters.reduce((n, r) => n + r.dialled, 0),
            snap.setters.reduce((n, r) => n + r.answered, 0),
            snap.setters.reduce((n, r) => n + r.conversations, 0),
            snap.setters.reduce((n, r) => n + r.qualified, 0),
            snap.setters.reduce((n, r) => n + r.booked, 0),
            `${snap.setters.reduce((n, r) => n + r.bookedManual, 0)} / ${snap.setters.reduce((n, r) => n + r.bookedDirect, 0)}`,
            snap.setters.reduce((n, r) => n + r.dq, 0),
            snap.setters.reduce((n, r) => n + r.lost, 0),
            formatPct(rate(snap.setters.reduce((n, r) => n + r.answered, 0), snap.setters.reduce((n, r) => n + r.dialled, 0))),
            formatPct(rate(snap.setters.reduce((n, r) => n + r.booked, 0), snap.setters.reduce((n, r) => n + r.leads, 0))),
          ],
        }}
      />
    </div>
  );
}

function per(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function Money({ n }: { n: number | null }) {
  if (n == null || !Number.isFinite(n)) return <>—</>;
  const formatted = Math.round(Math.abs(n)).toLocaleString("en-US");
  return (
    <>
      {n < 0 ? "−" : ""}
      <span>$</span>
      {formatted}
    </>
  );
}
