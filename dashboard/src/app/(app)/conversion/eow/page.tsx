import { getViewer, requireAppAccess } from "@/lib/viewer";
import { ConstraintForm } from "../ConstraintForm";

export const dynamic = "force-dynamic";

export default async function EowConstraintsPage() {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  return <ConstraintForm cadence="eow" />;
}
