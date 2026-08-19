"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CLOSER_OUTCOMES,
  closeLoop,
  emptyCall,
  emptyMoment,
  finishReview,
  loadCallReviews,
  loadLoops,
  nextTape,
  REPS,
  removeCallReview,
  saveCallReview,
  SETTER_OUTCOMES,
  STATUS_LABEL,
  type CallReview,
  type OpenLoop,
  type ReviewStatus,
  type Seat,
  type TapeMoment,
} from "@/lib/callReviews";
import { todayInTz, SYDNEY_TZ } from "@/lib/format";

type Filter = "all" | "gsop" | "todo" | "in_progress" | "reviewed" | "good" | "bad";

export function CallReviews() {
  const today = todayInTz(SYDNEY_TZ);
  const [rows, setRows] = useState<CallReview[]>([]);
  const [loops, setLoops] = useState<OpenLoop[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState(() => emptyCall(today));
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setRows(loadCallReviews(today));
    setLoops(loadLoops());
  }, [today]);

  const outcomes = draft.seat === "setter" ? SETTER_OUTCOMES : CLOSER_OUTCOMES;
  const next = nextTape(rows);
  const liveLoops = loops.filter(l => !l.closedOn);

  const stats = useMemo(() => {
    const gsop = rows.filter(r => r.lane === "gsop").length;
    const todo = rows.filter(r => r.status === "todo").length;
    const inProgress = rows.filter(r => r.status === "in_progress").length;
    const reviewed = rows.filter(r => r.status === "reviewed").length;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekIso = weekAgo.toISOString().slice(0, 10);
    const thisWeek = rows.filter(r => r.reviewedAt && r.reviewedAt.slice(0, 10) >= weekIso).length;
    return { gsop, todo, inProgress, reviewed, thisWeek, loops: liveLoops.length, total: rows.length };
  }, [rows, liveLoops.length]);

  const visible = rows.filter(r => {
    if (filter === "gsop") return r.lane === "gsop";
    if (filter === "todo") return r.status === "todo";
    if (filter === "in_progress") return r.status === "in_progress";
    if (filter === "reviewed") return r.status === "reviewed";
    if (filter === "good") return r.quality === "good";
    if (filter === "bad") return r.quality === "bad";
    return true;
  });

  const gsop = visible.filter(r => r.lane === "gsop");
  const todo = visible.filter(r => r.lane === "review" && r.status === "todo");
  const inProgress = visible.filter(r => r.lane === "review" && r.status === "in_progress");
  const done = visible.filter(r => r.lane === "review" && r.status === "reviewed");

  function pickRep(name: string) {
    const found = REPS.find(r => r.name === name);
    const seat = found?.seat ?? draft.seat;
    const nextOutcomes = seat === "setter" ? SETTER_OUTCOMES : CLOSER_OUTCOMES;
    setDraft(d => ({
      ...d,
      rep: name,
      seat,
      outcome: nextOutcomes.includes(d.outcome) ? d.outcome : nextOutcomes[0],
    }));
  }

  function pickSeat(seat: Seat) {
    const nextOutcomes = seat === "setter" ? SETTER_OUTCOMES : CLOSER_OUTCOMES;
    const rep = REPS.find(r => r.seat === seat && r.name === draft.rep)
      ? draft.rep
      : (REPS.find(r => r.seat === seat)?.name ?? draft.rep);
    setDraft(d => ({
      ...d,
      seat,
      rep,
      outcome: nextOutcomes.includes(d.outcome) ? d.outcome : nextOutcomes[0],
    }));
  }

  function assign() {
    if (draft.lead.trim().length < 2) {
      setError("Put the lead’s name in. That’s who we called.");
      return;
    }
    const now = new Date().toISOString();
    const entry: CallReview = {
      ...draft,
      lead: draft.lead.trim(),
      wentWell: draft.wentWell.trim(),
      improve: draft.improve.trim(),
      nextFocus: draft.nextFocus.trim(),
      recordingUrl: draft.recordingUrl.trim(),
      id: crypto.randomUUID(),
      createdAt: now,
      status: "todo",
      reviewedAt: null,
    };
    setRows(saveCallReview(entry));
    setDraft(emptyCall(today));
    setError("");
    setFilter(entry.lane === "gsop" ? "gsop" : "todo");
    setActiveId(entry.id);
  }

  function patch(id: string, next: Partial<CallReview>) {
    const cur = rows.find(r => r.id === id);
    if (!cur) return;
    const status = next.status ?? cur.status;
    const updated: CallReview = {
      ...cur,
      ...next,
      reviewedAt: status === "reviewed" ? (cur.reviewedAt || new Date().toISOString()) : status === "todo" ? null : cur.reviewedAt,
    };
    if (status === "reviewed" && cur.status !== "reviewed") {
      const out = finishReview(updated);
      setRows(out.reviews);
      setLoops(out.loops);
      return;
    }
    setRows(saveCallReview(updated));
  }

  function startTape(id: string) {
    patch(id, { status: "in_progress" });
    setActiveId(id);
    setFilter("in_progress");
  }

  function markFixed(loopId: string, callId: string) {
    setLoops(closeLoop(loopId, callId, today));
  }

  function remove(id: string) {
    setRows(removeCallReview(id, today));
    if (activeId === id) setActiveId(null);
  }

  const cardProps = {
    activeId,
    loops,
    onActivate: setActiveId,
    onPatch: patch,
    onStart: startTape,
    onPromote: (id: string) => { patch(id, { lane: "gsop", quality: "good" }); setFilter("gsop"); },
    onRemove: remove,
    onFixLoop: markFixed,
  };

  return (
    <div className="px-8 py-6 space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-blue-600">Quotie · call funnel</p>
          <h1 className="mt-1 text-xl font-semibold">Call reviews</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Listen back. Name where we went wrong. Write the fix. That fix follows the rep onto the next tape. Forever.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          Beta · saved in this browser
        </span>
      </header>

      <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">The loop</p>
          <p className="mt-1 text-sm text-slate-800">
            Listen → where we went wrong → what to do instead → next tape proves it.
          </p>
          {next ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-blue-700">Next tape</div>
                <div className="truncate font-medium text-slate-900">{next.lead}</div>
                <div className="text-xs text-slate-500">{next.rep} · {next.seat} · {next.on} · {next.outcome}</div>
              </div>
              <button
                type="button"
                onClick={() => startTape(next.id)}
                className="shrink-0 rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
              >
                Start this tape
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Queue is empty. Assign the next lead you called.</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Open loops · {liveLoops.length} live
          </p>
          <p className="mt-1 text-[11px] text-slate-500">A leak stays on the rep until a later tape proves it fixed.</p>
          {liveLoops.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No open leaks. Finish a review and the takeaway lands here.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {liveLoops.slice(0, 6).map(l => (
                <li key={l.id} className="text-sm">
                  <span className="font-medium text-slate-900">{l.rep}</span>
                  <span className="text-slate-500"> · {l.instead || l.leak}</span>
                  <div className="text-[11px] text-slate-500">From {l.fromLead} · {l.openedOn}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Hero label="To do" value={String(stats.todo)} hint="Not listened yet" />
        <Hero label="In review" value={String(stats.inProgress)} hint="On the tape now" />
        <Hero label="Reviewed" value={String(stats.reviewed)} hint={`${stats.thisWeek} this week`} />
        <Hero label="Open loops" value={String(stats.loops)} hint="Still to prove" />
        <Hero label="GSOP" value={String(stats.gsop)} hint="Steal these" />
        <Hero label="Tapes logged" value={String(stats.total)} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Assign a call</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Log the lead now. Notes can wait until you sit with the recording.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Lead">
            <input
              value={draft.lead}
              onChange={e => setDraft(d => ({ ...d, lead: e.target.value }))}
              placeholder="Name · company"
              className={inputClass}
            />
          </Field>
          <Field label="Rep">
            <select value={draft.rep} onChange={e => pickRep(e.target.value)} className={inputClass}>
              {REPS.map(r => (
                <option key={r.name} value={r.name}>{r.name} · {r.seat}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={draft.on}
              onChange={e => setDraft(d => ({ ...d, on: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Outcome">
            <select
              value={draft.outcome}
              onChange={e => setDraft(d => ({ ...d, outcome: e.target.value }))}
              className={inputClass}
            >
              {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-6">
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-slate-500">Seat</legend>
            <div className="mt-1.5 flex gap-2">
              <Choice on={draft.seat === "setter"} onClick={() => pickSeat("setter")}>Setter</Choice>
              <Choice on={draft.seat === "closer"} onClick={() => pickSeat("closer")}>Closer</Choice>
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-slate-500">Lane</legend>
            <div className="mt-1.5 flex gap-2">
              <Choice on={draft.lane === "review"} onClick={() => setDraft(d => ({ ...d, lane: "review" }))}>Review</Choice>
              <Choice on={draft.lane === "gsop"} onClick={() => setDraft(d => ({ ...d, lane: "gsop", quality: "good" }))}>GSOP</Choice>
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-slate-500">Call</legend>
            <div className="mt-1.5 flex gap-2">
              <Choice on={draft.quality === "good"} onClick={() => setDraft(d => ({ ...d, quality: "good" }))}>Good</Choice>
              <Choice on={draft.quality === "bad"} onClick={() => setDraft(d => ({ ...d, quality: "bad" }))}>Bad</Choice>
            </div>
          </fieldset>
        </div>

        <Field label="Recording URL (optional)">
          <input
            value={draft.recordingUrl}
            onChange={e => setDraft(d => ({ ...d, recordingUrl: e.target.value }))}
            placeholder="Close / Drive / Loom link"
            className={`${inputClass} mt-1 max-w-xl`}
          />
        </Field>

        {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}
        <div className="mt-4">
          <button
            type="button"
            onClick={assign}
            className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            Put in the loop
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 text-xs">
        {([
          ["all", `All · ${stats.total}`],
          ["todo", `To do · ${stats.todo}`],
          ["in_progress", `In review · ${stats.inProgress}`],
          ["reviewed", `Reviewed · ${stats.reviewed}`],
          ["gsop", `GSOP · ${stats.gsop}`],
          ["good", "Good"],
          ["bad", "Bad"],
        ] as [Filter, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-md border px-2 py-1 ${
              filter === id
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Lane
        title="GSOP library"
        hint="Gold standard. Steal from these. Still run the loop if you sit with the tape."
        empty="No GSOP in this filter."
        rows={gsop}
        show={filter === "all" || filter === "gsop" || ((filter === "todo" || filter === "in_progress" || filter === "reviewed" || filter === "good" || filter === "bad") && gsop.length > 0)}
        {...cardProps}
      />
      <Lane
        title="To do"
        hint="Not listened yet. This is the pile."
        empty="Nothing waiting."
        rows={todo}
        show={filter === "all" || filter === "todo" || ((filter === "good" || filter === "bad") && todo.length > 0)}
        {...cardProps}
      />
      <Lane
        title="In review"
        hint="On the tape. Mark the moments. Write the fix. Then reviewed."
        empty="Nothing in review. Hit Start this tape."
        rows={inProgress}
        show={filter === "all" || filter === "in_progress" || ((filter === "good" || filter === "bad") && inProgress.length > 0)}
        {...cardProps}
      />
      <Lane
        title="Reviewed"
        hint="The takeaway is now an open loop on that rep until the next tape proves it."
        empty="Nothing marked reviewed yet."
        rows={done}
        show={filter === "all" || filter === "reviewed" || ((filter === "good" || filter === "bad") && done.length > 0)}
        {...cardProps}
      />
    </div>
  );
}

type CardHandlers = {
  activeId: string | null;
  loops: OpenLoop[];
  onActivate: (id: string | null) => void;
  onPatch: (id: string, next: Partial<CallReview>) => void;
  onStart: (id: string) => void;
  onPromote: (id: string) => void;
  onRemove: (id: string) => void;
  onFixLoop: (loopId: string, callId: string) => void;
};

function Lane({
  title, hint, empty, rows, show, ...handlers
}: {
  title: string;
  hint: string;
  empty: string;
  rows: CallReview[];
  show: boolean;
} & CardHandlers) {
  if (!show) return null;
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
      {rows.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {empty}
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map(r => (
            <CallCard key={r.id} row={r} {...handlers} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CallCard({
  row, activeId, loops, onActivate, onPatch, onStart, onPromote, onRemove, onFixLoop,
}: { row: CallReview } & CardHandlers) {
  const gsop = row.lane === "gsop";
  const open = activeId === row.id || row.status === "in_progress";
  const [well, setWell] = useState(row.wentWell);
  const [imp, setImp] = useState(row.improve);
  const [focus, setFocus] = useState(row.nextFocus);
  const [moments, setMoments] = useState<TapeMoment[]>(row.moments);
  const repLoops = loops.filter(l => l.rep === row.rep && !l.closedOn);

  useEffect(() => { setWell(row.wentWell); }, [row.id, row.wentWell]);
  useEffect(() => { setImp(row.improve); }, [row.id, row.improve]);
  useEffect(() => { setFocus(row.nextFocus); }, [row.id, row.nextFocus]);
  useEffect(() => { setMoments(row.moments); }, [row.id, row.moments]);

  function saveNotes() {
    onPatch(row.id, {
      wentWell: well,
      improve: imp,
      nextFocus: focus,
      moments: moments.filter(m => m.at || m.wrong || m.instead),
    });
  }

  function setMoment(id: string, next: Partial<TapeMoment>) {
    setMoments(ms => ms.map(m => m.id === id ? { ...m, ...next } : m));
  }

  return (
    <li className={`rounded-lg border bg-white px-4 py-3 ${gsop ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900">{row.lead}</span>
            {gsop && <Badge tone="gold">GSOP</Badge>}
            <Badge tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</Badge>
            <Badge tone={row.quality === "good" ? "good" : "bad"}>
              {row.quality === "good" ? "Good" : "Bad"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {row.on} · {row.rep} · {row.seat} · {row.outcome}
            {row.reviewedAt ? ` · reviewed ${row.reviewedAt.slice(0, 10)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {row.status === "todo" && (
            <button type="button" onClick={() => onStart(row.id)} className={btnGhost}>
              Start tape
            </button>
          )}
          <button type="button" onClick={() => onActivate(open && row.status !== "in_progress" ? null : row.id)} className={btnGhost}>
            {open ? "Hide loop" : "Open loop"}
          </button>
          {row.lane === "review" && (
            <button type="button" onClick={() => onPromote(row.id)} className={btnGhost}>Promote to GSOP</button>
          )}
          <button type="button" onClick={() => onRemove(row.id)} className={btnGhost}>Remove</button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          {row.recordingUrl && (
            <a href={row.recordingUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
              Open recording →
            </a>
          )}

          {repLoops.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-amber-900">
                Open loops for {row.rep} — did this tape prove them?
              </div>
              <ul className="mt-2 space-y-1.5">
                {repLoops.map(l => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-slate-800">{l.instead || l.leak}</span>
                    <button
                      type="button"
                      onClick={() => onFixLoop(l.id, row.id)}
                      className={btnGhost}
                    >
                      Fixed on this tape
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Moments on the tape</p>
              <button
                type="button"
                onClick={() => setMoments(ms => [...ms, emptyMoment()])}
                className={btnGhost}
              >
                Add moment
              </button>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">Timestamp, where we went wrong, what to do instead.</p>
            {moments.length === 0 && (
              <p className="mt-2 text-sm text-slate-500">Hit add moment as you listen. One leak per line.</p>
            )}
            <ul className="mt-2 space-y-2">
              {moments.map(m => (
                <li key={m.id} className="grid gap-2 sm:grid-cols-[6rem_1fr_1fr]">
                  <input
                    value={m.at}
                    onChange={e => setMoment(m.id, { at: e.target.value })}
                    onBlur={saveNotes}
                    placeholder="3:40"
                    className={inputClass}
                  />
                  <input
                    value={m.wrong}
                    onChange={e => setMoment(m.id, { wrong: e.target.value })}
                    onBlur={saveNotes}
                    placeholder="Where we went wrong"
                    className={inputClass}
                  />
                  <input
                    value={m.instead}
                    onChange={e => setMoment(m.id, { instead: e.target.value })}
                    onBlur={saveNotes}
                    placeholder="What to do instead"
                    className={inputClass}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-slate-500">
              What we did well
              <textarea
                value={well}
                onChange={e => setWell(e.target.value)}
                onBlur={saveNotes}
                rows={3}
                placeholder="Keep this."
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-xs text-slate-500">
              Where we went wrong
              <textarea
                value={imp}
                onChange={e => setImp(e.target.value)}
                onBlur={saveNotes}
                rows={3}
                placeholder="The leak on this tape."
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <label className="block text-xs text-slate-500">
            Next time this rep must…
            <input
              value={focus}
              onChange={e => setFocus(e.target.value)}
              onBlur={saveNotes}
              placeholder="One line. This becomes their open loop until the next tape proves it."
              className={`${inputClass} mt-1`}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {(["todo", "in_progress", "reviewed"] as ReviewStatus[]).map(s => (
              <Choice key={s} on={row.status === s} onClick={() => { saveNotes(); onPatch(row.id, { status: s, wentWell: well, improve: imp, nextFocus: focus, moments }); }}>
                {STATUS_LABEL[s]}
              </Choice>
            ))}
            <span className="text-[11px] text-slate-500">
              Reviewed files the “next time” line onto {row.rep} until a later tape closes it.
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

function statusTone(status: ReviewStatus): "queue" | "gold" | "done" {
  if (status === "todo") return "queue";
  if (status === "in_progress") return "gold";
  return "done";
}

function Hero({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
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

function Badge({ tone, children }: { tone: "gold" | "queue" | "done" | "good" | "bad"; children: React.ReactNode }) {
  const cls =
    tone === "gold" ? "bg-amber-100 text-amber-900" :
    tone === "queue" ? "bg-blue-50 text-blue-700" :
    tone === "done" ? "bg-slate-100 text-slate-600" :
    tone === "good" ? "bg-emerald-50 text-emerald-700" :
    "bg-red-50 text-red-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

const btnGhost =
  "rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700";
