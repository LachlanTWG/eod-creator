"use client";

// One activity row with an inline "Edit" button that opens the drawer.
// Server component (page.tsx) passes raw row data; this is a thin client
// wrapper so the drawer can manage its own open state.
//
// Drawer renders a full-viewport <div> overlay; portalled to document.body
// because <div> isn't a valid child of <tbody> (hydration warning).

import { useState } from "react";
import { createPortal } from "react-dom";
import { EVENT_LABELS } from "@/lib/format";
import { EditDrawer, type ActivityRowForEdit, type SalesPersonOption } from "./EditDrawer";

const EVENT_BADGE: Record<string, string> = {
  eod_update:        "bg-zinc-800/80 text-zinc-300",
  quote_sent:        "bg-amber-500/15 text-amber-300",
  site_visit_booked: "bg-sky-500/15 text-sky-300",
  email_sent:        "bg-zinc-700/40 text-zinc-400",
  job_won:           "bg-emerald-500/15 text-emerald-300",
};

export function ActivityRow({
  row,
  companyName,
  salesPeople,
  canEdit,
}: {
  row: ActivityRowForEdit;
  companyName: string;
  salesPeople: SalesPersonOption[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const badgeClass = EVENT_BADGE[row.event_type] || "bg-zinc-800 text-zinc-300";

  return (
    <>
      <tr className="border-t border-zinc-800 align-top hover:bg-zinc-900/40">
        <td className="px-3 py-2 text-xs tabular-nums text-zinc-300">{row.occurred_on}</td>
        <td className="hidden px-3 py-2 text-xs text-zinc-400 md:table-cell">{companyName}</td>
        <td className="hidden px-3 py-2 text-xs text-zinc-300 sm:table-cell">{row.sales_person_name || "—"}</td>
        <td className="px-3 py-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
            {EVENT_LABELS[row.event_type] || row.event_type}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-200">{row.contact_name || <span className="text-zinc-600 italic">—</span>}</td>
        <td className="hidden px-3 py-2 text-[11px] text-zinc-500 lg:table-cell">
          {row.outcome ? <span className="font-mono">{truncate(row.outcome, 80)}</span> : "—"}
        </td>
        <td className="hidden px-3 py-2 text-xs tabular-nums text-zinc-400 sm:table-cell">{row.quote_job_value || "—"}</td>
        <td className="px-2 py-2 text-right">
          {canEdit ? (
            <button
              onClick={() => setOpen(true)}
              className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            >
              Edit
            </button>
          ) : (
            <span className="text-[10px] text-zinc-600">read-only</span>
          )}
        </td>
      </tr>
      {open && typeof document !== "undefined" && createPortal(
        <EditDrawer
          row={row}
          onClose={() => setOpen(false)}
          salesPeople={salesPeople}
          canDelete={canEdit}
        />,
        document.body,
      )}
    </>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
