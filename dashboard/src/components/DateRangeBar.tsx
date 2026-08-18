// Shared From / To / Apply bar + optional presets. Server-rendered GET form
// so date changes are just a navigation (same pattern as /reports).

import Link from "next/link";

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none";

export type DatePreset = { label: string; from: string; to: string };

export function DateRangeBar({
  action,
  from,
  to,
  today,
  hidden,
  presets,
}: {
  action: string;
  from: string;
  to: string;
  today: string;
  hidden?: Record<string, string>;
  presets?: DatePreset[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <form key={`${from}-${to}`} action={action} method="get" className="flex flex-wrap items-end gap-3">
        {hidden &&
          Object.entries(hidden).map(([name, value]) =>
            value ? <input key={name} type="hidden" name={name} value={value} /> : null,
          )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">From</span>
          <input type="date" name="from" defaultValue={from} max={today} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">To</span>
          <input type="date" name="to" defaultValue={to} max={today} className={inputClass} />
        </label>
        <button
          type="submit"
          className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Apply
        </button>
      </form>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          {presets.map(p => {
            const active = p.from === from && p.to === to;
            const params = new URLSearchParams();
            if (hidden) {
              for (const [k, v] of Object.entries(hidden)) {
                if (v) params.set(k, v);
              }
            }
            params.set("from", p.from);
            params.set("to", p.to);
            return (
              <Link
                key={p.label}
                href={`${action}?${params.toString()}`}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
