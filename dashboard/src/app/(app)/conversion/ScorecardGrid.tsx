import { rowTotal, type Scorecard, type ScoreCell, type ScoreRow } from "@/lib/scorecard";

function fmt(kind: ScoreRow["kind"], v: ScoreCell): string {
  if (v == null) return "—";
  if (kind === "check") return v ? "Valid" : "Off";
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (kind === "pct") return `${Math.round(v * 100)}%`;
  if (kind === "money") {
    if (v === 0) return "$0";
    if (Math.abs(v) >= 1000) return `$${Math.round(v / 100) / 10}k`.replace(".0k", "k");
    return `$${Math.round(v)}`;
  }
  if (kind === "time") {
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  return String(v);
}

export function ScorecardGrid({
  title,
  card,
}: {
  title: string;
  card: Scorecard;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600">
        {title} · one column per day · total on the right
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[220px] border-b border-r border-slate-200 bg-slate-800 px-3 py-2 text-left font-medium text-white">
                Metric
              </th>
              {card.days.map(d => (
                <th
                  key={d.date}
                  className={`min-w-[72px] border-b border-slate-700 px-1.5 py-2 text-center font-medium ${
                    d.off ? "bg-slate-700 text-slate-300" : "bg-slate-800 text-white"
                  }`}
                >
                  <div>{d.weekday} {d.dayNum}</div>
                  <div className="text-[10px] font-normal opacity-70">{d.month}</div>
                </th>
              ))}
              <th className="sticky right-0 z-20 min-w-[72px] border-b border-l border-slate-700 bg-blue-600 px-2 py-2 text-center font-medium text-white">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map(r => {
              if (r.group) {
                return (
                  <tr key={r.key}>
                    <td
                      colSpan={card.days.length + 2}
                      className="sticky left-0 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600"
                    >
                      {r.label}
                    </td>
                  </tr>
                );
              }
              const total = rowTotal(r);
              return (
                <tr key={r.key} className={r.highlight ? "bg-amber-50" : "bg-white"}>
                  <td className={`sticky left-0 z-10 border-r border-slate-200 px-3 py-1.5 text-left font-medium text-slate-800 ${r.highlight ? "bg-amber-50" : "bg-white"}`}>
                    {r.label}
                  </td>
                  {r.cells.map((cell, i) => {
                    const off = card.days[i]?.off;
                    return (
                      <td
                        key={card.days[i]?.date ?? i}
                        className={`border-l border-slate-100 px-1.5 py-1.5 text-center tabular-nums ${
                          off ? "bg-slate-50 text-slate-400" : r.highlight ? "text-slate-900" : "text-slate-800"
                        }`}
                      >
                        <Cell kind={r.kind} value={cell} off={off} />
                      </td>
                    );
                  })}
                  <td className={`sticky right-0 z-10 border-l border-slate-200 px-2 py-1.5 text-center tabular-nums font-semibold ${r.highlight ? "bg-amber-100" : "bg-slate-50"}`}>
                    <Cell kind={r.kind} value={total} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ kind, value, off }: { kind: ScoreRow["kind"]; value: ScoreCell; off?: boolean }) {
  if (kind === "check") {
    if (off && value === false) {
      return <span className="text-[11px] text-slate-400">OFF</span>;
    }
    if (value === true) {
      return (
        <span className="inline-flex items-center justify-center rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700">
          ✓
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center rounded bg-red-50 px-1.5 text-[11px] font-medium text-red-700">
        ✗
      </span>
    );
  }
  return <>{fmt(kind, value)}</>;
}
