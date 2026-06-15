"use client";

// One suspected-duplicate cluster: a header describing what the rows share,
// then a checkbox row per activity. The oldest row is pre-marked "keep"; every
// other row starts selected for deletion. Delete uses the same two-step confirm
// as the activities table (browsers can suppress native confirm()).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_LABELS, quoteGroupValue, formatCurrency } from "@/lib/format";
import type { DupCluster } from "@/lib/duplicates";
import { deleteActivities } from "./actions";

const EVENT_BADGE: Record<string, string> = {
  quote_sent:        "bg-amber-500/15 text-amber-300",
  site_visit_booked: "bg-sky-500/15 text-sky-300",
  job_won:           "bg-emerald-500/15 text-emerald-300",
};

export function DuplicateCluster({
  cluster,
  companyName,
}: {
  cluster: DupCluster;
  companyName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Default: keep the oldest (rows[0]), select the rest for deletion.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(cluster.rows.slice(1).map(r => r.id)),
  );

  const badgeClass = EVENT_BADGE[cluster.event_type] || "bg-zinc-800 text-zinc-300";
  const valueLabel = useMemo(() => {
    if (cluster.event_type === "site_visit_booked") return cluster.occurred_on;
    if (!cluster.value) return null;
    return `${cluster.value}  ·  ${formatCurrency(quoteGroupValue(cluster.value))}`;
  }, [cluster]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteActivities([...selected]);
      if (!res.ok) { setError(res.error); setConfirming(false); return; }
      setDone(res.deleted);
      router.refresh();
    });
  }

  if (dismissed) return null;

  if (done !== null) {
    return (
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 px-4 py-3 text-xs text-emerald-300">
        Deleted {done} row{done === 1 ? "" : "s"}. Refreshing…
      </div>
    );
  }

  const count = selected.size;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
          {EVENT_LABELS[cluster.event_type] || cluster.event_type}
        </span>
        <span className="text-sm font-medium text-zinc-100">{cluster.contact_name}</span>
        {valueLabel && <span className="text-xs tabular-nums text-zinc-400">{valueLabel}</span>}
        <span className="text-xs text-zinc-600">·</span>
        <span className="text-xs text-zinc-500">{companyName}</span>
        <span className="ml-auto rounded bg-red-950/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300">
          {cluster.rows.length} copies
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-zinc-600">
          <tr>
            <th className="px-3 py-1.5 text-left font-normal"> </th>
            <th className="px-3 py-1.5 text-left font-normal">Date</th>
            <th className="px-3 py-1.5 text-left font-normal">Sales person</th>
            <th className="px-3 py-1.5 text-left font-normal">Address</th>
            <th className="px-3 py-1.5 text-left font-normal">Value</th>
            <th className="px-3 py-1.5 text-left font-normal">Source</th>
            <th className="px-3 py-1.5 text-left font-normal">Logged</th>
          </tr>
        </thead>
        <tbody>
          {cluster.rows.map((row, i) => {
            const isSelected = selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={`border-t border-zinc-800/70 align-top ${isSelected ? "bg-red-950/10" : ""}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(row.id)}
                    disabled={pending}
                    className="h-3.5 w-3.5 accent-red-500"
                    aria-label={isSelected ? "Marked for deletion" : "Keep"}
                  />
                </td>
                <td className="px-3 py-2 text-xs tabular-nums text-zinc-300">
                  {row.occurred_on}
                  {i === 0 && (
                    <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">
                      oldest
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-300">{row.sales_person_name || "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{row.contact_address || "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-zinc-400">{row.quote_job_value || "—"}</td>
                <td className="px-3 py-2 text-[11px] text-zinc-500">{row.source}</td>
                <td className="px-3 py-2 text-[11px] text-zinc-500" title={row.created_at}>
                  {row.created_at.slice(0, 10)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {error && (
        <div className="border-t border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">{error}</div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-4 py-2.5">
        <span className="text-[11px] text-zinc-500">
          {count} of {cluster.rows.length} marked for deletion
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            disabled={pending}
            className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
          >
            Keep all
          </button>
          {confirming ? (
            <>
              <span className="text-xs text-zinc-400">Delete {count} row{count === 1 ? "" : "s"}?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending || count === 0}
                className="rounded border border-red-900/50 bg-red-950/20 px-3 py-1.5 text-xs text-red-300 hover:border-red-800 hover:bg-red-900/30 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
              >
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending || count === 0}
              className="rounded border border-red-900/50 bg-red-950/20 px-3 py-1.5 text-xs text-red-300 hover:border-red-800 hover:bg-red-900/30 disabled:opacity-50"
            >
              Delete selected
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
