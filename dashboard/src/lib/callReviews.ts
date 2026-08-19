// Call-review loop: listen → name the leak → write the fix → next tape proves it.
// Beta stores this in localStorage until Close recordings land.

export type Seat = "setter" | "closer";
export type CallLane = "gsop" | "review";
export type CallQuality = "good" | "bad";
export type ReviewStatus = "todo" | "in_progress" | "reviewed";

export type TapeMoment = {
  id: string;
  at: string;
  wrong: string;
  instead: string;
};

export type OpenLoop = {
  id: string;
  rep: string;
  leak: string;
  instead: string;
  fromCallId: string;
  fromLead: string;
  openedOn: string;
  closedOn: string | null;
  closedCallId: string | null;
};

export type CallReview = {
  id: string;
  lead: string;
  rep: string;
  seat: Seat;
  on: string;
  lane: CallLane;
  quality: CallQuality;
  outcome: string;
  status: ReviewStatus;
  wentWell: string;
  improve: string;
  nextFocus: string;
  moments: TapeMoment[];
  recordingUrl: string;
  createdAt: string;
  reviewedAt: string | null;
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  todo: "To do",
  in_progress: "In review",
  reviewed: "Reviewed",
};

export const REPS: { name: string; seat: Seat }[] = [
  { name: "Benji", seat: "setter" },
  { name: "Sam Kelly", seat: "setter" },
  { name: "Jordan Lee", seat: "setter" },
  { name: "Priya Nair", seat: "setter" },
  { name: "Locky", seat: "closer" },
  { name: "Chris Walsh", seat: "closer" },
  { name: "Alex Hart", seat: "closer" },
];

export const SETTER_OUTCOMES = [
  "Booked · manual",
  "Booked · direct",
  "Conversation (>120s)",
  "Qualified",
  "Disqualified",
  "Lost",
  "Invalid",
];

export const CLOSER_OUTCOMES = [
  "Closed · unit",
  "Deposit",
  "PIF",
  "Live · not closed",
  "No-show",
  "Reschedule",
  "Cancel",
];

const KEY = "tsd-call-reviews";
const LOOP_KEY = "tsd-call-loops";
const SEEDED = "tsd-call-reviews-seeded";
const LOOPS_SEEDED = "tsd-call-loops-seeded";

export function emptyMoment(): TapeMoment {
  return { id: crypto.randomUUID(), at: "", wrong: "", instead: "" };
}

