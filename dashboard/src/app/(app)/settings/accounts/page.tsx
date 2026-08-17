import { getViewer, requireAdmin } from "@/lib/viewer";
import { loadAccountsPage } from "./actions";
import { AccountsManager } from "./AccountsManager";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const viewer = await getViewer();
  requireAdmin(viewer);
  const data = await loadAccountsPage();

  return (
    <div className="px-8 py-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Accounts</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Owner, TWG, conversion lead, team, leaders, and client logins. Leaders and clients are granted per company.
        </p>
      </header>
      <AccountsManager people={data.people} companies={data.companies} />
    </div>
  );
}
