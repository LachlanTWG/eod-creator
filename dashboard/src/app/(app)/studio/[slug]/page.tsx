import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAppAccess, gateCompanySlug } from "@/lib/viewer";
import { listCompanies } from "@/lib/queries";
import { KIND_LABEL, publicPagePath, type PageKind, type StudioPage } from "@/lib/studio";
import { createStudioPage } from "../actions";

export const dynamic = "force-dynamic";

export default async function StudioClientPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const { slug } = await params;
  const supabase = await createClient();
  const company = await gateCompanySlug(viewer, supabase, slug);
  if (!company) notFound();

  const companies = await listCompanies(supabase);
  const { data: pages } = await supabase
    .from("studio_pages")
    .select("id, company_id, kind, title, slug, status, headline, subhead, body, video_url, cta_label, cta_url, published_at, updated_at")
    .eq("company_id", company.id)
    .order("updated_at", { ascending: false });

  const canEdit = viewer.isAdmin || viewer.isConversion;
  const origin = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://eod-creator.vercel.app";

  return (
    <div className="px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{company.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Studio — VSLs, landing pages, pre-call and nurture.</p>
        </div>
        {companies.length > 1 && (
          <div className="flex max-w-xl flex-wrap justify-end gap-1">
            {companies.map(c => (
              <Link
                key={c.id}
                href={`/studio/${c.slug}`}
                className={`rounded-md border px-2 py-1 text-xs ${
                  c.slug === slug
                    ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      {canEdit && (
        <form action={createStudioPage} className="flex flex-wrap gap-2 rounded-lg border border-zinc-800 p-3">
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="companySlug" value={slug} />
          <input
            name="title"
            required
            placeholder="New page title"
            className="min-w-[12rem] flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          />
          <select name="kind" defaultValue="vsl" className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-900">
            Create
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-normal">Page</th>
              <th className="px-4 py-2 text-left font-normal">Type</th>
              <th className="px-4 py-2 text-left font-normal">Status</th>
              <th className="px-4 py-2 text-left font-normal">Live URL</th>
            </tr>
          </thead>
          <tbody>
            {(pages || []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-zinc-500">
                  No pages yet. Create a VSL or landing page for this client.
                </td>
              </tr>
            ) : (
              (pages as StudioPage[]).map(p => {
                const path = publicPagePath(slug, p.slug);
                return (
                  <tr key={p.id} className="border-t border-zinc-800">
                    <td className="px-4 py-3">
                      <Link href={`/studio/${slug}/${p.id}`} className="font-medium text-zinc-100 hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{KIND_LABEL[p.kind as PageKind]}</td>
                    <td className="px-4 py-3">
                      <span className={p.status === "published" ? "text-emerald-400" : "text-zinc-500"}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {p.status === "published" ? (
                        <a href={`${origin}${path}`} target="_blank" rel="noreferrer" className="text-zinc-300 hover:underline">
                          {path}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
