import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAppAccess } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ConversionIndexPage() {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const supabase = await createClient();
  const companies = await listCompanies(supabase);

  if (companies.length === 0) {
    return (
      <div className="px-8 py-6">
        <h1 className="text-xl font-semibold">Conversion</h1>
        <p className="mt-1 text-sm text-zinc-500">No clients on this account.</p>
      </div>
    );
  }

  redirect(`/conversion/${companies[0].slug}`);
}
