// Server-rendered pieces of the /eod-entry popup: tab bar + the Today / Me
// stat views. Tabs are plain links that reload the iframe with a `tab` param
// (no client state to keep in sync); the Log tab is the interactive form.

import type { CompanyToday, DayTally, MyToday } from "./data";

export function buildQs(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `/eod-entry?${qs.toString()}`;
}

export function TabBar({
  active,
  base,
}: {
  active: "log" | "today" | "me";
  base: Record<string, string | undefined>;
}) {
  const tabs = [
    { key: "log" as const, label: "Log" },
    { key: "today" as const, label: "Today" },
    { key: "me" as const, label: "Me" },
  ];
  return (
    <nav className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
      {tabs.map(t => (
        <a
          key={t.key}
          href={buildQs({ ...base, tab: t.key === "log" ? undefined : t.key })}
          className={
            active === t.key
              ? "rounded-md bg-zinc-700/70 px-3 py-1.5 text-center text-xs font-semibold text-zinc-100"
              : "rounded-md px-3 py-1.5 text-center text-xs text-zinc-400 hover:text-zinc-200"
          }
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export function TallyGrid({ t }: { t: DayTally }) {
  const touches = t.answered + t.didntAnswer;
  const rate = touches > 0 ? `${Math.round((t.answered / touches) * 100)}% answered` : undefined;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Calls logged" value={String(t.eodUpdates)} sub={rate} />
      <Stat label="Answered" value={`${t.answered}/${t.didntAnswer}`} sub="ans / didn't" />
      <Stat label="Quotes" value={String(t.quotes)} sub={t.quotedTotal ? money(t.quotedTotal) : undefined} />
      <Stat label="Site visits" value={String(t.siteVisits)} />
      <Stat label="Jobs won" value={String(t.jobsWon)} />
      <Stat label="Emails" value={String(t.emails)} />
    </div>
  );
}

function MiniTally({ t }: { t: DayTally }) {
  const bits: string[] = [];
  if (t.eodUpdates) bits.push(`${t.eodUpdates} call${t.eodUpdates > 1 ? "s" : ""} (${t.answered} ans)`);
  if (t.quotes) bits.push(`${t.quotes} quote${t.quotes > 1 ? "s" : ""}${t.quotedTotal ? ` ${money(t.quotedTotal)}` : ""}`);
  if (t.siteVisits) bits.push(`${t.siteVisits} visit${t.siteVisits > 1 ? "s" : ""}`);
  if (t.jobsWon) bits.push(`${t.jobsWon} won 🎉`);
  if (t.emails) bits.push(`${t.emails} email${t.emails > 1 ? "s" : ""}`);
  return <span className="text-[11px] text-zinc-400">{bits.join(" · ") || "—"}</span>;
}

export function TodayView({
  companyName,
  date,
  today,
}: {
  companyName: string;
  date: string;
  today: CompanyToday;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-zinc-100">{companyName} — today</div>
        <div className="text-[11px] text-zinc-500">{date}</div>
      </div>
      <TallyGrid t={today.tally} />
      <div>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">By exec</div>
        {today.perPerson.length === 0 ? (
          <p className="text-xs text-zinc-500">Nothing logged yet today.</p>
        ) : (
          <ul className="space-y-1.5">
            {today.perPerson.map(p => (
              <li key={p.name} className="flex items-baseline justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-1.5">
                <span className="text-xs font-medium text-zinc-200">{p.name}</span>
                <MiniTally t={p.tally} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function MeView({
  exec,
  execNames,
  my,
  base,
}: {
  exec: string;
  execNames: string[];
  my: MyToday | null;
  base: Record<string, string | undefined>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {execNames.map(name => (
          <a
            key={name}
            href={buildQs({ ...base, tab: "me", exec: name })}
            className={
              name === exec
                ? "rounded-full border border-emerald-700 bg-emerald-600/20 px-3 py-1 text-xs font-semibold text-emerald-300"
                : "rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-600"
            }
          >
            {name}
          </a>
        ))}
      </div>

      {!exec ? (
        <p className="text-xs text-zinc-500">Pick your name to see your day across all clients.</p>
      ) : !my ? null : (
        <>
          <div className="text-sm font-semibold text-zinc-100">{exec} — today, all clients</div>
          <TallyGrid t={my.total} />
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">By client</div>
            {my.perCompany.length === 0 ? (
              <p className="text-xs text-zinc-500">Nothing logged yet today.</p>
            ) : (
              <ul className="space-y-1.5">
                {my.perCompany.map(c => (
                  <li key={c.company} className="flex items-baseline justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-1.5">
                    <span className="text-xs font-medium text-zinc-200">{c.company}</span>
                    <MiniTally t={c.tally} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
