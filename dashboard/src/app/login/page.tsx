import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email || !password) redirect("/login?error=missing-credentials");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">EOD Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to continue.</p>
        </div>

        <form action={signIn} className="space-y-3">
          <input
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@tradiewebguys.com.au"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="password"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Log in
          </button>
        </form>

        {error && (
          <div className="rounded-md border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <p className="text-xs text-zinc-500">
          Accounts are managed in the Supabase dashboard. Ask Lachlan if you
          need access.
        </p>
      </div>
    </main>
  );
}
