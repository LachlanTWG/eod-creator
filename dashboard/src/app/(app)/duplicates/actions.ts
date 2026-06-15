"use server";

// Server action for the Duplicates review page. Batch-deletes activity rows
// straight from Postgres (RLS still applies). Mirrors deleteActivity() in
// ../activities/actions.ts but takes a list. Admin-only surface — checked here
// as defence in depth on top of RLS.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

export async function deleteActivities(ids: string[]): Promise<DeleteResult> {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (clean.length === 0) return { ok: false, error: "No rows selected" };

  const supabase = await createClient();
  const viewer = await getViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only" };

  // .select() returns the rows actually deleted, so we report a true count
  // (RLS would silently skip any the caller can't touch).
  const { data, error } = await supabase
    .from("activities")
    .delete()
    .in("id", clean)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/duplicates");
  revalidatePath("/activities");
  revalidatePath("/me");
  return { ok: true, deleted: data?.length ?? 0 };
}
