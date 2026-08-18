import { getViewer, requireAppAccess } from "@/lib/viewer";
import { QuotieDashboard } from "../QuotieDashboard";
import { loadQuotieRange } from "../quotieRange";

export const dynamic = "force-dynamic";

export default async function PaidAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const q = await searchParams;
  const { snap, rangeLabel, presets, from, to } = loadQuotieRange(q);
  return (
    <QuotieDashboard
      tab="ads"
      snap={snap}
      rangeLabel={rangeLabel}
      presets={presets}
      from={from}
      to={to}
    />
  );
}
