"use client";

// One won job with missing information. Mirrors MissingActivityCard but opens
// the /wins edit drawer, which needs the company + sales-person option lists.

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import {
  EditWonJobDrawer,
  type WonJobRowForEdit,
  type CompanyOption,
  type SalesPersonOption,
} from "../wins/EditWonJobDrawer";
import type { Gap } from "@/lib/missingInfo";

const STAGE_BADGE: Record<string, string> = {
  verbal_confirmation: "bg-zinc-700/40 text-zinc-300",
  client_approved:     "bg-amber-500/15 text-amber-300",
  invoiced:            "bg-sky-500/15 text-sky-300",
  paid:                "bg-emerald-500/15 text-emerald-300",
};
const STAGE_LABEL: Record<string, string> = {
  verbal_confirmation: "Verbal",
  client_approved:     "Approved",
  invoiced:            "Invoiced",
  paid:                "Paid",
};

export function MissingWonJobCard({
  row,
  gaps,
  companies,
  salesPeople,
}: {
  row: WonJobRowForEdit;
  gaps: Gap[];
  companies: CompanyOption[];
  salesPeople: SalesPersonOption[];
}) {
  const [open, setOpen] = useState(false);
  const badgeClass = STAGE_BADGE[row.stage] || "bg-zinc-800 text-zinc-300";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
          {STAGE_LABEL[row.stage] || row.stage}
        </span>
        <span className="text-sm font-medium text-zinc-100">
          {row.contact_name || (
            <span className="italic text-zinc-600">
              {row.type === "retainer" ? "(retainer)" : "no contact name"}
            </span>
          )}
        </span>
        {row.job_value !== null && (
          <span className="text-xs tabular-nums text-zinc-500">{formatCurrency(Number(row.job_value))}</span>
        )}

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
        <EditWonJobDrawer
          row={row}
          onClose={() => setOpen(false)}
          companies={companies}
          salesPeople={salesPeople}
          canDelete
        />
      )}
    </div>
  );
}
