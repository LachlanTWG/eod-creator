// 90-day activity calendar — GitHub-contributions style. Each cell is a day,
// colour intensity scaled to the max-day count in the dataset.

import { weekdayShort, shortDate } from "@/lib/dates";

export function Heatmap({ days }: { days: { date: string; count: number }[] }) {
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map(d => d.count));

  // Group by week column. Each column has 7 rows Mon-Sun. The first column
  // may have empty cells if the window doesn't start on a Monday.
  const cols: { date: string; count: number }[][] = [];
  let current: { date: string; count: number }[] = [];
  const firstWd = weekdayIndex(days[0].date);     // 0=Mon..6=Sun
  for (let pad = 0; pad < firstWd; pad++) current.push({ date: "", count: -1 });

  for (const d of days) {
    current.push(d);
    if (current.length === 7) {
      cols.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push({ date: "", count: -1 });
    cols.push(current);
  }

  const intensity = (c: number) => {
    if (c <= 0) return "bg-zinc-900";
    const t = c / max;
    if (t < 0.15) return "bg-emerald-900";
    if (t < 0.35) return "bg-emerald-700";
    if (t < 0.6) return "bg-emerald-500";
    return "bg-emerald-400";
  };

  return (
    <div>
      <div className="flex gap-[2px]">
        {/* Weekday labels */}
        <div className="flex flex-col gap-[2px] pr-2 text-[10px] text-zinc-600">
          {["Mon", "", "Wed", "", "Fri", "", ""].map((w, i) => (
            <div key={i} className="h-3 leading-3">{w}</div>
          ))}
        </div>
        {/* Day grid */}
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[2px]">
            {col.map((d, ri) => (
              <div
                key={`${ci}-${ri}`}
                className={`h-3 w-3 rounded-[2px] ${d.count < 0 ? "bg-transparent" : intensity(d.count)}`}
                title={d.date ? `${shortDate(d.date)} (${weekdayShort(d.date)}) — ${d.count} activit${d.count === 1 ? "y" : "ies"}` : ""}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
        <span>Less</span>
        {["bg-zinc-900", "bg-emerald-900", "bg-emerald-700", "bg-emerald-500", "bg-emerald-400"].map((c, i) => (
          <div key={i} className={`h-3 w-3 rounded-[2px] ${c}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// 0=Mon..6=Sun (UTC-based)
function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (dow + 6) % 7;
}
