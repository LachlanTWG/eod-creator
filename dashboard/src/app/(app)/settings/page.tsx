import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { AppearancePicker } from "./AppearancePicker";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const viewer = await getViewer();

  return (
    <div className="px-8 py-6 space-y-8 max-w-2xl">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Saved to your account — follows you across browsers. The EOD popup stays dark.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Appearance</h2>
        <AppearancePicker initial={viewer.theme} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Workspace</h2>
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {viewer.canWriteSales && (
            <Link href="/settings/email" className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/40">
              <div>
                <div className="text-sm text-zinc-100">Email tracking</div>
                <div className="text-[11px] text-zinc-500">Connect a mailbox so quotes and emails land in reports.</div>
              </div>
              <span className="text-xs text-zinc-500">Open →</span>
            </Link>
          )}
          {viewer.isAdmin && (
            <Link href="/settings/accounts" className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/40">
              <div>
                <div className="text-sm text-zinc-100">Accounts</div>
                <div className="text-[11px] text-zinc-500">Owner, TWG, conversion, team, and client logins.</div>
              </div>
              <span className="text-xs text-zinc-500">Open →</span>
            </Link>
          )}
          {!viewer.canWriteSales && !viewer.isAdmin && (
            <div className="px-4 py-3 text-sm text-zinc-500">No extra workspace settings on this account.</div>
          )}
        </div>
      </section>
    </div>
  );
}
