import { getViewer, requireAppAccess } from "@/lib/viewer";
import { loadQuotieRange } from "../quotieRange";
import { loadSalesOverview } from "@/lib/salesOverview";
import { SalesOverview } from "../SalesOverview";

export const dynamic = "force-dynamic";

export default async function SalesOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const q = await searchParams;
  const { rangeLabel, presets, from, to } = loadQuotieRange(q);
  const snap = loadSalesOverview(from, to);
  return (
    <SalesOverview
      snap={snap}
      rangeLabel={rangeLabel}
      presets={presets}
      from={from}
      to={to}
    />
  );
}
