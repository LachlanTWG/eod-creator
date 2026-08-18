import { getViewer } from "@/lib/viewer";
import { isBeta } from "@/lib/beta";
import { Sidebar, type NavItem } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const showAdminNav = viewer.isAdmin;
  const seesAll = viewer.seesAll;
  const conversionIsHome = viewer.isConversion;
  const beta = isBeta();

  const showExecsNav = viewer.canSeeExecs;
  const showTeamTools = viewer.canWriteSales;

  const navItems: NavItem[] = [];
  if (beta) {
    navItems.push({ href: "/conversion", label: "Overview", exact: true, icon: "overview" });
    navItems.push({ href: "/conversion/ads", label: "Paid ads", icon: "ads" });
    navItems.push({ href: "/conversion/setters", label: "Setters", icon: "setters" });
    navItems.push({ href: "/conversion/closers", label: "Closers", icon: "closers" });
    navItems.push({ href: "/conversion/eod", label: "EOD constraints", icon: "eod" });
    navItems.push({ href: "/conversion/eow", label: "EOW constraints", icon: "eow" });
  } else if (conversionIsHome) {
    navItems.push({ href: "/conversion", label: "My dashboard", icon: "conversion" });
  } else if (viewer.salesPersonName) {
    navItems.push({ href: `/execs/${encodeURIComponent(viewer.salesPersonName)}`, label: "My dashboard", icon: "me" });
  }
  if (!beta) {
                              navItems.push({ href: "/",           label: "Overview",                                  icon: "overview" });
  if (!conversionIsHome)      navItems.push({ href: "/conversion", label: "Conversion",                                icon: "conversion" });
                              navItems.push({ href: "/studio",     label: "Studio",                                    icon: "studio" });
  if (showExecsNav)           navItems.push({ href: "/execs",      label: "Execs",                                     icon: "execs" });
                              navItems.push({ href: "/reports",    label: "Reports",                                   icon: "reports" });
                              navItems.push({ href: "/activities", label: "Activities",                                icon: "activities" });
  if (showExecsNav)           navItems.push({ href: "/visits",     label: seesAll ? "Site visits" : "Visits",          icon: "visits" });
  if (showTeamTools)          navItems.push({ href: "/duplicates", label: "Duplicates",                                icon: "duplicates" });
  if (showAdminNav)           navItems.push({ href: "/missing",     label: "Missing info",                              icon: "missing" });
                              navItems.push({ href: "/wins",       label: "Wins pipeline",                             icon: "wins" });
                              navItems.push({ href: "/backlog",    label: "Backlog",                                   icon: "backlog" });
  if (viewer.canSeeHealth)    navItems.push({ href: "/health",     label: "Health",                                    icon: "health" });
  if (viewer.canWriteSales)   navItems.push({ href: "/settings/email", label: "Email tracking",                         icon: "gmail" });
  if (showAdminNav)           navItems.push({ href: "/settings/accounts", label: "Accounts",                            icon: "accounts" });
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
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
