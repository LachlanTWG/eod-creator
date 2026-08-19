import { getViewer, requireAppAccess } from "@/lib/viewer";
import { CallReviews } from "../CallReviews";

export const dynamic = "force-dynamic";

export default async function CallReviewsPage() {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  return <CallReviews />;
}
