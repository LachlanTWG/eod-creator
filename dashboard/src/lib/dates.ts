// Calendar-date helpers. All inputs/outputs are YYYY-MM-DD strings — no
// TZ involvement. Internally we use UTC so .toISOString() doesn't shift the
// day across midnight in a local TZ.

export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;          // 1=Mon … 7=Sun
  date.setUTCDate(date.getUTCDate() - (dow - 1));
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Days between two calendar dates: returns (b - a). */
export function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aMs = Date.UTC(ay, am - 1, ad);
  const bMs = Date.UTC(by, bm - 1, bd);
  return Math.round((bMs - aMs) / 86400000);
}

/** Count Mon-Fri days inclusive between start and end (YYYY-MM-DD). */
export function businessDaysBetween(startIso: string, endIso: string): number {
  if (startIso > endIso) return 0;
  let count = 0;
  let cursor = startIso;
  while (cursor <= endIso) {
    const [y, m, d] = cursor.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor = addDaysIso(cursor, 1);
  }
  return count;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-05-18" → "18 May" */
export function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}

/** "2026-05-18" → "Mon" — based on the calendar date, not local TZ */
export function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAYS_SHORT[date.getUTCDay()];
}

/** "2026-05-18" → "May 2026" */
export function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

export type Period = "day" | "week" | "month" | "quarter" | "year";

export type PeriodRange = {
  type: Period;
  start: string;        // current-period start (calendar date)
  end: string;          // current-period end (today, capped at period end)
  prevStart: string;
  prevEnd: string;
  label: string;        // human label, e.g. "This week"
  prevLabel: string;
  /** trend bucket count + size — what kind of period each bar represents */
  trendBuckets: number;
  bucketBy: Period;
};

/**
 * Resolve the range for the current period (and the matching previous-period
 * range) given today (YYYY-MM-DD in the relevant business TZ).
 */
