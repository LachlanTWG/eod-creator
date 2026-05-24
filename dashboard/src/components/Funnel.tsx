// Funnel viz — sequential stages, each as a horizontal bar scaled to the
// first stage's count, with conversion % between adjacent stages.

export function Funnel({
  stages,
}: {
  stages: { label: string; value: number }[];
}) {
  if (stages.length === 0) return null;
  const top = stages[0].value || 1;

  return (
    <div className="space-y-1">
      {stages.map((s, i) => {
        const pct = (s.value / top) * 100;
        const fromPrev = i > 0 ? (stages[i - 1].value > 0 ? (s.value / stages[i - 1].value) * 100 : 0) : null;
        return (
          <div key={s.label} className="grid grid-cols-[10ch_1fr_5ch_5ch] items-center gap-3 text-xs">
            <div className="text-zinc-400 truncate">{s.label}</div>
            <div className="relative h-6 overflow-hidden rounded bg-zinc-900">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-700 to-emerald-500"
                style={{ width: `${pct}%` }}
              />
              <div className="relative px-2 leading-6 text-white text-[11px]">
                {s.value.toLocaleString()}
              </div>
            </div>
            <div className="text-right tabular-nums text-zinc-500">{pct.toFixed(0)}%</div>
            <div className="text-right tabular-nums text-zinc-400">
              {fromPrev !== null ? `${fromPrev.toFixed(0)}%` : ""}
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-[10ch_1fr_5ch_5ch] items-center gap-3 pt-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <div />
        <div />
        <div className="text-right">of top</div>
        <div className="text-right">step ↑</div>
      </div>
    </div>
  );
}
