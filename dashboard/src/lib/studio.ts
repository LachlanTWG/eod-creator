export const PAGE_KINDS = ["landing", "vsl", "pre_call", "post_call", "nurture"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const KIND_LABEL: Record<PageKind, string> = {
  landing: "Landing",
  vsl: "VSL",
  pre_call: "Pre-call",
  post_call: "Post-call",
  nurture: "Nurture",
};

export type StudioPage = {
  id: string;
  company_id: string;
  kind: PageKind;
  title: string;
  slug: string;
  status: "draft" | "published";
  headline: string | null;
  subhead: string | null;
  body: string | null;
  video_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  published_at: string | null;
  updated_at: string;
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";
}

export function collectEventForKind(kind: PageKind): "vsl_view" | "lead_in" {
  return kind === "landing" ? "lead_in" : "vsl_view";
}

export function publicPagePath(companySlug: string, pageSlug: string): string {
  return `/p/${companySlug}/${pageSlug}`;
}
