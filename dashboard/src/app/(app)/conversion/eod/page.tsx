import { getViewer, requireAppAccess } from "@/lib/viewer";
import { ConstraintForm } from "../ConstraintForm";

export const dynamic = "force-dynamic";

export default async function EodConstraintsPage() {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  return <ConstraintForm cadence="eod" />;
}
