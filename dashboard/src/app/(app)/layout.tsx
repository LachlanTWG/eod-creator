import { getViewer } from "@/lib/viewer";
import { Sidebar, type NavItem } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const showAdminNav = viewer.isAdmin;
  const seesAll = viewer.seesAll;
  const myHref = viewer.salesPersonName
    ? `/execs/${encodeURIComponent(viewer.salesPersonName)}`
    : "/";

  const showExecsNav = viewer.canSeeExecs;
  const showTeamTools = viewer.canWriteSales;

  const navItems: NavItem[] = [];
  if (viewer.salesPersonName) navItems.push({ href: myHref,        label: "My dashboard",                              icon: "me" });
                              navItems.push({ href: "/",           label: "Overview",                                  icon: "overview" });
  if (showExecsNav)           navItems.push({ href: "/execs",      label: "Execs",                                     icon: "execs" });
                              navItems.push({ href: "/reports",    label: "Reports",                                   icon: "reports" });
                              navItems.push({ href: "/conversion", label: "Conversion",                                icon: "conversion" });
                              navItems.push({ href: "/activities", label: "Activities",                                icon: "activities" });
  if (showExecsNav)           navItems.push({ href: "/visits",     label: seesAll ? "Site visits" : "Visits",          icon: "visits" });
  if (showTeamTools)          navItems.push({ href: "/duplicates", label: "Duplicates",                                icon: "duplicates" });
  if (showAdminNav)           navItems.push({ href: "/missing",     label: "Missing info",                              icon: "missing" });
                              navItems.push({ href: "/wins",       label: "Wins pipeline",                             icon: "wins" });
                              navItems.push({ href: "/backlog",    label: "Backlog",                                   icon: "backlog" });
  if (viewer.canSeeHealth)    navItems.push({ href: "/health",     label: "Health",                                    icon: "health" });
  if (viewer.canWriteSales)   navItems.push({ href: "/settings/email", label: "Email tracking",                         icon: "gmail" });
  if (showAdminNav)           navItems.push({ href: "/settings/accounts", label: "Accounts",                            icon: "accounts" });

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      <Sidebar
        email={viewer.user.email || ""}
        isAdmin={viewer.isAdmin}
        role={viewer.role}
        salesPersonName={viewer.salesPersonName}
        navItems={navItems}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
