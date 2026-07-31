"use client";

// The GHL popup form (served inside the EOD Logger extension panel).
// Layout: Details (company / contact / prior history) → New Submission.
// The primary flow is the EOD call log — the same five fields as the GHL
// custom fields (Stage / Answered? / Standard Outcome / Custom Outcome /
// Contact Source), submitted as one eod_update with the outcome joined
// " | "-style so it's byte-identical to what the /webhook/ghl/eod path
// produces.
//
// Popup types are intentionally human-only: EOD update, Job won, Site visit.
// Quote sent / Email sent are automated (Quotie webhook + Gmail/Outlook OAuth sync)
// and stay available for backfill from the dashboard Activities drawer only.

import { useEffect, useState, useTransition } from "react";
import type { NewActivityItem } from "@/lib/manualActivities";
import type { ContactHistory, EodOptions, PendingSiteVisit } from "./data";
import {
  completePendingSiteVisit,
  submitEodEntry,
  type EodEntryInput,
} from "./actions";

const EVENT_TYPES = [
  { value: "eod_update",        label: "EOD update" },
  { value: "job_won",           label: "Job won" },
  { value: "site_visit_booked", label: "Site visit booking" },
] as const;

type EventType = (typeof EVENT_TYPES)[number]["value"];

type Item = {
  contact_name: string;
  contact_id: string;
  contact_address: string;
  outcome: string;
  ad_source: string;
  quote_job_value: string;
  appointment_at: string;
  quote_number: string;
  split_commission: boolean;
  half_commission_charge: boolean;
};

