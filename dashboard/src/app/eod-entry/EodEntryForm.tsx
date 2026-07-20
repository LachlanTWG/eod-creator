"use client";

// The GHL popup form (served inside the EOD Logger extension panel).
// Layout: Details (company / contact / prior history) → New Submission.
// The primary flow is the EOD call log — the same five fields as the GHL
// custom fields (Stage / Answered? / Standard Outcome / Custom Outcome /
// Contact Source), submitted as one eod_update with the outcome joined
// " | "-style so it's byte-identical to what the /webhook/ghl/eod path
// produces. Quotes / jobs / site visits / emails stay available behind the
// event-type selector with the original multi-row UI.

import { useState, useTransition } from "react";
import type { NewActivityItem } from "@/lib/manualActivities";
import type { ContactHistory, EodOptions } from "./data";
import { submitEodEntry, type EodEntryInput } from "./actions";

const EVENT_TYPES = [
  { value: "eod_update",        label: "EOD update (call log)" },
  { value: "quote_sent",        label: "Quote sent" },
  { value: "job_won",           label: "Job won" },
  { value: "site_visit_booked", label: "Site visit booked" },
  { value: "email_sent",        label: "Email sent" },
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

const emptyItem = (contactName = ""): Item => ({
  contact_name: contactName,
  contact_address: "",
  outcome: "",
  ad_source: "",
  quote_job_value: "",
  appointment_at: "",
});

const FALLBACK_OPTIONS: EodOptions = { stages: [], outcomes: [], sources: [] };

export function EodEntryForm({
  token,
  ghlLocationId = "",
  companyName,
  people,
  defaultDate,
  contactName = "",
  contactId = "",
  options = FALLBACK_OPTIONS,
  history = null,
}: {
  token: string;
  ghlLocationId?: string;
  companyName: string;
  people: string[];
  defaultDate: string;
  contactName?: string;
  contactId?: string;
  options?: EodOptions;
  history?: ContactHistory | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const [salesPerson, setSalesPerson] = useState(people[0] ?? "");
  const [date, setDate] = useState(defaultDate);
  const [eventType, setEventType] = useState<EventType>("eod_update");

  // EOD call-log fields (the five GHL custom fields).
  const [eodName, setEodName] = useState(contactName);
  const [stage, setStage] = useState(history?.lastStage || options.stages[0] || "");
  const [answered, setAnswered] = useState("");
  const [stdOutcome, setStdOutcome] = useState("");
  const [customOutcome, setCustomOutcome] = useState("");
  const [source, setSource] = useState(history?.topSource || "");

  // Multi-row items for the non-EOD event types.
  const [items, setItems] = useState<Item[]>([emptyItem(contactName)]);

  function patchItem(i: number, patch: Partial<Item>) {
    setItems(list => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() { setItems(list => [...list, emptyItem(contactName)]); }
  function removeItem(i: number) { setItems(list => list.filter((_, idx) => idx !== i)); }

  function submit(payloadItems: NewActivityItem[], evType: EventType) {
    const input: EodEntryInput = {
      token,
      ghl_location_id: ghlLocationId,
      sales_person: salesPerson,
      occurred_on: date,
      event_type: evType,
      items: payloadItems,
    };
    startTransition(async () => {
      const res = await submitEodEntry(input);
      if (!res.ok) { setError(res.error); return; }
      setSavedCount(res.count);
      if (evType === "eod_update") {
        // Keep stage + source (same contact, likely same context next time);
        // clear the per-call outcomes.
        setAnswered("");
        setStdOutcome("");
        setCustomOutcome("");
      } else {
        setItems([emptyItem(contactName)]);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedCount(null);

    if (eventType === "eod_update") {
      if (!answered) { setError("Tap Answered or Didn't Answer"); return; }
      // Same join as the GHL webhook: parts trimmed, " | " separator, empties kept.
      const outcome = [stage, answered, stdOutcome, customOutcome, source]
        .map(s => s.trim())
        .join(" | ");
      submit(
        [{
          contact_name: eodName,
          contact_id: contactId && eodName.trim() === contactName.trim() ? contactId : "",
          outcome,
          ad_source: source,
        }],
        "eod_update",
      );
      return;
    }

    const payloadItems: NewActivityItem[] = items.map(it => ({
      ...it,
      contact_id:
        contactId && it.contact_name.trim() === contactName.trim() ? contactId : "",
    }));
    submit(payloadItems, eventType);
  }

  const rowLabel = eventType === "quote_sent" ? "Quote"
    : eventType === "job_won" ? "Job"
    : eventType === "site_visit_booked" ? "Site visit"
    : "Email";

  return (
    <div>
        {/* ── Details ─────────────────────────────────────────────── */}
        <div className="mb-4 border-b border-zinc-800 pb-3">
          <div className="flex items-baseline justify-between">
            <div className="text-base font-semibold text-zinc-100">{companyName}</div>
            <div className="text-[11px] text-zinc-500">{date}</div>
          </div>
          {contactName && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-sky-900/60 bg-sky-950/40 px-2.5 py-0.5 text-[11px] text-sky-300">
              {contactName}
            </div>
          )}
        </div>

        {(contactName || contactId) && <HistoryCard history={history} />}

        {/* ── New Submission ─────────────────────────────────────── */}
        <form className="space-y-3.5" onSubmit={handleSubmit}>
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            New submission
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sales person">
              <select value={salesPerson} onChange={e => setSalesPerson(e.target.value)} className={inputClass}>
                {people.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="">— team —</option>
              </select>
            </Field>
            <Field label="Date">
              <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <Field label="Type">
            <select value={eventType} onChange={e => setEventType(e.target.value as EventType)} className={inputClass}>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {eventType === "eod_update" ? (
            <>
              <Field label="Contact name">
                <input type="text" value={eodName} onChange={e => setEodName(e.target.value)} className={inputClass} />
              </Field>

              <Field label="EOD 1 · Stage">
                <select value={stage} onChange={e => setStage(e.target.value)} className={inputClass}>
                  {options.stages.map(s => <option key={s} value={s}>{s}</option>)}
                  {stage && !options.stages.includes(stage) && <option value={stage}>{stage}</option>}
                </select>
              </Field>

              <Field label="EOD 2 · Answered?">
                <div className="grid grid-cols-2 gap-2">
                  {["Answered", "Didn't Answer"].map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAnswered(a)}
                      className={
                        answered === a
                          ? a === "Answered"
                            ? "rounded border border-emerald-600 bg-emerald-600/20 px-3 py-2 text-sm font-medium text-emerald-300"
                            : "rounded border border-amber-600 bg-amber-600/20 px-3 py-2 text-sm font-medium text-amber-300"
                          : "rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-600"
                      }
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="EOD 3 · Standard outcome">
                <select value={stdOutcome} onChange={e => setStdOutcome(e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {options.outcomes.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>

              <Field label="EOD 4 · Custom outcome" hint="Optional — anything worth remembering.">
                <input
                  type="text"
                  value={customOutcome}
                  onChange={e => setCustomOutcome(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="EOD 5 · Contact source">
                <select value={source} onChange={e => setSource(e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {options.sources.map(s => <option key={s} value={s}>{s}</option>)}
                  {source && !options.sources.includes(source) && <option value={source}>{source}</option>}
                </select>
              </Field>
            </>
          ) : (
            <>
              {eventType === "quote_sent" && (
                <p className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                  Each row is one quote. Tiers of a single quote go in the Value box separated by{" "}
                  <code className="text-zinc-300">|</code> — they&apos;re averaged.
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
                        <button type="button" onClick={() => removeItem(i)} className="text-[11px] text-zinc-500 hover:text-red-300">
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Field label="Contact name">
                        <input type="text" value={it.contact_name} onChange={e => patchItem(i, { contact_name: e.target.value })} className={inputClass} />
                      </Field>

                      {(eventType === "quote_sent" || eventType === "job_won") && (
                        <Field
                          label={eventType === "quote_sent" ? "Quote value(s)" : "Job value"}
                          hint={eventType === "quote_sent" ? "Dollars, no symbols. Tiers separated by |." : "Dollars, no symbols."}
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
                          <input type="datetime-local" value={it.appointment_at} onChange={e => patchItem(i, { appointment_at: e.target.value })} className={inputClass} />
                        </Field>
                      )}

                      {eventType === "email_sent" && (
                        <Field label="Subject">
                          <input type="text" value={it.outcome} onChange={e => patchItem(i, { outcome: e.target.value })} className={inputClass} />
                        </Field>
                      )}

                      {(eventType === "quote_sent" || eventType === "job_won" || eventType === "site_visit_booked") && (
                        <Field label="Address" hint="Optional.">
                          <input type="text" value={it.contact_address} onChange={e => patchItem(i, { contact_address: e.target.value })} className={inputClass} />
                        </Field>
                      )}

                      {(eventType === "quote_sent" || eventType === "job_won") && (
                        <Field label="Lead source" hint="Optional.">
                          <input type="text" value={it.ad_source} onChange={e => patchItem(i, { ad_source: e.target.value })} className={inputClass} placeholder="e.g. Facebook Ad Form" />
                        </Field>
                      )}

                      {eventType === "site_visit_booked" && (
                        <Field label="Comment" hint="Optional.">
                          <input type="text" value={it.outcome} onChange={e => patchItem(i, { outcome: e.target.value })} className={inputClass} />
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
            </>
          )}

          {error && (
            <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {savedCount !== null && !error && (
            <div className="rounded border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
              Saved {savedCount === 1 ? "1 activity" : `${savedCount} activities`}. It&apos;s in the reports + dashboard.
            </div>
          )}

          <div className="flex items-center justify-end border-t border-zinc-800 pt-3.5">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Log it"}
            </button>
          </div>
        </form>
    </div>
  );
}

function HistoryCard({ history }: { history: ContactHistory | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!history) {
    return (
      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[11px] text-zinc-500">
        First contact — no previous activity on record.
      </div>
    );
  }

  const bits: string[] = [];
  if (history.answered + history.didntAnswer > 0) {
    bits.push(`${history.answered} answered / ${history.didntAnswer} didn't`);
  }
  if (history.quotes > 0) {
    bits.push(`${history.quotes} quote${history.quotes > 1 ? "s" : ""}${history.quotedTotal ? ` ($${Math.round(history.quotedTotal).toLocaleString()})` : ""}`);
  }
  if (history.siteVisits > 0) bits.push(`${history.siteVisits} site visit${history.siteVisits > 1 ? "s" : ""}`);
  if (history.emails > 0) bits.push(`${history.emails} email${history.emails > 1 ? "s" : ""}`);
  if (history.jobsWon > 0) bits.push(`${history.jobsWon} job${history.jobsWon > 1 ? "s" : ""} won 🎉`);

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Previous contact · {history.total}× since {shortDate(history.firstDate)}
        </span>
        <span className="text-[11px] text-zinc-500">{expanded ? "▾ hide" : "▸ show"}</span>
      </button>

      <div className="mt-1.5 text-[12px] leading-relaxed text-zinc-300">
        Last touched {shortDate(history.lastDate)}
        {history.lastStage ? ` · ${history.lastStage}` : ""}
        {bits.length > 0 ? ` · ${bits.join(" · ")}` : ""}
      </div>

      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
          {history.recent.map((r, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-zinc-400">
              <span className="shrink-0 tabular-nums text-zinc-500">{shortDate(r.date)}</span>
              <span className="shrink-0 text-zinc-300">{r.label}</span>
              <span className="truncate">{r.detail}</span>
              {r.person && <span className="ml-auto shrink-0 text-zinc-500">{r.person}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "2026-05-18" → "18 May" (or "18 May 25" when not the current year). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const thisYear = new Date().getFullYear();
  return `${d} ${months[m - 1]}${y !== thisYear ? ` ${String(y).slice(2)}` : ""}`;
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
