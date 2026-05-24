// Live preview client — hits the Node service's /preview endpoint to get a
// freshly-generated report (same generators that fire on cron). Useful when
// the reports table hasn't been populated yet, or you want to see the
// current state without waiting for the next cron run.

export type PreviewReport = {
  company: string;
  report: "eod" | "eow" | "eom" | "eoq" | "eoy";
  period: Record<string, string | number>;
  team: { formatted: string; counts?: Record<string, unknown>; names?: Record<string, unknown> };
  people: { name: string; formatted: string; counts?: Record<string, unknown> }[];
};

export type PreviewOpts = {
  date?: string;
  startDate?: string;
  endDate?: string;
  year?: number;
  month?: number;
  quarter?: number;
};

export async function fetchLivePreview(
  reportType: "eod" | "eow" | "eom" | "eoq" | "eoy",
  companyName: string,
  opts: PreviewOpts = {},
): Promise<PreviewReport> {
  const base = process.env.NODE_SERVICE_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!base) throw new Error("NODE_SERVICE_URL not set");

  const url = new URL(`/preview/${reportType}/${encodeURIComponent(companyName)}`, base);
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    // No caching — this is meant to be live
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Preview ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function isPreviewConfigured(): boolean {
  return !!process.env.NODE_SERVICE_URL;
}