function seed(today: string): { reviews: CallReview[]; loops: OpenLoop[] } {
  const day = (offset: number) => {
    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - offset));
    return dt.toISOString().slice(0, 10);
  };
  const reviews: CallReview[] = [
    {
      id: "seed-gsop-1",
      lead: "Marcus Hale · Hale Plumbing",
      rep: "Locky",
      seat: "closer",
      on: day(1),
      lane: "gsop",
      quality: "good",
      outcome: "Closed · unit",
      status: "reviewed",
      wentWell: "Full GSOP. Frame → pain → math → close. Collected 80% on the call.",
      improve: "",
      nextFocus: "Keep running this exact close. Play it for the floor.",
      moments: [
        { id: "m1", at: "4:10", wrong: "", instead: "Math on the whiteboard before the ask. That's the move." },
        { id: "m2", at: "11:40", wrong: "", instead: "Assumed the close. Didn't flinch. Collected 80%." },
      ],
      recordingUrl: "",
      createdAt: `${day(1)}T04:12:00.000Z`,
      reviewedAt: `${day(1)}T06:40:00.000Z`,
    },
    {
      id: "seed-gsop-2",
      lead: "Dana Ng · Ng Electrical",
      rep: "Benji",
      seat: "setter",
      on: day(2),
      lane: "gsop",
      quality: "good",
      outcome: "Booked · manual",
      status: "reviewed",
      wentWell: "Qualified in 4 minutes, stacked the closer, booked same-week.",
      improve: "",
      nextFocus: "This is the setter GSOP. Steal the stack.",
      moments: [
        { id: "m3", at: "2:00", wrong: "", instead: "Pain in one question. No fluff." },
        { id: "m4", at: "6:20", wrong: "", instead: "Asked for the time. Didn't wait to be liked." },
      ],
      recordingUrl: "",
      createdAt: `${day(2)}T01:08:00.000Z`,
      reviewedAt: `${day(2)}T03:20:00.000Z`,
    },
    {
      id: "seed-q-1",
      lead: "Tom Rudd · Rudd Roofing",
      rep: "Chris Walsh",
      seat: "closer",
      on: day(0),
      lane: "review",
      quality: "bad",
      outcome: "No-show",
      status: "todo",
      wentWell: "Tone on the voicemail was calm.",
      improve: "Show-lock was skipped the night before.",
      nextFocus: "Every booking gets a night-before confirm. No exceptions.",
      moments: [],
      recordingUrl: "",
      createdAt: `${day(0)}T00:30:00.000Z`,
      reviewedAt: null,
    },
    {
      id: "seed-q-2",
      lead: "Aisha Khan · Khan Interiors",
      rep: "Priya Nair",
      seat: "setter",
      on: day(0),
      lane: "review",
      quality: "good",
      outcome: "Conversation (>120s)",
      status: "todo",
      wentWell: "Great energy. Built pain fast. Lead was in.",
      improve: "Didn't ask for the booking.",
      nextFocus: "Last 30 seconds: ask for the time.",
      moments: [],
      recordingUrl: "",
      createdAt: `${day(0)}T02:15:00.000Z`,
      reviewedAt: null,
    },
    {
      id: "seed-r-1",
      lead: "Joel Patto · Patto Solar",
      rep: "Sam Kelly",
      seat: "setter",
      on: day(3),
      lane: "review",
      quality: "good",
      outcome: "Booked · direct",
      status: "reviewed",
      wentWell: "Clean set. Lead picked a time without being pushed.",
      improve: "Skipped the recap.",
      nextFocus: "Recap the pain in one sentence before you send the calendar.",
      moments: [
        { id: "m5", at: "8:00", wrong: "Jumped to the calendar.", instead: "Recap: 'so the leak is X, the cost is Y, next step is a closer.' Then book." },
      ],
      recordingUrl: "",
      createdAt: `${day(3)}T05:00:00.000Z`,
      reviewedAt: `${day(2)}T08:10:00.000Z`,
    },
  ];
  const loops: OpenLoop[] = [
    {
      id: "loop-sam",
      rep: "Sam Kelly",
      leak: "Skipped the recap.",
      instead: "Recap the pain in one sentence before you send the calendar.",
      fromCallId: "seed-r-1",
      fromLead: "Joel Patto · Patto Solar",
      openedOn: day(2),
      closedOn: null,
      closedCallId: null,
    },
  ];
  return { reviews, loops };
}

function normalizeMoment(raw: Partial<TapeMoment>): TapeMoment {
  return {
    id: raw.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())),
    at: raw.at || "",
    wrong: raw.wrong || "",
    instead: raw.instead || "",
  };
}

function normalize(raw: Partial<CallReview> & { notes?: string; status?: string }): CallReview {
  const oldNotes = typeof raw.notes === "string" ? raw.notes : "";
  const quality: CallQuality = raw.quality === "bad" ? "bad" : "good";
  const status: ReviewStatus =
    raw.status === "reviewed" ? "reviewed" :
    raw.status === "in_progress" ? "in_progress" :
    "todo";
  const wentWell = (raw.wentWell ?? (quality === "good" ? oldNotes : "")).trim();
  const improve = (raw.improve ?? (quality === "bad" ? oldNotes : wentWell ? "" : oldNotes)).trim();
  const moments = Array.isArray(raw.moments) ? raw.moments.map(normalizeMoment) : [];
  return {
    id: raw.id || crypto.randomUUID(),
    lead: raw.lead || "—",
    rep: raw.rep || "Benji",
    seat: raw.seat === "closer" ? "closer" : "setter",
    on: raw.on || "",
    lane: raw.lane === "gsop" ? "gsop" : "review",
    quality,
    outcome: raw.outcome || "",
    status,
    wentWell,
    improve,
    nextFocus: (raw.nextFocus || "").trim(),
    moments,
    recordingUrl: raw.recordingUrl || "",
    createdAt: raw.createdAt || new Date().toISOString(),
    reviewedAt: raw.reviewedAt ?? (status === "reviewed" ? raw.createdAt || null : null),
  };
}

function normalizeLoop(raw: Partial<OpenLoop>): OpenLoop {
  return {
    id: raw.id || crypto.randomUUID(),
    rep: raw.rep || "",
    leak: raw.leak || "",
    instead: raw.instead || "",
    fromCallId: raw.fromCallId || "",
    fromLead: raw.fromLead || "",
    openedOn: raw.openedOn || "",
    closedOn: raw.closedOn ?? null,
    closedCallId: raw.closedCallId ?? null,
  };
}

function readReviews(): CallReview[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    return parsed.map(row => normalize(row as Partial<CallReview> & { notes?: string }));
  } catch {
    return [];
  }
}

function writeReviews(rows: CallReview[]) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 200)));
}

