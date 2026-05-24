import Link from "next/link";
import { getViewer } from "@/lib/viewer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const showAdminNav = viewer.isAdmin;
  const myHref = viewer.salesPersonName
    ? `/execs/${encodeURIComponent(viewer.salesPersonName)}`
    : "/";

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-800 px-4 py-6 flex flex-col">
        <div className="px-2">
          <div className="text-sm font-semibold tracking-tight">EOD Dashboard</div>
          <div className="mt-0.5 text-xs text-zinc-500 truncate">{viewer.user.email}</div>
          <div className="mt-2 flex gap-1.5">
            {viewer.isAdmin && (
              <span className="inline-block rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                admin
              </span>
            )}
            {viewer.salesPersonName && (
              <span className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                {viewer.salesPersonName}
              </span>
            )}
          </div>
        </div>

        <nav className="mt-6 flex flex-col gap-0.5 text-sm">
          {viewer.salesPersonName && <NavLink href={myHref}>My dashboard</NavLink>}
          {showAdminNav && <NavLink href="/">Overview</NavLink>}
          {showAdminNav && <NavLink href="/execs">Execs</NavLink>}
          <NavLink href="/reports">Reports</NavLink>
          <NavLink href="/activities">Activities</NavLink>
          <NavLink href="/wins">Wins pipeline</NavLink>
          <NavLink href="/backlog">{showAdminNav ? "Backlog" : "My backlog"}</NavLink>
          {showAdminNav && <NavLink href="/health">Health</NavLink>}
        </nav>

        <form action="/auth/signout" method="post" className="mt-auto pt-6">
          <button className="w-full rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200">
            Sign out
          </button>
        </form>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded px-2 py-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
    >
      {children}
    </Link>
  );
}
