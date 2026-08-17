"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_LABEL, PAGE_KINDS, slugify, type PageKind } from "@/lib/studio";

function canEdit(viewer: { isAdmin: boolean; isConversion: boolean }) {
  return viewer.isAdmin || viewer.isConversion;
}

function asKind(v: string): PageKind {
  return (PAGE_KINDS as readonly string[]).includes(v) ? (v as PageKind) : "vsl";
}

export async function createStudioPage(formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!canEdit(viewer)) return;
  const companyId = String(formData.get("companyId") || "");
  const companySlug = String(formData.get("companySlug") || "");
  const title = String(formData.get("title") || "").trim();
  const kind = asKind(String(formData.get("kind") || "vsl"));
  if (!companyId || !title) return;

  const admin = createAdminClient();
  let slug = slugify(title);
  const { data: clash } = await admin
    .from("studio_pages")
    .select("id")
    .eq("company_id", companyId)
    .eq("slug", slug)
    .maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const { data, error } = await admin
    .from("studio_pages")
    .insert({
      company_id: companyId,
      kind,
      title,
      slug,
      headline: title,
      cta_label: kind === "landing" ? "Get a quote" : "Book a call",
    })
    .select("id")
    .single();
  if (error || !data) return;
  revalidatePath(`/studio/${companySlug}`);
  redirect(`/studio/${companySlug}/${data.id}`);
}

export async function saveStudioPage(formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!canEdit(viewer)) return;
  const id = String(formData.get("id") || "");
  const companySlug = String(formData.get("companySlug") || "");
  if (!id) return;

  const publish = formData.get("publish") === "1";
  const unpublish = formData.get("unpublish") === "1";
  const slug = slugify(String(formData.get("slug") || "page"));

  const patch: Record<string, unknown> = {
    title: String(formData.get("title") || "").trim() || "Untitled",
    slug,
    kind: asKind(String(formData.get("kind") || "vsl")),
    headline: empty(formData.get("headline")),
    subhead: empty(formData.get("subhead")),
    body: empty(formData.get("body")),
    video_url: empty(formData.get("videoUrl")),
    cta_label: empty(formData.get("ctaLabel")),
    cta_url: empty(formData.get("ctaUrl")),
  };
  if (publish) {
    patch.status = "published";
    patch.published_at = new Date().toISOString();
  }
  if (unpublish) {
    patch.status = "draft";
  }

  const admin = createAdminClient();
  await admin.from("studio_pages").update(patch).eq("id", id);
  revalidatePath(`/studio/${companySlug}`);
  revalidatePath(`/studio/${companySlug}/${id}`);
}

export async function deleteStudioPage(formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!canEdit(viewer)) return;
  const id = String(formData.get("id") || "");
  const companySlug = String(formData.get("companySlug") || "");
  if (!id) return;
  const admin = createAdminClient();
  await admin.from("studio_pages").delete().eq("id", id);
  revalidatePath(`/studio/${companySlug}`);
  redirect(`/studio/${companySlug}`);
}

function empty(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

export { KIND_LABEL };
