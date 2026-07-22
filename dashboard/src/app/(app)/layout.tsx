import { getViewer } from "@/lib/viewer";
import { Sidebar, type NavItem } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const showAdminNav = viewer.isAdmin;
  // Every role sees every client's data now (admins, viewers, roster execs),
  // so all-clients surfaces and "all" labels gate on this.
  const seesAll = viewer.seesAll;
  const myHref = viewer.salesPersonName
    ? `/execs/${encodeURIComponent(viewer.salesPersonName)}`
    : "/";

  // Roster execs (Zac, Buzz, etc.) can see the /execs leaderboard now, as can
  // read-only viewers — so the link gates on isAdmin OR viewer OR exec.
  const showExecsNav = viewer.isAdmin || viewer.isViewer || !!viewer.salesPersonName;

  const navItems: NavItem[] = [];
  if (viewer.salesPersonName) navItems.push({ href: myHref,        label: "My dashboard",                              icon: "me" });
  if (seesAll)                navItems.push({ href: "/",           label: "Overview",                                  icon: "overview" });
  if (showExecsNav)           navItems.push({ href: "/execs",      label: "Execs",                                     icon: "execs" });
                              navItems.push({ href: "/reports",    label: "Reports",                                   icon: "reports" });
                              navItems.push({ href: "/activities", label: "Activities",                                icon: "activities" });
  if (showExecsNav)           navItems.push({ href: "/visits",     label: seesAll ? "Site visits" : "My visits",       icon: "visits" });
  if (showAdminNav)           navItems.push({ href: "/duplicates", label: "Duplicates",                                icon: "duplicates" });
  if (showAdminNav)           navItems.push({ href: "/missing",     label: "Missing info",                              icon: "missing" });
                              navItems.push({ href: "/wins",       label: "Wins pipeline",                             icon: "wins" });
                              navItems.push({ href: "/backlog",    label: seesAll ? "Backlog" : "My backlog",          icon: "backlog" });
  if (showAdminNav)           navItems.push({ href: "/health",     label: "Health",                                    icon: "health" });

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      <Sidebar
        email={viewer.user.email || ""}
        isAdmin={viewer.isAdmin}
        salesPersonName={viewer.salesPersonName}
        navItems={navItems}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