export function periodRange(period: Period, today: string): PeriodRange {
  const [y, m] = today.split("-").map(Number);

  switch (period) {
    case "day":
      return {
        type: "day",
        start: today, end: today,
        prevStart: addDaysIso(today, -1), prevEnd: addDaysIso(today, -1),
        label: "Today", prevLabel: "Yesterday",
        trendBuckets: 14, bucketBy: "day",
      };

    case "week": {
      const monday = mondayOf(today);
      const prevMonday = addDaysIso(monday, -7);
      // Pace-match: previous window covers the same number of elapsed days
      // (today - monday) so we compare like-for-like rather than partial-week
      // vs full-week.
      const elapsed = daysBetweenIso(monday, today);
      return {
        type: "week",
        start: monday, end: today,
        prevStart: prevMonday, prevEnd: addDaysIso(prevMonday, elapsed),
        label: "This week", prevLabel: "Last week",
        trendBuckets: 12, bucketBy: "week",
      };
    }

    case "month": {
      const monthStart = `${y}-${pad2(m)}-01`;
      const prevMonth = m === 1 ? `${y - 1}-12-01` : `${y}-${pad2(m - 1)}-01`;
      const elapsed = daysBetweenIso(monthStart, today);
      return {
        type: "month",
        start: monthStart, end: today,
        prevStart: prevMonth, prevEnd: addDaysIso(prevMonth, elapsed),
        label: monthLabel(monthStart), prevLabel: monthLabel(prevMonth),
        trendBuckets: 12, bucketBy: "month",
      };
    }

    case "quarter": {
      const q = Math.ceil(m / 3);
      const qStartMonth = (q - 1) * 3 + 1;
      const qStart = `${y}-${pad2(qStartMonth)}-01`;
      const prevQStart = q === 1
        ? `${y - 1}-10-01`
        : `${y}-${pad2(qStartMonth - 3)}-01`;
      const prevQ = q === 1 ? 4 : q - 1;
      const prevQYear = q === 1 ? y - 1 : y;
      const elapsed = daysBetweenIso(qStart, today);
      return {
        type: "quarter",
        start: qStart, end: today,
        prevStart: prevQStart, prevEnd: addDaysIso(prevQStart, elapsed),
        label: `Q${q} ${y}`, prevLabel: `Q${prevQ} ${prevQYear}`,
        trendBuckets: 8, bucketBy: "quarter",
      };
    }

    case "year": {
      const yStart = `${y}-01-01`;
      const prevYStart = `${y - 1}-01-01`;
      const elapsed = daysBetweenIso(yStart, today);
      return {
        type: "year",
        start: yStart, end: today,
        prevStart: prevYStart, prevEnd: addDaysIso(prevYStart, elapsed),
        label: `${y}`, prevLabel: `${y - 1}`,
        trendBuckets: 5, bucketBy: "year",
      };
    }
  }
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

/**
 * Shift an anchor date by whole periods (delta may be negative). Returns a
 * date inside the target period — day 1 for month/quarter/year, same weekday
 * for week — suitable for feeding back into fullPeriodRange().
 */
export function shiftPeriodAnchor(period: Period, anchor: string, delta: number): string {
  const [y, m] = anchor.split("-").map(Number);
  switch (period) {
    case "day":  return addDaysIso(anchor, delta);
    case "week": return addDaysIso(anchor, 7 * delta);
    case "month": {
      const t = y * 12 + (m - 1) + delta;
      return `${Math.floor(t / 12)}-${pad2(((t % 12) + 12) % 12 + 1)}-01`;
    }
    case "quarter": {
      const q = Math.ceil(m / 3);
      const t = y * 4 + (q - 1) + delta;
      const qq = ((t % 4) + 4) % 4;
      return `${Math.floor(t / 4)}-${pad2(qq * 3 + 1)}-01`;
    }
    case "year": return `${y + delta}-01-01`;
  }
}

/**
 * Bucket key for a given date and bucket type. Use these as Map keys when
 * aggregating activity into trend buckets.
 */
export function bucketKey(dateStr: string, by: Period): string {
  const [y, m] = dateStr.split("-").map(Number);
  switch (by) {
    case "day":     return dateStr;
    case "week":    return mondayOf(dateStr);
    case "month":   return `${y}-${pad2(m)}`;
    case "quarter": return `${y}-Q${Math.ceil(m / 3)}`;
    case "year":    return String(y);
  }
}

/** Pretty label for a bucket key, given its bucket type. */
export function bucketLabel(key: string, by: Period): string {
  switch (by) {
    case "day":     return shortDate(key);            // "18 May"
    case "week":    return shortDate(key);            // Mon-of-week
    case "month": {
      const [yr, mo] = key.split("-");
      return `${MONTHS[parseInt(mo, 10) - 1]} ${yr.slice(2)}`;   // "May 26"
    }
    case "quarter": return key;                       // "2026-Q2"
    case "year":    return key;
  }
}

/**
 * Produce the trend bucket keys for the period, ending on/around `today`.
 * Returns most-recent-last so charts read left-to-right.
 */
export function trendBucketKeys(period: Period, today: string): string[] {
  const r = periodRange(period, today);
  const [y, m] = today.split("-").map(Number);
  const keys: string[] = [];

  switch (r.bucketBy) {
    case "day": {
      for (let i = r.trendBuckets - 1; i >= 0; i--) {
        keys.push(addDaysIso(today, -i));
      }
      break;
    }
    case "week": {
      const currentMon = mondayOf(today);
      for (let i = r.trendBuckets - 1; i >= 0; i--) {
        keys.push(addDaysIso(currentMon, -i * 7));
      }
      break;
    }
    case "month": {
      // 12 months ending on current month
      for (let i = r.trendBuckets - 1; i >= 0; i--) {
        const totalMonths = y * 12 + (m - 1) - i;
        const yr = Math.floor(totalMonths / 12);
        const mo = (totalMonths % 12) + 1;
        keys.push(`${yr}-${pad2(mo)}`);
      }
      break;
    }
    case "quarter": {
      const currentQ = Math.ceil(m / 3);
      for (let i = r.trendBuckets - 1; i >= 0; i--) {
        const totalQ = y * 4 + (currentQ - 1) - i;
        const yr = Math.floor(totalQ / 4);
        const q = (totalQ % 4) + 1;
        keys.push(`${yr}-Q${q}`);
      }
      break;
    }
    case "year": {
      for (let i = r.trendBuckets - 1; i >= 0; i--) {
        keys.push(String(y - i));
      }
      break;
    }
  }
  return keys;
}
