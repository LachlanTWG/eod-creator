"use client";

// One activity with missing information. Shows what's blank as red pills and
// opens the SAME edit drawer used on /activities so the fix flow is identical.
// The drawer is a fixed overlay rendered from within this <div>, so no portal
// is needed (unlike the <tbody> rows on /activities).

import { useState } from "react";
import { EVENT_LABELS } from "@/lib/format";
import { EditDrawer, type ActivityRowForEdit, type SalesPersonOption } from "../activities/EditDrawer";
import type { Gap } from "@/lib/missingInfo";

const EVENT_BADGE: Record<string, string> = {
  quote_sent:        "bg-amber-500/15 text-amber-300",
  site_visit_booked: "bg-sky-500/15 text-sky-300",
  job_won:           "bg-emerald-500/15 text-emerald-300",
};

export function MissingActivityCard({
  row,
  gaps,
  salesPeople,
}: {
  row: ActivityRowForEdit;
  gaps: Gap[];
  salesPeople: SalesPersonOption[];
}) {
  const [open, setOpen] = useState(false);
  const badgeClass = EVENT_BADGE[row.event_type] || "bg-zinc-800 text-zinc-300";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
          {EVENT_LABELS[row.event_type] || row.event_type}
        </span>
        <span className="text-sm font-medium text-zinc-100">
          {row.contact_name || <span className="italic text-zinc-600">no contact name</span>}
        </span>
        <span className="text-xs tabular-nums text-zinc-500">{row.occurred_on}</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-red-400/80">Missing</span>
          {gaps.map(g => (
            <span
              key={g.field}
              className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-medium text-red-300"
            >
              {g.label}
            </span>
          ))}
          <button
            onClick={() => setOpen(true)}
            className="rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
          >
            Fix
          </button>
        </div>
      </div>

      {open && (
        <EditDrawer
          row={row}
          onClose={() => setOpen(false)}
          salesPeople={salesPeople}
          canDelete
        />
      )}
    </div>
  );
}
