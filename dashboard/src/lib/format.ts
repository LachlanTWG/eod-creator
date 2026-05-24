// Shared formatting helpers.

export const SYDNEY_TZ = "Australia/Sydney";

export function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// Sum a pipe-delimited list of numbers like "1200|3500" → 4700
export function sumQuoteValues(raw: string | null | undefined): number {
  if (!raw) return 0;
  return String(raw)
    .split("|")
    .map(v => Number(v.replace(/[^\d.]/g, "")))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
}

export function formatCurrency(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export const EVENT_LABELS: Record<string, string> = {
  eod_update: "EOD updates",
  quote_sent: "Quotes sent",
  job_won: "Jobs won",
  site_visit_booked: "Site visits",
  email_sent: "Emails",
};
