// Period selector. Server-rendered Links — Next.js handles the routing.
// Active state is computed from the current period prop.

import Link from "next/link";
import type { Period } from "@/lib/dates";

type Tab = { period: Period; label: string; sub: string };
const TABS: Tab[] = [
  { period: "day",     label: "Today",      sub: "EOD" },
  { period: "week",    label: "This week",  sub: "EOW" },
  { period: "month",   label: "This month", sub: "EOM" },
  { period: "quarter", label: "This quarter", sub: "EOQ" },
  { period: "year",    label: "This year",  sub: "EOY" },
];

export function PeriodTabs({ basePath, active }: { basePath: string; active: Period }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1 rounded-xl border border-zinc-800 bg-zinc-900/30 p-1">
      {TABS.map(t => {
        const isActive = t.period === active;
        const href = t.period === "day" ? basePath : `${basePath}?period=${t.period}`;
        return (
          <Link
            key={t.period}
            href={href}
            className={`flex-1 min-w-[6rem] rounded-lg px-3 py-2 text-center transition-colors ${
              isActive
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
            }`}
          >
            <div className={`text-sm font-semibold ${isActive ? "text-zinc-50" : "text-zinc-300"}`}>
              {t.label}
            </div>
            <div className={`text-[10px] uppercase tracking-wider ${isActive ? "text-emerald-300/80" : "text-zinc-500"}`}>
              {t.sub}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
