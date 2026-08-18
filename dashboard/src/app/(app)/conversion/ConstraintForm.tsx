"use client";

import { useEffect, useMemo, useState } from "react";
import {
  closerRates,
  emptyCloser,
  emptySetter,
  loadEntries,
  saveEntry,
  setterRates,
  type Cadence,
  type CloserInputs,
  type ConstraintEntry,
  type Seat,
  type SetterInputs,
} from "@/lib/constraintForm";
import { todayInTz, SYDNEY_TZ } from "@/lib/format";

const STEPS_EOD = [
  "Who",
  "Worked",
  "Inputs",
  "Outcomes",
  "Losses",
  "Your numbers",
  "Constraint",
  "Impact",
  "Ask",
] as const;

const STEPS_EOW = [
  "Who",
  "Worked",
  "Inputs",
  "Outcomes",
  "Losses",
  "Your numbers",
  "Constraint",
  "Impact",
  "Ask",
] as const;

export function ConstraintForm({ cadence }: { cadence: Cadence }) {
  const eow = cadence === "eow";
  const steps = eow ? STEPS_EOW : STEPS_EOD;
  const today = todayInTz(SYDNEY_TZ);
  const periodWord = eow ? "this week" : "today";
  const title = eow ? "EOW data constraints" : "EOD data constraints";

  const [step, setStep] = useState(0);
  const [seat, setSeat] = useState<Seat>("setter");
  const [name, setName] = useState(seat === "setter" ? "Benji" : "Locky");
  const [setter, setSetter] = useState<SetterInputs>(emptySetter);
  const [closer, setCloser] = useState<CloserInputs>(emptyCloser);
  const [constraint, setConstraint] = useState("");
  const [impact, setImpact] = useState("");
  const [ask, setAsk] = useState("");
  const [done, setDone] = useState<ConstraintEntry | null>(null);
  const [past, setPast] = useState<ConstraintEntry[]>([]);

  useEffect(() => {
    setPast(loadEntries(cadence));
  }, [cadence]);

  function pickSeat(next: Seat) {
    setSeat(next);
    if (name === "Benji" || name === "Locky" || name === "") {
      setName(next === "setter" ? "Benji" : "Locky");
    }
  }

  const rates = useMemo(
    () => (seat === "setter" ? setterRates(setter) : closerRates(closer)),
    [seat, setter, closer],
  );

  const last = steps.length - 1;
  const canNext = (() => {
    if (step === 0) return name.trim().length > 1;
    if (step === 6) return constraint.trim().length > 8;
    if (step === 7) return impact.trim().length > 8;
    if (step === 8) return ask.trim().length > 8;
    return true;
  })();

  function submit() {
    const entry: ConstraintEntry = {
      id: crypto.randomUUID(),
      cadence,
      seat,
      name: name.trim(),
      on: today,
      setter: seat === "setter" ? setter : undefined,
      closer: seat === "closer" ? closer : undefined,
      constraint: constraint.trim(),
      impact: impact.trim(),
      ask: ask.trim(),
      createdAt: new Date().toISOString(),
    };
    saveEntry(entry);
    setDone(entry);
    setPast(loadEntries(cadence));
  }

  function reset() {
    setStep(0);
    setSetter(emptySetter());
    setCloser(emptyCloser());
    setConstraint("");
    setImpact("");
    setAsk("");
    setDone(null);
  }

  return (
    <div className="px-8 py-6 max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-blue-600">Quotie · {eow ? "end of week" : "end of day"}</p>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          One question at a time. Enter the inputs, look at the rates, name the constraint, then ask for help.
        </p>
      </header>

      <ol className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wider">
        {steps.map((label, i) => (
          <li
            key={label}
            className={`rounded px-2 py-0.5 ${
              i === step ? "bg-blue-500 text-white" : i < step ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>

      {done ? (
        <DoneCard entry={done} periodWord={periodWord} onAgain={reset} />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {step === 0 && (
            <Question q={`Who is filling this ${eow ? "week" : "day"} in?`}>
              <p className="text-sm text-slate-500">Setter or closer. Be honest about which seat you sat in.</p>
              <div className="mt-4 flex gap-2">
                <Choice on={seat === "setter"} onClick={() => pickSeat("setter")}>Setter</Choice>
                <Choice on={seat === "closer"} onClick={() => pickSeat("closer")}>Closer</Choice>
              </div>
              <label className="mt-4 block text-sm text-slate-600">
                Your name
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </Question>
          )}

          {step === 1 && (
            <Question q={eow ? "Did you work this week?" : "Did you work today?"}>
              <p className="text-sm text-slate-500">If you were off, still submit. Off is data.</p>
              <div className="mt-4 flex gap-2">
                <Choice
                  on={seat === "setter" ? setter.worked : closer.worked}
                  onClick={() => seat === "setter" ? setSetter({ ...setter, worked: true }) : setCloser({ ...closer, worked: true })}
                >
                  Worked
                </Choice>
                <Choice
                  on={seat === "setter" ? !setter.worked : !closer.worked}
                  onClick={() => seat === "setter" ? setSetter({ ...setter, worked: false }) : setCloser({ ...closer, worked: false })}
                >
                  Off
                </Choice>
              </div>
            </Question>
          )}

          {step === 2 && (
            <Question q={eow ? "What did you put through this week?" : "What did you put through today?"}>
              <p className="text-sm text-slate-500">Raw inputs only. Do not edit them to look better.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {seat === "setter" ? (
                  <>
                    <Num label="Leads assigned" value={setter.leadsAssigned} onChange={v => setSetter({ ...setter, leadsAssigned: v })} />
                    <Num label="Contacts dialled" value={setter.dialled} onChange={v => setSetter({ ...setter, dialled: v })} />
                    <Num label="Contacts answered" value={setter.answered} onChange={v => setSetter({ ...setter, answered: v })} />
                    <Num label="Talk minutes" value={setter.talkMinutes} onChange={v => setSetter({ ...setter, talkMinutes: v })} />
                  </>
                ) : (
                  <>
                    <Num label="Slots available" value={closer.slotsAvailable} onChange={v => setCloser({ ...closer, slotsAvailable: v })} />
                    <Num label="Bookings due" value={closer.bookingsDue} onChange={v => setCloser({ ...closer, bookingsDue: v })} />
                    <Num label="Live calls sat" value={closer.liveCalls} onChange={v => setCloser({ ...closer, liveCalls: v })} />
                    <Num label="Talk minutes" value={closer.talkMinutes} onChange={v => setCloser({ ...closer, talkMinutes: v })} />
                  </>
                )}
              </div>
            </Question>
          )}

          {step === 3 && (
            <Question q={eow ? "What came out of those inputs this week?" : "What came out of those inputs today?"}>
              <p className="text-sm text-slate-500">
                {seat === "setter"
                  ? "Conversation = connected call over 120 seconds. Manual = you booked them. Direct = they picked a time."
                  : "Offers and units, not vibes. Deposit is cash with no access. Unit is access given."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {seat === "setter" ? (
                  <>
                    <Num label="Conversations (>120s)" value={setter.conversations} onChange={v => setSetter({ ...setter, conversations: v })} />
                    <Num label="Qualified answers" value={setter.qualified} onChange={v => setSetter({ ...setter, qualified: v })} />
                    <Num label="Booked · manual" value={setter.bookedManual} onChange={v => setSetter({ ...setter, bookedManual: v })} />
                    <Num label="Booked · direct" value={setter.bookedDirect} onChange={v => setSetter({ ...setter, bookedDirect: v })} />
                  </>
                ) : (
                  <>
                    <Num label="Offers made" value={closer.offers} onChange={v => setCloser({ ...closer, offers: v })} />
                    <Num label="Units sold (access)" value={closer.units} onChange={v => setCloser({ ...closer, units: v })} />
                    <Num label="Deposits (no access)" value={closer.deposits} onChange={v => setCloser({ ...closer, deposits: v })} />
                    <Num label="Cash collected $" value={closer.cashCollected} onChange={v => setCloser({ ...closer, cashCollected: v })} />
                  </>
                )}
              </div>
            </Question>
          )}

          {step === 4 && seat === "setter" && (
            <Question q="Where did leads go that did not book?">
              <p className="text-sm text-slate-500">DQ, invalid, and lost are different. Do not dump them in one bucket.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Num label="Disqualified" value={setter.dq} onChange={v => setSetter({ ...setter, dq: v })} />
                <Num label="Invalid" value={setter.invalid} onChange={v => setSetter({ ...setter, invalid: v })} />
                <Num label="Lost" value={setter.lost} onChange={v => setSetter({ ...setter, lost: v })} />
              </div>
            </Question>
          )}
          {step === 4 && seat === "closer" && (
            <Question q="If a booking did not sit, what happened?">
              <p className="text-sm text-slate-500">These should explain the gap between bookings due and live calls.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Num label="No-shows" value={closer.noShows} onChange={v => setCloser({ ...closer, noShows: v })} />
                <Num label="Reschedules" value={closer.reschedules} onChange={v => setCloser({ ...closer, reschedules: v })} />
                <Num label="Cancels" value={closer.cancels} onChange={v => setCloser({ ...closer, cancels: v })} />
              </div>
            </Question>
          )}

          {step === 5 && (
            <Question q={`Here is what ${periodWord} actually says.`}>
              <p className="text-sm text-slate-500">
                Do not skip this. Look at the rates before you name a constraint. If a number looks wrong, go back.
              </p>
              <dl className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                {rates.map(r => (
                  <div key={r.label} className="flex justify-between px-3 py-2 text-sm">
                    <dt className="text-slate-500">{r.label}</dt>
                    <dd className="tabular-nums font-semibold text-slate-900">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </Question>
          )}

          {step === 6 && (
            <Question q={`What is the #1 constraint ${periodWord} that, if you fixed it, would have the biggest impact?`}>
              <p className="text-sm text-slate-500">
                One thing. Not three. Write it in your own words — the rate is a clue, not the answer.
              </p>
              <textarea
                value={constraint}
                onChange={e => setConstraint(e.target.value)}
                rows={4}
                placeholder="e.g. People answer but I am not getting them into a real conversation, so bookings stay low even when dials are high."
                className="mt-4 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Question>
          )}

          {step === 7 && (
            <Question q="If that constraint moved tomorrow, what would change?">
              <p className="text-sm text-slate-500">Be specific. More bookings, more shows, more cash — say which, and why.</p>
              <textarea
                value={impact}
                onChange={e => setImpact(e.target.value)}
                rows={4}
                className="mt-4 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Question>
          )}

          {step === 8 && (
            <Question q="What is the biggest thing Benji or Locky can do for you to achieve your personal and professional goals?">
              <p className="text-sm text-slate-500">
                Ask for something real. Coaching, more leads, a script change, calendar help — not “keep doing a good job”.
              </p>
              <textarea
                value={ask}
                onChange={e => setAsk(e.target.value)}
                rows={4}
                className="mt-4 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Question>
          )}

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
            >
              Back
            </button>
            {step < last ? (
              <button
                type="button"
                onClick={() => canNext && setStep(s => s + 1)}
                disabled={!canNext}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canNext}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                Save {eow ? "week" : "day"}
              </button>
            )}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Previous {eow ? "weeks" : "days"}</h2>
          <ul className="mt-3 space-y-2">
            {past.slice(0, 6).map(e => (
              <li key={e.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{e.name} · {e.seat}</span>
                  <span className="text-xs text-slate-500">{e.on}</span>
                </div>
                <p className="mt-1 text-slate-700">{e.constraint}</p>
                <p className="mt-1 text-xs text-slate-500">Ask: {e.ask}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{q}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm ${
        on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-300"
      }`}
    >
      {children}
    </button>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-slate-600">
      {label}
      <input
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function DoneCard({
  entry,
  periodWord,
  onAgain,
}: {
  entry: ConstraintEntry;
  periodWord: string;
  onAgain: () => void;
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
      <h2 className="text-lg font-semibold text-slate-900">Saved. That is {periodWord} locked in.</h2>
      <p className="mt-2 text-sm text-slate-700">
        Constraint: <span className="font-medium">{entry.constraint}</span>
      </p>
      <p className="mt-2 text-sm text-slate-700">Ask for Benji / Locky: {entry.ask}</p>
      <button type="button" onClick={onAgain} className="mt-4 text-sm text-blue-600 hover:underline">
        Fill another
      </button>
    </div>
  );
}
