// Renders one formatted EOD/EOW/etc message as a card with monospace <pre>.
// The message text is the exact same format the cron generators send to
// Slack/ClickUp, computed live from Postgres.

import type { LiveMessage as LiveMessageData } from "@/lib/messages";

export function LiveMessage({ data, variant }: { data: LiveMessageData | null; variant: "hero" | "compact" }) {
  const isHero = variant === "hero";
  const isPersonal = data?.scope === "personal";

  if (!data) {
    return (
      <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/30 ${isHero ? "p-5" : "p-4"}`}>
        <div className="text-xs text-zinc-600 italic">Not on this roster.</div>
      </div>
    );
  }

  // Body of the report excluding the first 1-2 header lines + leading separator.
  const allLines = data.message.split("\n");
  const headerLineCount = allLines[0]?.startsWith("EOD ") ? 1 : 2;
  // Header lines + first separator line are skipped; we render our own header above.
  const bodyLines = allLines.slice(headerLineCount + 1);
  const body = bodyLines.join("\n").trim();
  const isEmpty = body === "" || body === bodyLines[bodyLines.length - 1];

  return (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-br transition-colors hover:border-zinc-700 ${
        isPersonal
          ? "border-zinc-800 from-zinc-900/60 to-zinc-900/20"
          : "border-zinc-800/60 from-zinc-900/30 to-zinc-950/10"
      } ${isHero ? "p-5" : "p-4"}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800/70 pb-3">
        <div className="min-w-0">
          <div className={`truncate font-semibold ${isHero ? "text-base" : "text-sm"} text-zinc-100`}>
            {data.title}
          </div>
          {data.subtitle && (
            <div className={`mt-0.5 truncate ${isHero ? "text-xs" : "text-[10px]"} text-zinc-500`}>
              {data.subtitle}
            </div>
          )}
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
            isPersonal
              ? "bg-emerald-500/15 text-emerald-300/90"
              : "bg-zinc-700/40 text-zinc-400"
          }`}
        >
          {isPersonal ? "Mine" : "Team"}
        </span>
      </div>

      {isEmpty ? (
        <div className={`mt-4 text-${isHero ? "sm" : "xs"} italic text-zinc-600`}>
          No activity logged for this period yet.
        </div>
      ) : (
        <pre
          className={`mt-3 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-snug text-zinc-300 ${
            isHero ? "text-[12.5px]" : "text-[11px]"
          }`}
        >
          {body}
        </pre>
      )}
    </div>
  );
}
