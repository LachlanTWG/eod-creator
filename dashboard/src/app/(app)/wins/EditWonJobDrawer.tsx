"use client";

// Edit drawer for one won_jobs row. Mirrors activities/EditDrawer but with
// the pipeline-specific fields (stages, $ amounts, invoice number, etc).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWonJob, deleteWonJob, advanceStage, type Stage } from "./actions";

const STAGES: { value: Stage; label: string }[] = [
  { value: "verbal_confirmation", label: "Verbal confirmation" },
  { value: "client_approved",     label: "Client approved" },
  { value: "invoiced",            label: "Invoiced" },
  { value: "paid",                label: "Paid" },
];

const TYPES = [
  { value: "comms",    label: "Commission" },
  { value: "retainer", label: "Retainer" },
  { value: "other",    label: "Other" },
] as const;

export type WonJobRowForEdit = {
  id: string;
  company_id: string;
  sales_person_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_id: string | null;
  job_value: number | null;
  commission_amount: number | null;
  type: string;
  stage: Stage;
  verbal_at:   string | null;
  approved_at: string | null;
  invoiced_at: string | null;
  paid_at:     string | null;
  invoice_number: string | null;
  notes: string | null;
};

export type CompanyOption = { id: string; name: string };
export type SalesPersonOption = { id: string; name: string; company_id: string };

export function EditWonJobDrawer({
  row,
  onClose,
  companies,
  salesPeople,
  canDelete,
}: {
  row: WonJobRowForEdit;
  onClose: () => void;
  companies: CompanyOption[];
  salesPeople: SalesPersonOption[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    company_id: row.company_id,
    sales_person_id: row.sales_person_id || "",
    contact_name: row.contact_name || "",
    contact_address: row.contact_address || "",
    contact_id: row.contact_id || "",
    job_value: row.job_value === null ? "" : String(row.job_value),
    commission_amount: row.commission_amount === null ? "" : String(row.commission_amount),
    type: row.type,
    stage: row.stage,
    verbal_at:   isoToInputLocal(row.verbal_at),
    approved_at: isoToInputLocal(row.approved_at),
    invoiced_at: isoToInputLocal(row.invoiced_at),
    paid_at:     isoToInputLocal(row.paid_at),
    invoice_number: row.invoice_number || "",
    notes: row.notes || "",
  });

  const companyPeople = salesPeople.filter(p => p.company_id === form.company_id);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateWonJob({
        id: row.id,
        company_id: form.company_id,
        sales_person_id: form.sales_person_id || null,
        contact_name: form.contact_name,
        contact_address: form.contact_address,
        contact_id: form.contact_id,
        job_value: parseAmount(form.job_value),
        commission_amount: parseAmount(form.commission_amount),
        type: form.type as "comms" | "retainer" | "other",
        stage: form.stage,
        verbal_at:   form.verbal_at,
        approved_at: form.approved_at,
        invoiced_at: form.invoiced_at,
        paid_at:     form.paid_at,
        invoice_number: form.invoice_number,
        notes: form.notes,
      });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  function handleAdvance() {
    setError(null);
    startTransition(async () => {
      const res = await advanceStage(row.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this won job? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteWonJob(row.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  const stageIdx = STAGES.findIndex(s => s.value === form.stage);
  const nextStage = stageIdx >= 0 && stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/60" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <div className="text-sm text-zinc-500">Edit won job</div>
            <div className="mt-0.5 truncate text-base font-semibold text-zinc-100">
              {row.contact_name || (row.type === "retainer" ? "Retainer" : "—")}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">id: {row.id.slice(0, 8)}…</div>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          >
            Close
          </button>
        </div>

        <form className="flex-1 space-y-4 px-5 py-5" onSubmit={handleSubmit}>
          <Field label="Company">
            <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value, sales_person_id: "" }))} className={inputClass}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Sales person">
            <select value={form.sales_person_id} onChange={e => setForm(f => ({ ...f, sales_person_id: e.target.value }))} className={inputClass}>
              <option value="">— (unassigned) —</option>
              {companyPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputClass}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Stage">
              <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value as Stage }))} className={inputClass}>
                {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Contact name">
            <input type="text" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} className={inputClass} />
          </Field>

          <Field label="Contact address">
            <input type="text" value={form.contact_address} onChange={e => setForm(f => ({ ...f, contact_address: e.target.value }))} className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Job value $" hint="Homeowner-side total">
              <input type="number" step="0.01" value={form.job_value} onChange={e => setForm(f => ({ ...f, job_value: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Commission $" hint="What we invoice">
              <input type="number" step="0.01" value={form.commission_amount} onChange={e => setForm(f => ({ ...f, commission_amount: e.target.value }))} className={inputClass} />
            </Field>
          </div>

          <Field label="Invoice #">
            <input type="text" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Verbal at"><input type="datetime-local" value={form.verbal_at}   onChange={e => setForm(f => ({ ...f, verbal_at:   e.target.value }))} className={inputClass} /></Field>
            <Field label="Approved at"><input type="datetime-local" value={form.approved_at} onChange={e => setForm(f => ({ ...f, approved_at: e.target.value }))} className={inputClass} /></Field>
            <Field label="Invoiced at"><input type="datetime-local" value={form.invoiced_at} onChange={e => setForm(f => ({ ...f, invoiced_at: e.target.value }))} className={inputClass} /></Field>
            <Field label="Paid at"><input type="datetime-local" value={form.paid_at}     onChange={e => setForm(f => ({ ...f, paid_at:     e.target.value }))} className={inputClass} /></Field>
          </div>

          <Field label="Notes">
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={inputClass} />
          </Field>

          {error && (
            <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-4">
            <div className="flex gap-2">
              {canDelete && (
                <button type="button" onClick={handleDelete} disabled={pending}
                  className="rounded border border-red-900/50 bg-red-950/20 px-3 py-1.5 text-xs text-red-300 hover:border-red-800 hover:bg-red-900/30 disabled:opacity-50">
                  Delete
                </button>
              )}
              {nextStage && (
                <button type="button" onClick={handleAdvance} disabled={pending}
                  className="rounded border border-emerald-700/40 bg-emerald-900/20 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-700 hover:bg-emerald-900/30 disabled:opacity-50">
                  → {nextStage.label}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={pending}
                className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={pending}
                className="rounded bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[10px] text-zinc-500">{hint}</p>}
    </label>
  );
}

function isoToInputLocal(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16);
}

function parseAmount(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const inputClass =
  "w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600";
