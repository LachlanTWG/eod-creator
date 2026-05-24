// Set / change password. Reached after the auth callback for a recovery
// email or invite acceptance — the user already has a session at this
// point, so we just need to capture a new password and call updateUser.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function updatePassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") || "");
  const confirm  = String(formData.get("confirm")  || "");

  if (password.length < 8) {
    redirect("/auth/update-password?error=Password+must+be+at+least+8+characters");
  }
  if (password !== confirm) {
    redirect("/auth/update-password?error=Passwords+don%27t+match");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/auth/update-password?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/");
}

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;

  // If they got here without a session (e.g. opened the URL directly), send
  // them to /login — updateUser would fail anyway.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Set your password</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as {user.email}. Pick a new password — at least 8 characters.
          </p>
        </div>

        <form action={updatePassword} className="space-y-3">
          <input
            type="password"
            name="password"
            required
            autoFocus
            minLength={8}
            autoComplete="new-password"
            placeholder="new password"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="confirm password"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Save password
          </button>
        </form>

        {error && (
          <div className="rounded-md border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
