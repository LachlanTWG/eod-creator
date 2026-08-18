// /me — convenience redirect to the viewer's own /execs/[name] page so
// there's one canonical "my dashboard" view (live messages + analytics).
// Pure-admin users with no sales_people link land on the overview.

import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (viewer.salesPersonName) {
    const qs = new URLSearchParams();
    if (sp.period) qs.set("period", sp.period);
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
    const q = qs.toString();
    redirect(`/execs/${encodeURIComponent(viewer.salesPersonName)}${q ? `?${q}` : ""}`);
  }
  redirect("/");
}
