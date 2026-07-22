import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { loadBacklog, type BacklogItem } from "@/lib/analytics";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BacklogPage() {
  const supabase = await createClient();
  const viewer = await getViewer();
  // RLS automatically scopes activities → backlog for non-admins.
  const { openQuotes, pendingVisits } = await loadBacklog(supabase);

  const totalOpenValue = openQuotes.reduce((s, q) => s + q.last_event_value, 0);
  const scope = viewer.seesAll ? "all clients · all execs" : "your contacts only";

  return (
    <div className="px-8 py-6">
      <header>
        <h1 className="text-xl font-semibold">{viewer.seesAll ? "Backlog" : "My backlog"}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Contacts with open work — last 180 days, not yet won. {scope}.
        </p>
      </header>

      <div className="mt-6 grid grid-cols-3 gap-3 max-w-2xl">
        <Stat label="Open quotes" value={openQuotes.length} />
        <Stat label="Open quote value" value={formatCurrency(totalOpenValue)} accent />
        <Stat label="Pending visits" value={pendingVisits.length} />
      </div>

      <Section title={`Open quotes (${openQuotes.length})`} hint="Quote sent, no win logged since. Sorted by value.">
        <BacklogTable items={openQuotes} showValue showAge />
      </Section>

      <Section title={`Pending site visits (${pendingVisits.length})`} hint="Visit booked, no follow-up activity since. Sorted by age.">
        <BacklogTable items={pendingVisits} showAge />
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
        <span className="text-[11px] text-zinc-500">{hint}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BacklogTable({
  items,
  showValue = false,
  showAge = false,
}: {
  items: BacklogItem[];
  showValue?: boolean;
  showAge?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-500">
        Nothing here.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left font-normal">Contact</th>
            <th className="px-4 py-2 text-left font-normal">Company</th>
            <th className="px-4 py-2 text-left font-normal">Exec</th>
            {showValue && <th className="px-3 py-2 text-right font-normal">Value</th>}
            {showAge && <th className="px-3 py-2 text-right font-normal">Days open</th>}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 100).map(item => (
            <tr key={`${item.company_id}-${item.contact_id}`} className="border-t border-zinc-800 hover:bg-zinc-900/40">
              <td className="px-4 py-2 font-medium text-zinc-100">{item.contact_name || "—"}</td>
              <td className="px-4 py-2 text-zinc-400">
                <Link href={`/companies/${item.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} className="hover:text-zinc-200">
                  {item.company_name}
                </Link>
              </td>
              <td className="px-4 py-2 text-zinc-400">{item.sales_person_name}</td>
              {showValue && (
                <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                  {item.last_event_value > 0 ? formatCurrency(item.last_event_value) : "—"}
                </td>
              )}
              {showAge && (
                <td className={`px-3 py-2 text-right tabular-nums ${item.days_open > 30 ? "text-amber-400" : "text-zinc-400"}`}>
                  {item.days_open}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 100 && (
        <div className="border-t border-zinc-800 bg-zinc-900/40 px-4 py-2 text-center text-xs text-zinc-500">
          Showing top 100 of {items.length}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
