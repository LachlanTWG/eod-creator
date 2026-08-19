"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE, THEME_COOKIE_OPTS, type Theme } from "@/lib/theme";

export type ActionResult = { ok: true; theme: Theme } | { ok: false; error: string };

export async function saveTheme(raw: string): Promise<ActionResult> {
  const theme = parseTheme(raw);
  if (raw !== "dark" && raw !== "light") {
    return { ok: false, error: "Pick dark or light" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.rpc("set_my_theme", { p_theme: theme });
  if (error) return { ok: false, error: error.message };

  const jar = await cookies();
  jar.set(THEME_COOKIE, theme, THEME_COOKIE_OPTS);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, theme };
}
