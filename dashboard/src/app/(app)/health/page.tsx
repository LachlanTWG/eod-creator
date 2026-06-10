import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAdmin } from "@/lib/viewer";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const viewer = await getViewer();
  requireAdmin(viewer);
  const supabase = await createClient();

  // Last activity per company — to spot dead webhooks at a glance.
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, timezone, active")
    .eq("active", true)
    .order("name");

  // One query per company, but fired in parallel rather than a serial
  // for…await chain (which paid each round-trip's latency end-to-end).
  const lastByCompany: Record<string, { at: string | null; source: string | null }> = {};
  const lastEntries = await Promise.all(
    (companies || []).map(async c => {
      const { data } = await supabase
        .from("activities")
        .select("created_at, source")
        .eq("company_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [c.id, { at: data?.created_at || null, source: data?.source || null }] as const;
    }),
  );
  for (const [id, v] of lastEntries) lastByCompany[id] = v;

  // Recent webhook events (last 100, admin-only via RLS)
  const { data: events } = await supabase
    .from("webhook_events")
    .select("id, path, method, status, ip, error, received_at")
    .order("received_at", { ascending: false })
    .limit(100);

  // 24h summary
  const since = Date.now() - 24 * 3600 * 1000;
  const recent = (events || []).filter(e => new Date(e.received_at).getTime() >= since);
  const ok = recent.filter(e => e.status >= 200 && e.status < 300).length;
  const fail = recent.length - ok;

  return (
    <div className="px-8 py-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Health</h1>
      <p className="mt-0.5 text-sm text-zinc-500">Ingestion + last activity per company.</p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Webhooks 24h" value={recent.length} />
        <Stat label="OK" value={ok} accent="emerald" />
        <Stat label="Failed" value={fail} accent={fail > 0 ? "red" : "zinc"} />
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Last activity by company</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Company</th>
                <th className="px-4 py-2 text-left font-normal">Last activity</th>
                <th className="px-4 py-2 text-left font-normal">Source</th>
                <th className="px-4 py-2 text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {(companies || []).map(c => {
                const last = lastByCompany[c.id];
                const hours = last?.at
                  ? (Date.now() - new Date(last.at).getTime()) / 3600000
                  : Infinity;
                const stale = hours > 48;
                return (
                  <tr key={c.id} className="border-t border-zinc-800">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 text-zinc-300">{relativeTime(last?.at || null)}</td>
                    <td className="px-4 py-2 text-zinc-400">{last?.source || "—"}</td>
                    <td className="px-4 py-2">
                      {!last?.at ? (
                        <span className="text-zinc-500">no data</span>
                      ) : stale ? (
                        <span className="text-amber-400">stale (&gt;48h)</span>
                      ) : (
                        <span className="text-emerald-400">healthy</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Recent webhooks</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-normal">When</th>
                <th className="px-4 py-2 text-left font-normal">Path</th>
                <th className="px-4 py-2 text-left font-normal">Status</th>
                <th className="px-4 py-2 text-left font-normal">IP</th>
                <th className="px-4 py-2 text-left font-normal">Error</th>
              </tr>
            </thead>
            <tbody>
              {(events || []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  No webhook events logged yet. (The Node service has to write
                  to <code className="rounded bg-zinc-800 px-1.5 py-0.5">webhook_events</code> for
                  these to show up — wire that up next.)
                </td></tr>
              )}
              {(events || []).map(e => (
                <tr key={e.id} className="border-t border-zinc-800">
                  <td className="px-4 py-2 text-zinc-400">{relativeTime(e.received_at)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.method} {e.path}</td>
                  <td className={`px-4 py-2 tabular-nums ${e.status >= 400 ? "text-red-400" : "text-emerald-400"}`}>
                    {e.status}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{e.ip || "—"}</td>
                  <td className="px-4 py-2 text-zinc-500 truncate max-w-xs">{e.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent = "zinc" }: { label: string; value: number; accent?: "emerald" | "red" | "zinc" }) {
  const color = accent === "emerald" ? "text-emerald-400" : accent === "red" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