const emptyItem = (
  contactName = "",
  contactAddress = "",
  adSource = "",
  contactId = "",
): Item => ({
  contact_name: contactName,
  contact_id: contactId,
  contact_address: contactAddress,
  outcome: "",
  ad_source: adSource,
  quote_job_value: "",
  appointment_at: "",
  quote_number: "",
  split_commission: false,
  half_commission_charge: false,
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
  contactAddress = "",
  defaultLeadSource = "",
  options = FALLBACK_OPTIONS,
  history = null,
  pendingSiteVisits = [],
}: {
  token: string;
  ghlLocationId?: string;
  companyName: string;
  people: string[];
  defaultDate: string;
  contactName?: string;
  contactId?: string;
  /** Prefill from GHL Street Address (or last logged address). */
  contactAddress?: string;
  /** Prefill from most recent EOD 5 / contact source for this contact. */
  defaultLeadSource?: string;
  options?: EodOptions;
  history?: ContactHistory | null;
  pendingSiteVisits?: PendingSiteVisit[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [pipelineNote, setPipelineNote] = useState<string | null>(null);
  const [pipelineOk, setPipelineOk] = useState<boolean>(false);
  const [openPendings, setOpenPendings] = useState<PendingSiteVisit[]>(pendingSiteVisits);
  const [activePending, setActivePending] = useState<PendingSiteVisit | null>(null);
  const [svRough, setSvRough] = useState("");
  const [svIdealStart, setSvIdealStart] = useState("");
  const [svComment, setSvComment] = useState("");

  const [salesPerson, setSalesPerson] = useState(people[0] ?? "");

  // Each exec's browser remembers who they are: pick your name once and every
  // popup on this device defaults to you, across all clients (as long as
  // you're on that client's roster). Read after hydration — localStorage
  // isn't available during SSR.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("eod-exec");
      if (stored && people.includes(stored)) setSalesPerson(stored); // eslint-disable-line react-hooks/set-state-in-effect
    } catch { /* storage unavailable (rare iframe modes) — keep default */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open the site-visit log form when this contact has a pending booking.
  useEffect(() => {
    if (activePending || openPendings.length === 0) return;
    const match = contactId
      ? openPendings.find(p => p.contactId && p.contactId === contactId)
      : null;
    const first = match || (openPendings.length === 1 ? openPendings[0] : null);
    if (first) applyPending(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, openPendings.length]);

  function chooseSalesPerson(name: string) {
    setSalesPerson(name);
    try {
      if (name) localStorage.setItem("eod-exec", name);
    } catch { /* ignore */ }
  }
  const [date, setDate] = useState(defaultDate);
  const [eventType, setEventType] = useState<EventType>("eod_update");

  // EOD call-log fields (the five GHL custom fields).
  const [eodName, setEodName] = useState(contactName);
  const [stage, setStage] = useState(history?.lastStage || options.stages[0] || "");
  const [answered, setAnswered] = useState("");
  const [stdOutcome, setStdOutcome] = useState("");
  const [customOutcome, setCustomOutcome] = useState("");
  const [source, setSource] = useState(defaultLeadSource || history?.topSource || "");

  // Multi-row items for the non-EOD event types. Address + lead source are
  // prefilled from GHL Street Address / EOD 5 when available.
  const [items, setItems] = useState<Item[]>([
    emptyItem(contactName, contactAddress, defaultLeadSource, contactId),
  ]);

  function patchItem(i: number, patch: Partial<Item>) {
    setItems(list => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems(list => [...list, emptyItem(contactName, contactAddress, defaultLeadSource, contactId)]);
  }
  function removeItem(i: number) { setItems(list => list.filter((_, idx) => idx !== i)); }

  function applyPending(p: PendingSiteVisit) {
    setActivePending(p);
    if (p.salesPersonName && people.includes(p.salesPersonName)) {
      chooseSalesPerson(p.salesPersonName);
    } else if (p.salesPersonName) {
      setSalesPerson(p.salesPersonName);
    }
    setSvRough(p.roughJobValue || "");
    setSvIdealStart("");
    setSvComment("");
    setError(null);
    setSavedCount(null);
    setPipelineNote(null);
  }

  function cancelPendingLog() {
    setActivePending(null);
    setSvRough("");
    setSvIdealStart("");
    setSvComment("");
  }

  function submitPendingSiteVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!activePending) return;
    setError(null);
    setSavedCount(null);
    setPipelineNote(null);
    setPipelineOk(false);

    if (activePending.vertical === "roofing") {
      if (!svRough.trim()) {
        setError("Rough job value is required for roofing site visits");
        return;
      }
    }

    startTransition(async () => {
      const res = await completePendingSiteVisit({
        token,
        ghl_location_id: ghlLocationId,
        pending_id: activePending.id,
        sales_person: salesPerson,
        occurred_on: activePending.bookedOn || defaultDate,
        contact_name: activePending.contactName,
        contact_id: activePending.contactId,
        contact_phone: activePending.contactPhone,
        contact_email: activePending.contactEmail,
        contact_address: activePending.contactAddress,
        appointment_display: activePending.appointmentDisplay || activePending.appointmentRaw,
        appointment_at: activePending.appointmentLocal,
        booked_on: activePending.bookedOn || defaultDate,
        vertical: activePending.vertical,
        rough_job_value: svRough,
        ideal_start_date: svIdealStart,
        details_comment: svComment,
        previous_quotes: activePending.previousQuotes,
      });
      if (!res.ok) { setError(res.error); return; }
      setSavedCount(res.count);
      setPipelineNote(res.pipeline ?? null);
      setPipelineOk(res.pipelineOk ?? false);
      setOpenPendings(list => list.filter(x => x.id !== activePending.id));
      setActivePending(null);
      setSvRough("");
      setSvIdealStart("");
      setSvComment("");
    });
  }

  function submit(payloadItems: NewActivityItem[], evType: EventType) {
    const input: EodEntryInput = {
      token,
      ghl_location_id: ghlLocationId,
      sales_person: salesPerson,
      occurred_on: date,
      event_type: evType,
      items: payloadItems,
      eod_fields:
        evType === "eod_update"
          ? { stage, answered, std_outcome: stdOutcome }
          : undefined,
    };
    startTransition(async () => {
      const res = await submitEodEntry(input);
      if (!res.ok) { setError(res.error); return; }
      setSavedCount(res.count);
      setPipelineNote(res.pipeline ?? null);
      setPipelineOk(res.pipelineOk ?? false);
      if (evType === "eod_update") {
        // Keep stage + source (same contact, likely same context next time);
        // clear the per-call outcomes.
        setAnswered("");
        setStdOutcome("");
        setCustomOutcome("");
      } else {
        setItems([emptyItem(contactName, contactAddress, defaultLeadSource, contactId)]);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedCount(null);
    setPipelineNote(null);
    setPipelineOk(false);

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

    if (eventType === "job_won") {
      for (const it of items) {
        if (!it.quote_job_value.trim()) {
          setError("Job value is required (incl. GST)");
          return;
        }
        if (!it.quote_number.trim()) {
          setError("Quote number is required — it goes on the commission sheet");
          return;
        }
      }
    }

    const payloadItems: NewActivityItem[] = items.map(it => ({
      ...it,
      contact_id:
        it.contact_id?.trim() ||
        (contactId && it.contact_name.trim() === contactName.trim() ? contactId : ""),
    }));
    submit(payloadItems, eventType);
  }

  const rowLabel = eventType === "job_won" ? "Job"
    : eventType === "site_visit_booked" ? "Site visit"
    : "Entry";

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

        {openPendings.length > 0 && !activePending && (
          <PendingVisitsBanner
            pendings={openPendings}
            contactId={contactId}
            activeId={null}
            onLog={applyPending}
          />
        )}

        {activePending && (
          <form className="mb-4 space-y-3.5 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3" onSubmit={submitPendingSiteVisit}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-amber-300/90">
                Log site visit · {activePending.vertical === "roofing" ? "Roofing" : "Solar"}
              </div>
              <button type="button" onClick={cancelPendingLog} className="text-[11px] text-zinc-500 hover:text-zinc-300">
                Cancel
              </button>
            </div>

            <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[12px] text-zinc-300">
              <AutoRow label="Lead" value={activePending.contactName || "—"} />
              <AutoRow label="Phone" value={activePending.contactPhone || "—"} />
              <AutoRow label="Email" value={activePending.contactEmail || "—"} />
              <AutoRow label="Location" value={activePending.contactAddress || "—"} />
              <AutoRow
                label="Visit time"
                value={activePending.appointmentDisplay || activePending.appointmentRaw || "—"}
              />
              <AutoRow label="Booked on" value={activePending.bookedOn || "—"} />
            </div>

            <Field label="Sales person">
              <select value={salesPerson} onChange={e => chooseSalesPerson(e.target.value)} className={inputClass}>
                {people.map(p => <option key={p} value={p}>{p}</option>)}
                {salesPerson && !people.includes(salesPerson) && (
                  <option value={salesPerson}>{salesPerson}</option>
                )}
                <option value="">— team —</option>
              </select>
            </Field>

            {/* Previous quotes — always shown (roofing + solar) */}
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Previous quotes
              </div>
              {activePending.previousQuotes.length === 0 ? (
                <p className="mt-1 text-[12px] text-zinc-500">
                  No previous quote has been sent.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {activePending.previousQuotes.map((q, i) => (
                    <li key={i} className="text-[12px] text-zinc-300">
                      ${String(q.value).replace(/[$,]/g, "")}
                      {q.date ? ` · ${q.date}` : ""}
                      {q.person ? ` · ${q.person}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {activePending.vertical === "roofing" ? (
              <>
                <Field label="Rough job value (incl. GST)" hint="Required — dollars, no symbols.">
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={svRough}
                    onChange={e => setSvRough(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. 12000"
                  />
                </Field>
                <Field label="Ideal start date">
                  <input
                    type="date"
                    value={svIdealStart}
                    onChange={e => setSvIdealStart(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Details / comment" hint="Single line.">
                  <input
                    type="text"
                    value={svComment}
                    onChange={e => setSvComment(e.target.value)}
                    className={inputClass}
                    placeholder="Anything the crew should know"
                  />
                </Field>
              </>
            ) : (
              <Field label="Comment" hint="Optional — notes for the Slack summary.">
                <input
                  type="text"
                  value={svComment}
                  onChange={e => setSvComment(e.target.value)}
                  className={inputClass}
                  placeholder="Anything worth noting"
                />
              </Field>
            )}

            {error && (
              <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Log site visit → Slack"}
            </button>
          </form>
        )}

        {/* ── New Submission ─────────────────────────────────────── */}
        <form className="space-y-3.5" onSubmit={handleSubmit}>
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            New submission
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sales person">
              <select value={salesPerson} onChange={e => chooseSalesPerson(e.target.value)} className={inputClass}>
                {people.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="">— team —</option>
              </select>
            </Field>
            <Field label="Date">
              <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <Field label="Type">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
              {EVENT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={eventType === t.value}
                  onClick={() => setEventType(t.value)}
                  className={
                    eventType === t.value
                      ? "rounded border border-emerald-600 bg-emerald-600/20 px-2 py-2 text-center text-xs font-medium text-emerald-300 sm:text-sm"
                      : "rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-center text-xs text-zinc-400 hover:border-zinc-600 sm:text-sm"
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
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

                      {eventType === "job_won" && (
                        <>
                          <Field
                            label="Job value (incl. GST)"
                            hint="Dollars, no symbols. Used for commission calc."
                          >
                            <input
                              type="text"
                              inputMode="decimal"
                              value={it.quote_job_value}
                              onChange={e => patchItem(i, { quote_job_value: e.target.value })}
                              className={inputClass}
                              placeholder="e.g. 12000"
                            />
                          </Field>
                          <Field
                            label="Quote number"
                            hint="Required for the commission / WHMCS description."
                          >
                            <input
                              type="text"
                              value={it.quote_number}
                              onChange={e => patchItem(i, { quote_number: e.target.value })}
                              className={inputClass}
                              placeholder="e.g. 4521"
                            />
                          </Field>
                          <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                            <label className="flex items-start gap-2 text-xs text-zinc-300">
                              <input
                                type="checkbox"
                                checked={it.half_commission_charge}
                                onChange={e => patchItem(i, { half_commission_charge: e.target.checked })}
                                className="mt-0.5 rounded border-zinc-600 bg-zinc-900"
                              />
                              <span>
                                <span className="font-medium text-zinc-200">50% commission charge</span>
                                <span className="mt-0.5 block text-[11px] text-zinc-500">
                                  Full schedule on job value, then charge half (no salesman / Quotie process win).
                                </span>
                              </span>
                            </label>
                            <label className="flex items-start gap-2 text-xs text-zinc-300">
                              <input
                                type="checkbox"
                                checked={it.split_commission}
                                onChange={e => patchItem(i, { split_commission: e.target.checked })}
                                className="mt-0.5 rounded border-zinc-600 bg-zinc-900"
                              />
                              <span>
                                <span className="font-medium text-zinc-200">50/50 exec split</span>
                                <span className="mt-0.5 block text-[11px] text-zinc-500">
                                  Split SE share with the other exec on this client. Can combine with 50% charge.
                                </span>
                              </span>
                            </label>
                          </div>
                          <Field
                            label="Address"
                            hint={contactAddress ? "Prefill from GHL Street Address — edit if needed." : "Optional. Prefills from GHL when available."}
                          >
                            <input type="text" value={it.contact_address} onChange={e => patchItem(i, { contact_address: e.target.value })} className={inputClass} />
                          </Field>
                          <Field
                            label="Lead source"
                            hint={defaultLeadSource ? "Prefill from EOD 5 — edit if needed." : "Optional. Prefills from EOD 5 when logged."}
                          >
                            <input type="text" value={it.ad_source} onChange={e => patchItem(i, { ad_source: e.target.value })} className={inputClass} placeholder="e.g. Facebook Ad Form" />
                          </Field>
                        </>
                      )}

                      {eventType === "site_visit_booked" && (
                        <>
                          <Field label="Appointment date/time">
                            <input type="datetime-local" value={it.appointment_at} onChange={e => patchItem(i, { appointment_at: e.target.value })} className={inputClass} />
                          </Field>
                          <Field
                            label="Address"
                            hint={contactAddress ? "Prefill from GHL Street Address — edit if needed." : "Optional. Prefills from GHL when available."}
                          >
                            <input type="text" value={it.contact_address} onChange={e => patchItem(i, { contact_address: e.target.value })} className={inputClass} />
                          </Field>
                          <Field label="Comment" hint="Optional.">
                            <input type="text" value={it.outcome} onChange={e => patchItem(i, { outcome: e.target.value })} className={inputClass} />
                          </Field>
                        </>
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
              {pipelineNote && pipelineOk && (
                <span className="mt-0.5 block text-emerald-400">Pipeline: {pipelineNote} ✓</span>
              )}
              {pipelineNote && !pipelineOk && (
                <span className="mt-0.5 block text-amber-300/90">Pipeline not moved: {pipelineNote}</span>
              )}
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

function AutoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="min-w-0 break-words text-zinc-200">{value}</span>
    </div>
  );
}

function PendingVisitsBanner({
  pendings,
  contactId,
  activeId,
  onLog,
}: {
  pendings: PendingSiteVisit[];
  contactId: string;
  activeId: string | null;
  onLog: (p: PendingSiteVisit) => void;
}) {
  // Prefer the contact we're looking at, then newest.
  const ordered = [...pendings].sort((a, b) => {
    const aMatch = contactId && a.contactId === contactId ? 0 : 1;
    const bMatch = contactId && b.contactId === contactId ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  return (
    <div className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-amber-300/90">
        {pendings.length === 1
          ? "1 site visit waiting for details"
          : `${pendings.length} site visits waiting for details`}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
        Booked in GHL — confirm auto fields, add {pendings[0]?.vertical === "roofing" ? "rough value / start / notes" : "comment"}, then Log to Slack.
      </p>
      <ul className="mt-2 space-y-2">
        {ordered.map(p => {
          const isActive = activeId === p.id;
          const forThisContact = contactId && p.contactId === contactId;
          return (
            <li
              key={p.id}
              className={
                isActive
                  ? "rounded border border-amber-600/70 bg-amber-900/30 px-2.5 py-2"
                  : "rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-2"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">
                    {p.contactName || "Unknown contact"}
                    {forThisContact && (
                      <span className="ml-1.5 text-[10px] font-normal text-sky-400">this contact</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    {p.appointmentDisplay || p.appointmentRaw || "Time TBC"}
                    {p.salesPersonName ? ` · ${p.salesPersonName}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onLog(p)}
                  className="shrink-0 rounded border border-amber-700/60 bg-amber-900/40 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:border-amber-500"
                >
                  Log details
                </button>
              </div>
            </li>
          );
        })}
      </ul>
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
