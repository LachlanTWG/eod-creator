"use client";

// One won_jobs row in the table with inline edit button + drawer.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import { advanceStage, type Stage } from "./actions";
import { EditWonJobDrawer, type WonJobRowForEdit, type CompanyOption, type SalesPersonOption } from "./EditWonJobDrawer";

const STAGE_BADGE: Record<Stage, string> = {
  verbal_confirmation: "bg-zinc-700/40 text-zinc-300",
  client_approved:     "bg-amber-500/15 text-amber-300",
  invoiced:            "bg-sky-500/15 text-sky-300",
  paid:                "bg-emerald-500/15 text-emerald-300",
};
const STAGE_LABEL: Record<Stage, string> = {
  verbal_confirmation: "Verbal",
  client_approved:     "Approved",
  invoiced:            "Invoiced",
  paid:                "Paid",
};
const STAGE_NEXT_LABEL: Record<Stage, string | null> = {
  verbal_confirmation: "→ Approved",
  client_approved:     "→ Invoiced",
  invoiced:            "→ Paid",
  paid:                null,
};

export function WonJobRow({
  row,
  companyName,
  salesPersonName,
  companies,
  salesPeople,
  canEdit,
}: {
  row: WonJobRowForEdit;
  companyName: string;
  salesPersonName: string;
  companies: CompanyOption[];
  salesPeople: SalesPersonOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const stage = row.stage;
  const nextLabel = STAGE_NEXT_LABEL[stage];

  function handleAdvance(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      await advanceStage(row.id);
      router.refresh();
    });
  }

  return (
    <>
      <tr className="border-t border-zinc-800 align-middle hover:bg-zinc-900/40">
        <td className="px-3 py-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STAGE_BADGE[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-400">{companyName}</td>
        <td className="px-3 py-2 text-xs text-zinc-300">{salesPersonName || "—"}</td>
        <td className="px-3 py-2 text-xs text-zinc-200">
          {row.contact_name || <span className="italic text-zinc-600">{row.type === "retainer" ? "(retainer)" : "—"}</span>}
        </td>
        <td className="px-3 py-2 text-[11px] text-zinc-500">{row.invoice_number || "—"}</td>
        <td className="px-3 py-2 text-right text-xs tabular-nums text-zinc-400">
          {row.job_value !== null ? formatCurrency(Number(row.job_value)) : "—"}
        </td>
        <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-300">
          {row.commission_amount !== null ? formatCurrency(Number(row.commission_amount)) : "—"}
        </td>
        <td className="px-3 py-2 text-right text-xs tabular-nums text-zinc-500">{datePart(stageDate(row))}</td>
        <td className="px-2 py-2 text-right">
          <div className="flex justify-end gap-1">
            {canEdit && nextLabel && (
              <button
                onClick={handleAdvance}
                disabled={pending}
                className="rounded border border-emerald-700/40 bg-emerald-900/20 px-2 py-1 text-[10px] text-emerald-300 hover:border-emerald-700 hover:bg-emerald-900/30 disabled:opacity-50"
              >
                {nextLabel}
              </button>
            )}
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
          </div>
        </td>
      </tr>
      {open && (
        <EditWonJobDrawer
          row={row}
          onClose={() => setOpen(false)}
          companies={companies}
          salesPeople={salesPeople}
          canDelete={canEdit}
        />
      )}
    </>
  );
}

function stageDate(row: WonJobRowForEdit): string | null {
  switch (row.stage) {
    case "verbal_confirmation": return row.verbal_at;
    case "client_approved":     return row.approved_at;
    case "invoiced":            return row.invoiced_at;
    case "paid":                return row.paid_at;
  }
}

function datePart(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}
