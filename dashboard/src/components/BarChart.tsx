// Lightweight bar chart — vertical bars, optional value labels and currency
// formatting. No deps.

import { formatCurrency } from "@/lib/format";

export function BarChart({
  bars,
  height = 140,
  format = "number",
  highlightLast = false,
}: {
  bars: { label: string; value: number; sub?: string }[];
  height?: number;
  format?: "number" | "currency";
  highlightLast?: boolean;
}) {
  const max = Math.max(1, ...bars.map(b => b.value));
  const fmt = (v: number) => format === "currency" ? formatCurrency(v) : v.toLocaleString();

  return (
    <div className="flex items-stretch gap-1.5" style={{ height }}>
      {bars.map((b, i) => {
        const isLast = i === bars.length - 1;
        const accent = highlightLast && isLast;
        const pct = (b.value / max) * 100;
        return (
          // Each column is a fixed-height flex-col so the bar's percentage
          // height resolves against a sized parent (the inner relative
          // wrapper takes flex-1 of the column).
          <div key={`${b.label}-${i}`} className="flex-1 flex flex-col gap-1 min-w-0">
            <div className="h-3 text-[10px] tabular-nums text-zinc-400 text-center truncate">
              {b.value > 0 ? fmt(b.value) : ""}
            </div>
            <div className="flex-1 relative">
              <div
                className={`absolute inset-x-0 bottom-0 rounded-sm transition-all ${accent ? "bg-emerald-500/70" : "bg-zinc-700 hover:bg-zinc-600"}`}
                style={{ height: `${pct}%`, minHeight: b.value > 0 ? 2 : 0 }}
                title={`${b.label} — ${fmt(b.value)}${b.sub ? " " + b.sub : ""}`}
              />
            </div>
            <div className="text-[10px] text-zinc-500 truncate text-center">{b.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Horizontal bars for ranking-style data (top outcomes, top sources, etc).
export function HBars({
  rows,
  format = "number",
}: {
  rows: { label: string; value: number }[];
  format?: "number" | "currency";
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const fmt = (v: number) => format === "currency" ? formatCurrency(v) : v.toLocaleString();

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="grid grid-cols-[1fr_4ch] items-center gap-3 text-xs">
          <div className="relative h-5 overflow-hidden rounded bg-zinc-900">
            <div
              className="absolute inset-y-0 left-0 bg-zinc-700"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
            <div className="relative px-2 leading-5 truncate text-zinc-200">{r.label}</div>
          </div>
          <div className="text-right tabular-nums text-zinc-400">{fmt(r.value)}</div>
        </div>
      ))}
    </div>
  );
}
