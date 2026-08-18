import { mondayOf, addDaysIso, shortDate } from "@/lib/dates";
import { SYDNEY_TZ, todayInTz } from "@/lib/format";
import { sampleQuotieSnapshot } from "@/lib/quotieFunnel";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function loadQuotieRange(q: { from?: string; to?: string }) {
  const today = todayInTz(SYDNEY_TZ);
  const monthStart = `${today.slice(0, 8)}01`;
  let from = DATE_RE.test(q.from || "") ? q.from! : monthStart;
  let to = DATE_RE.test(q.to || "") ? q.to! : today;
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    rangeLabel: from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`,
    presets: [
      { label: "Today", from: today, to: today },
      { label: "This week", from: mondayOf(today), to: today },
      { label: "This month", from: monthStart, to: today },
      { label: "Last 30 days", from: addDaysIso(today, -29), to: today },
    ],
    snap: sampleQuotieSnapshot(from, to),
  };
}
