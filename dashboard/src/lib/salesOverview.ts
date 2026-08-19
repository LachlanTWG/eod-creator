// Beta sales-floor rollup: every setter and closer’s daily inputs collapsed
// to month-to-date totals, then ranked. Live Close/Cal replaces the generator.

import {
  closerScorecard,
  setterScorecard,
  scorecardSum as sum,
  scorecardTrueCount,
  type ScoreGenOpts,
} from "./scorecard";

export type SetterMtd = {
  name: string;
  daysWorked: number;
  talkMin: number;
  leads: number;
  dialled: number;
  answered: number;
  conversations: number;
  qualified: number;
  bookedManual: number;
  bookedDirect: number;
  booked: number;
  dq: number;
  invalid: number;
  lost: number;
  answerRate: number;
  conversationRate: number;
  leadToBook: number;
  cash: number;
  cashPerDay: number | null;
  cashPerLead: number | null;
  cashPerBooked: number | null;
};

export type CloserMtd = {
  name: string;
  daysWorked: number;
  talkMin: number;
  slots: number;
  due: number;
  live: number;
  noShow: number;
  resched: number;
  cancel: number;
  units: number;
  deposits: number;
  pif: number;
  sold: number;
  cash: number;
  showRate: number;
  closeRate: number;
  cashPerDay: number | null;
  cashPerLead: number | null;
  cashPerLive: number | null;
};

export type SalesOverviewSnap = {
  from: string;
  to: string;
  closers: CloserMtd[];
  setters: SetterMtd[];
  team: {
    daysWorked: number;
    leads: number;
    dialled: number;
    answered: number;
    conversations: number;
    booked: number;
    live: number;
    units: number;
    sold: number;
    cash: number;
    talkMin: number;
  };
};

const SETTERS: { name: string; opts: ScoreGenOpts }[] = [
  { name: "Benji", opts: { salt: 0, bias: 0.08 } },
  { name: "Sam Kelly", opts: { salt: 41, bias: 0.22 } },
  { name: "Jordan Lee", opts: { salt: 82, bias: 0 } },
  { name: "Priya Nair", opts: { salt: 123, bias: -0.12 } },
];

const CLOSERS: { name: string; opts: ScoreGenOpts }[] = [
  { name: "Locky", opts: { salt: 0, bias: 0.18 } },
  { name: "Chris Walsh", opts: { salt: 55, bias: 0.04 } },
  { name: "Alex Hart", opts: { salt: 91, bias: -0.12 } },
];

function per(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function closerMtd(name: string, from: string, to: string, opts: ScoreGenOpts): CloserMtd {
  const card = closerScorecard(from, to, opts);
  const daysWorked = scorecardTrueCount(card, "worked");
  const due = sum(card, "due");
  const live = sum(card, "live");
  const units = sum(card, "units");
  const deposits = sum(card, "dep");
  const pif = sum(card, "pif");
  const sold = units + deposits + pif;
  const cash = sum(card, "cash");
  return {
    name,
    daysWorked,
    talkMin: sum(card, "talk"),
    slots: sum(card, "slots"),
    due,
    live,
    noShow: sum(card, "noshow"),
    resched: sum(card, "resched"),
    cancel: sum(card, "cancel"),
    units,
    deposits,
    pif,
    sold,
    cash,
    showRate: rate(live, due),
    closeRate: rate(sold, live),
    cashPerDay: per(cash, daysWorked),
    cashPerLead: per(cash, due),
    cashPerLive: per(cash, live),
  };
}

function setterMtd(name: string, from: string, to: string, opts: ScoreGenOpts): Omit<SetterMtd, "cash" | "cashPerDay" | "cashPerLead" | "cashPerBooked"> {
  const card = setterScorecard(from, to, opts);
  const daysWorked = scorecardTrueCount(card, "worked");
  const leads = sum(card, "assigned");
  const dialled = sum(card, "dialled");
  const answered = sum(card, "answered");
  const conversations = sum(card, "convos");
  const bookedManual = sum(card, "book_m");
  const bookedDirect = sum(card, "book_d");
  const booked = bookedManual + bookedDirect;
  return {
    name,
    daysWorked,
    talkMin: sum(card, "talk"),
    leads,
    dialled,
    answered,
    conversations,
    qualified: sum(card, "qualified"),
    bookedManual,
    bookedDirect,
    booked,
    dq: sum(card, "dq"),
    invalid: sum(card, "invalid"),
    lost: sum(card, "lost"),
    answerRate: rate(answered, dialled),
    conversationRate: rate(conversations, answered),
    leadToBook: rate(booked, leads),
  };
}

export function loadSalesOverview(from: string, to: string): SalesOverviewSnap {
  const closers = CLOSERS
    .map(r => closerMtd(r.name, from, to, r.opts))
    .sort((a, b) => b.cash - a.cash || b.sold - a.sold);

  const rawSetters = SETTERS.map(r => setterMtd(r.name, from, to, r.opts));
  const teamCash = closers.reduce((n, r) => n + r.cash, 0);
  const teamBooked = rawSetters.reduce((n, r) => n + r.booked, 0);

  const setters: SetterMtd[] = rawSetters
    .map(r => {
      const cash = teamBooked > 0 ? teamCash * (r.booked / teamBooked) : 0;
      return {
        ...r,
        cash,
        cashPerDay: per(cash, r.daysWorked),
        cashPerLead: per(cash, r.leads),
        cashPerBooked: per(cash, r.booked),
      };
    })
    .sort((a, b) => b.cash - a.cash || b.booked - a.booked);

  return {
    from,
    to,
    closers,
    setters,
    team: {
      daysWorked: closers.reduce((n, r) => n + r.daysWorked, 0) + setters.reduce((n, r) => n + r.daysWorked, 0),
      leads: setters.reduce((n, r) => n + r.leads, 0),
      dialled: setters.reduce((n, r) => n + r.dialled, 0),
      answered: setters.reduce((n, r) => n + r.answered, 0),
      conversations: setters.reduce((n, r) => n + r.conversations, 0),
      booked: setters.reduce((n, r) => n + r.booked, 0),
      live: closers.reduce((n, r) => n + r.live, 0),
      units: closers.reduce((n, r) => n + r.units, 0),
      sold: closers.reduce((n, r) => n + r.sold, 0),
      cash: teamCash,
      talkMin: closers.reduce((n, r) => n + r.talkMin, 0) + setters.reduce((n, r) => n + r.talkMin, 0),
    },
  };
}
