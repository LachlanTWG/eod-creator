"use client";

// Compact version of the Add Activity drawer, sized for the GHL iframe.
// Same field logic per event type; company is fixed by the URL token, and
// the exec picks their name from the roster. Forces the dark palette
// explicitly (bg on <main>) so it doesn't follow GHL users' light scheme.

import { useState, useTransition } from "react";
import type { NewActivityItem } from "@/lib/manualActivities";
import { submitEodEntry, type EodEntryInput } from "./actions";

const EVENT_TYPES = [
  { value: "quote_sent",        label: "Quote sent" },
  { value: "job_won",           label: "Job won" },
  { value: "site_visit_booked", label: "Site visit booked" },
  { value: "email_sent",        label: "Email sent" },
  { value: "eod_update",        label: "EOD update" },
] as const;

type EventType = (typeof EVENT_TYPES)[number]["value"];

type Item = {
  contact_name: string;
  contact_address: string;
  outcome: string;
  ad_source: string;
  quote_job_value: string;
  appointment_at: string;
};

const emptyItem = (): Item => ({
  contact_name: "",
  contact_address: "",
  outcome: "",
  ad_source: "",
  quote_job_value: "",
  appointment_at: "",
});

export function EodEntryForm({
  token,
  companyName,
  people,
  defaultDate,
}: {
  token: string;
  companyName: string;
  people: string[];
  defaultDate: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const [salesPerson, setSalesPerson] = useState(people[0] ?? "");
  const [date, setDate] = useState(defaultDate);
  const [eventType, setEventType] = useState<EventType>("quote_sent");
  const [items, setItems] = useState<Item[]>([emptyItem()]);

  function patchItem(i: number, patch: Partial<Item>) {
    setItems(list => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() { setItems(list => [...list, emptyItem()]); }
  function removeItem(i: number) { setItems(list => list.filter((_, idx) => idx !== i)); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedCount(null);
    startTransition(async () => {
      const payloadItems: NewActivityItem[] = items.map(it => ({ ...it }));
      const input: EodEntryInput = {
        token,
        sales_person: salesPerson,
        occurred_on: date,
        event_type: eventType,
        items: payloadItems,
      };
      const res = await submitEodEntry(input);
      if (!res.ok) { setError(res.error); return; }
      setSavedCount(res.count);
      setItems([emptyItem()]);
    });
  }

  const rowLabel = eventType === "quote_sent" ? "Quote"
    : eventType === "job_won" ? "Job"
    : eventType === "site_visit_booked" ? "Site visit"
    : eventType === "email_sent" ? "Email"
    : "Entry";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-md px-5 py-6">
        <div className="mb-5 border-b border-zinc-800 pb-4">
          <div className="text-sm text-zinc-500">EOD entry</div>
          <div className="mt-0.5 text-base font-semibold text-zinc-100">{companyName}</div>
          <div className="mt-1 text-[11px] text-zinc-500">
            Saved to the reports <span className="text-zinc-400">and</span> the dashboard.
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Sales person">
            <select value={salesPerson} onChange={e => setSalesPerson(e.target.value)} className={inputClass}>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="">— (no exec / team) —</option>
            </select>
          </Field>

          <Field label="Date">
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
          </Field>

          <Field label="Event type">
            <select value={eventType} onChange={e => setEventType(e.target.value as EventType)} className={inputClass}>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {eventType === "quote_sent" && (
            <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              Each row below is one quote. For a single quote with several options/tiers,
              put the values in the Value box separated by <code className="text-zinc-300">|</code> — they&apos;re averaged.
            </p>
          )}

          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    {rowLabel} {items.length > 1 ? i + 1 : ""}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-[11px] text-zinc-500 hover:text-red-300"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <Field label="Contact name">
                    <input
                      type="text"
                      value={it.contact_name}
                      onChange={e => patchItem(i, { contact_name: e.target.value })}
                      className={inputClass}
                    />
                  </Field>

                  {(eventType === "quote_sent" || eventType === "job_won") && (
                    <Field
                      label={eventType === "quote_sent" ? "Quote value(s)" : "Job value"}
                      hint={eventType === "quote_sent" ? "Dollars, no symbols. Tiers separated by | (e.g. 1200|3500)." : "Dollars, no symbols."}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={it.quote_job_value}
                        onChange={e => patchItem(i, { quote_job_value: e.target.value })}
                        className={inputClass}
                        placeholder={eventType === "quote_sent" ? "e.g. 4500 or 4500|6200" : "e.g. 12000"}
                      />
                    </Field>
                  )}

                  {eventType === "site_visit_booked" && (
                    <Field label="Appointment date/time">
                      <input
                        type="datetime-local"
                        value={it.appointment_at}
                        onChange={e => patchItem(i, { appointment_at: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {eventType === "email_sent" && (
                    <Field label="Subject">
                      <input
                        type="text"
                        value={it.outcome}
                        onChange={e => patchItem(i, { outcome: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {eventType === "eod_update" && (
                    <Field label="Outcome" hint="Pipe-delimited: leadType | answer | action | notes | source">
                      <input
                        type="text"
                        value={it.outcome}
                        onChange={e => patchItem(i, { outcome: e.target.value })}
                        className={`${inputClass} font-mono text-[12px]`}
                      />
                    </Field>
                  )}

                  {(eventType === "quote_sent" || eventType === "job_won" || eventType === "site_visit_booked") && (
                    <Field label="Address" hint="Optional.">
                      <input
                        type="text"
                        value={it.contact_address}
                        onChange={e => patchItem(i, { contact_address: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {(eventType === "quote_sent" || eventType === "job_won" || eventType === "eod_update") && (
                    <Field label="Lead source" hint="Optional.">
                      <input
                        type="text"
                        value={it.ad_source}
                        onChange={e => patchItem(i, { ad_source: e.target.value })}
                        className={inputClass}
                        placeholder="e.g. Facebook Ad Form"
                      />
                    </Field>
                  )}

                  {eventType === "site_visit_booked" && (
                    <Field label="Comment" hint="Optional.">
                      <input
                        type="text"
                        value={it.outcome}
                        onChange={e => patchItem(i, { outcome: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addItem}
              className="w-full rounded border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              + Add another {rowLabel.toLowerCase()}
            </button>
          </div>

          {error && (
            <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {savedCount !== null && !error && (
            <div className="rounded border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
              Saved {savedCount === 1 ? "1 activity" : `${savedCount} activities`}. Add more below or close this tab.
            </div>
          )}

          <div className="flex items-center justify-end border-t border-zinc-800 pt-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {pending ? "Saving…" : `Add ${items.length > 1 ? items.length + " activities" : "activity"}`}
            </button>
          </div>
        </form>
      </div>
    </main>
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

const inputClass =
  "w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600";
