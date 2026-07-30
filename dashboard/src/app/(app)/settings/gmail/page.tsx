import { redirect } from "next/navigation";

/** Old path — email tracking is multi-provider at /settings/email. */
export default async function GmailSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
  }
  const qs = q.toString();
  redirect(qs ? `/settings/email?${qs}` : "/settings/email");
}
