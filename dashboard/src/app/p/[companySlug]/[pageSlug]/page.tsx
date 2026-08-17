import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectEventForKind, type PageKind, type StudioPage } from "@/lib/studio";
import { StudioTracker } from "./StudioTracker";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ companySlug: string; pageSlug: string }>;
}) {
  const { companySlug, pageSlug } = await params;
  const admin = createAdminClient();
  const { data: company } = await admin.from("companies").select("id, name").eq("slug", companySlug).maybeSingle();
  if (!company) return { title: "Page" };
  const { data: page } = await admin
    .from("studio_pages")
    .select("title, headline")
    .eq("company_id", company.id)
    .eq("slug", pageSlug)
    .eq("status", "published")
    .maybeSingle();
  return { title: page?.headline || page?.title || company.name };
}

export default async function PublicStudioPage({
  params,
}: {
  params: Promise<{ companySlug: string; pageSlug: string }>;
}) {
  const { companySlug, pageSlug } = await params;
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, name, slug")
    .eq("slug", companySlug)
    .eq("active", true)
    .maybeSingle();
  if (!company) notFound();

  const { data: page } = await admin
    .from("studio_pages")
    .select("id, company_id, kind, title, slug, status, headline, subhead, body, video_url, cta_label, cta_url, published_at, updated_at")
    .eq("company_id", company.id)
    .eq("slug", pageSlug)
    .eq("status", "published")
    .maybeSingle();
  if (!page) notFound();
  const p = page as StudioPage;

  const { data: acct } = await admin
    .from("company_ad_accounts")
    .select("pixel_id")
    .eq("company_id", company.id)
    .maybeSingle();

  const embed = videoEmbed(p.video_url);

  return (
    <div className="min-h-screen bg-[#0b0a09] text-[#f4efe6]">
      <StudioTracker
        companySlug={company.slug}
        pageKey={p.slug}
        event={collectEventForKind(p.kind as PageKind)}
        pixelId={acct?.pixel_id || null}
        ctaSelector="#studio-cta"
      />
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16 md:py-24">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#c4a574]">{company.name}</p>
        <h1 className="mt-4 font-serif text-4xl leading-[1.1] tracking-tight md:text-6xl">
          {p.headline || p.title}
        </h1>
        {p.subhead && (
          <p className="mt-5 max-w-xl text-lg text-[#d7d0c4]/80">{p.subhead}</p>
        )}

        {embed && (
          <div className="mt-10 overflow-hidden rounded-lg border border-white/10 bg-black aspect-video">
            {embed.type === "iframe" ? (
              <iframe
                src={embed.src}
                title={p.title}
                className="h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={embed.src} controls playsInline className="h-full w-full" />
            )}
          </div>
        )}

        {p.body && (
          <div className="mt-10 whitespace-pre-wrap text-[17px] leading-relaxed text-[#d7d0c4]/90">
            {p.body}
          </div>
        )}

        {p.cta_label && (
          <a
            id="studio-cta"
            href={p.cta_url || "#"}
            className="mt-12 inline-flex w-fit items-center rounded-full bg-[#c4a574] px-7 py-3 text-sm font-semibold tracking-wide text-[#1a140c] hover:bg-[#d4b888]"
          >
            {p.cta_label}
          </a>
        )}
      </main>
    </div>
  );
}

function videoEmbed(url: string | null): { type: "iframe" | "file"; src: string } | null {
  if (!url) return null;
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/);
  if (yt) return { type: "iframe", src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { type: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  return { type: "file", src: url };
}
