import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, requireAppAccess, gateCompanySlug } from "@/lib/viewer";
import { KIND_LABEL, PAGE_KINDS, publicPagePath, type StudioPage } from "@/lib/studio";
import { deleteStudioPage, saveStudioPage } from "../../actions";

export const dynamic = "force-dynamic";

export default async function StudioEditorPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const viewer = await getViewer();
  requireAppAccess(viewer);
  const { slug, id } = await params;
  const supabase = await createClient();
  const company = await gateCompanySlug(viewer, supabase, slug);
  if (!company) notFound();

  const { data: page } = await supabase
    .from("studio_pages")
    .select("id, company_id, kind, title, slug, status, headline, subhead, body, video_url, cta_label, cta_url, published_at, updated_at")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!page) notFound();
  const p = page as StudioPage;
  const canEdit = viewer.isAdmin || viewer.isConversion;
  const origin = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://eod-creator.vercel.app";
  const live = `${origin}${publicPagePath(slug, p.slug)}`;

  return (
    <div className="px-8 py-6 space-y-6 max-w-3xl">
      <div>
        <Link href={`/studio/${slug}`} className="text-xs text-zinc-500 hover:text-zinc-300">← {company.name} studio</Link>
        <h1 className="mt-1 text-xl font-semibold">{p.title}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {p.status === "published" ? (
            <a href={live} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">{live}</a>
          ) : (
            "Draft — publish to get a live URL. UTMs and fbclid on that URL land in Conversion."
          )}
        </p>
      </div>

      <form action={saveStudioPage} className="space-y-3">
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="companySlug" value={slug} />
        <Field label="Title">
          <input name="title" defaultValue={p.title} disabled={!canEdit} className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select name="kind" defaultValue={p.kind} disabled={!canEdit} className={inputClass}>
              {PAGE_KINDS.map(k => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="URL slug">
            <input name="slug" defaultValue={p.slug} disabled={!canEdit} className={inputClass} />
          </Field>
        </div>
        <Field label="Headline">
          <input name="headline" defaultValue={p.headline || ""} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field label="Subhead">
          <input name="subhead" defaultValue={p.subhead || ""} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field label="Video URL" hint="YouTube, Vimeo, or a direct MP4.">
          <input name="videoUrl" defaultValue={p.video_url || ""} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field label="Body">
          <textarea name="body" rows={6} defaultValue={p.body || ""} disabled={!canEdit} className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CTA label">
            <input name="ctaLabel" defaultValue={p.cta_label || ""} disabled={!canEdit} className={inputClass} />
          </Field>
          <Field label="CTA URL">
            <input name="ctaUrl" defaultValue={p.cta_url || ""} disabled={!canEdit} className={inputClass} />
          </Field>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200">
              Save draft
            </button>
            {p.status !== "published" ? (
              <button type="submit" name="publish" value="1" className="rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-900">
                Publish
              </button>
            ) : (
              <button type="submit" name="unpublish" value="1" className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300">
                Unpublish
              </button>
            )}
          </div>
        )}
      </form>

      {canEdit && (
        <form action={deleteStudioPage}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="companySlug" value={slug} />
          <button type="submit" className="text-xs text-red-400/80 hover:text-red-300">Delete page</button>
        </form>
      )}
    </div>
  );
}

const inputClass = "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm disabled:opacity-60";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}
