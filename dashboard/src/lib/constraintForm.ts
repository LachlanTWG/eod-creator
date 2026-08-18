export type Seat = "setter" | "closer";
export type Cadence = "eod" | "eow";

export type SetterInputs = {
  worked: boolean;
  leadsAssigned: string;
  dialled: string;
  answered: string;
  conversations: string;
  qualified: string;
  bookedManual: string;
  bookedDirect: string;
  dq: string;
  invalid: string;
  lost: string;
  talkMinutes: string;
};

export type CloserInputs = {
  worked: boolean;
  slotsAvailable: string;
  bookingsDue: string;
  liveCalls: string;
  noShows: string;
  reschedules: string;
  cancels: string;
  offers: string;
  units: string;
  deposits: string;
  cashCollected: string;
  talkMinutes: string;
};

export type ConstraintEntry = {
  id: string;
  cadence: Cadence;
  seat: Seat;
  name: string;
  on: string;
  setter?: SetterInputs;
  closer?: CloserInputs;
  constraint: string;
  impact: string;
  ask: string;
  createdAt: string;
};

export const emptySetter = (): SetterInputs => ({
  worked: true,
  leadsAssigned: "",
  dialled: "",
  answered: "",
  conversations: "",
  qualified: "",
  bookedManual: "",
  bookedDirect: "",
  dq: "",
  invalid: "",
  lost: "",
  talkMinutes: "",
});

export const emptyCloser = (): CloserInputs => ({
  worked: true,
  slotsAvailable: "",
  bookingsDue: "",
  liveCalls: "",
  noShows: "",
  reschedules: "",
  cancels: "",
  offers: "",
  units: "",
  deposits: "",
  cashCollected: "",
  talkMinutes: "",
});

function n(raw: string): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0;
}

function pct(a: string, b: string): string {
  const d = n(b);
  if (d <= 0) return "—";
  return `${Math.round((n(a) / d) * 100)}%`;
}

export function setterRates(s: SetterInputs): { label: string; value: string }[] {
  return [
    { label: "Answer rate", value: pct(s.answered, s.dialled) },
    { label: "Conversation / answered", value: pct(s.conversations, s.answered) },
    { label: "Qualified / conversation", value: pct(s.qualified, s.conversations) },
    { label: "Lead → booked", value: pct(String(n(s.bookedManual) + n(s.bookedDirect)), s.leadsAssigned) },
  ];
}

export function closerRates(c: CloserInputs): { label: string; value: string }[] {
  return [
    { label: "Show rate", value: pct(c.liveCalls, c.bookingsDue) },
    { label: "No-show %", value: pct(c.noShows, c.bookingsDue) },
    { label: "Slot utilisation", value: pct(c.liveCalls, c.slotsAvailable) },
    { label: "Offer rate", value: pct(c.offers, c.liveCalls) },
    { label: "Close rate · live", value: pct(c.units, c.liveCalls) },
  ];
}

const KEY = "tsd-constraint-entries";

export function loadEntries(cadence: Cadence): ConstraintEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as ConstraintEntry[]) : [];
    return all.filter(e => e.cadence === cadence).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function saveEntry(entry: ConstraintEntry): void {
  const raw = localStorage.getItem(KEY);
  const all = raw ? (JSON.parse(raw) as ConstraintEntry[]) : [];
  all.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 80)));
}