function readLoops(): OpenLoop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOOP_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    return parsed.map(row => normalizeLoop(row as Partial<OpenLoop>));
  } catch {
    return [];
  }
}

function writeLoops(rows: OpenLoop[]) {
  localStorage.setItem(LOOP_KEY, JSON.stringify(rows.slice(0, 200)));
}

const STATUS_RANK: Record<ReviewStatus, number> = { todo: 0, in_progress: 1, reviewed: 2 };

export function loadCallReviews(today: string): CallReview[] {
  if (typeof window === "undefined") return [];
  try {
    if (!localStorage.getItem(SEEDED)) {
      const seeded = seed(today);
      writeReviews(seeded.reviews);
      writeLoops(seeded.loops);
      localStorage.setItem(SEEDED, "1");
      localStorage.setItem(LOOPS_SEEDED, "1");
    } else if (!localStorage.getItem(LOOPS_SEEDED)) {
      const fromReviews = readReviews()
        .filter(r => r.status === "reviewed" && (r.nextFocus || r.improve))
        .map(r => loopFromReview(r));
      writeLoops(fromReviews);
      localStorage.setItem(LOOPS_SEEDED, "1");
    }
    return readReviews().sort((a, b) => {
      if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      return b.on.localeCompare(a.on) || b.createdAt.localeCompare(a.createdAt);
    });
  } catch {
    return [];
  }
}

export function loadLoops(): OpenLoop[] {
  if (typeof window === "undefined") return [];
  return readLoops().sort((a, b) => {
    if (!!a.closedOn !== !!b.closedOn) return a.closedOn ? 1 : -1;
    return b.openedOn.localeCompare(a.openedOn);
  });
}

export function openLoopsFor(rep: string): OpenLoop[] {
  return loadLoops().filter(l => l.rep === rep && !l.closedOn);
}

function loopFromReview(r: CallReview): OpenLoop {
  const first = r.moments.find(m => m.wrong || m.instead);
  return {
    id: crypto.randomUUID(),
    rep: r.rep,
    leak: (r.improve || first?.wrong || "Leak on this tape").trim(),
    instead: (r.nextFocus || first?.instead || "").trim(),
    fromCallId: r.id,
    fromLead: r.lead,
    openedOn: (r.reviewedAt || r.on).slice(0, 10),
    closedOn: null,
    closedCallId: null,
  };
}

export function saveCallReview(entry: CallReview): CallReview[] {
  const all = readReviews().filter(r => r.id !== entry.id);
  all.unshift(normalize(entry));
  writeReviews(all);
  return loadCallReviews(entry.on);
}

export function finishReview(entry: CallReview): { reviews: CallReview[]; loops: OpenLoop[] } {
  const now = new Date().toISOString();
  const reviewed = normalize({
    ...entry,
    status: "reviewed",
    reviewedAt: entry.reviewedAt || now,
  });
  const reviews = saveCallReview(reviewed);
  const takeaway = (reviewed.nextFocus || reviewed.improve || "").trim();
  if (takeaway) {
    const loops = readLoops();
    const already = loops.some(l => !l.closedOn && l.rep === reviewed.rep && l.instead === takeaway);
    if (!already) {
      loops.unshift(loopFromReview(reviewed));
      writeLoops(loops);
    }
  }
  return { reviews, loops: loadLoops() };
}

export function closeLoop(id: string, callId: string, on: string): OpenLoop[] {
  const loops = readLoops().map(l =>
    l.id === id ? { ...l, closedOn: on, closedCallId: callId } : l,
  );
  writeLoops(loops);
  return loadLoops();
}

export function reopenLoop(id: string): OpenLoop[] {
  const loops = readLoops().map(l =>
    l.id === id ? { ...l, closedOn: null, closedCallId: null } : l,
  );
  writeLoops(loops);
  return loadLoops();
}

export function removeCallReview(id: string, today: string): CallReview[] {
  writeReviews(readReviews().filter(r => r.id !== id));
  return loadCallReviews(today);
}

export function nextTape(rows: CallReview[]): CallReview | null {
  return rows.find(r => r.status === "todo") || rows.find(r => r.status === "in_progress") || null;
}

export function emptyCall(today: string): Omit<CallReview, "id" | "createdAt" | "reviewedAt"> {
  return {
    lead: "",
    rep: "Benji",
    seat: "setter",
    on: today,
    lane: "review",
    quality: "good",
    outcome: "Conversation (>120s)",
    status: "todo",
    wentWell: "",
    improve: "",
    nextFocus: "",
    moments: [],
    recordingUrl: "",
  };
}
