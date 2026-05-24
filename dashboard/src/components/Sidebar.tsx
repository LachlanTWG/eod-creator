"use client";

// Collapsible left sidebar. State persists via localStorage so the choice
// survives navigation + reloads. Initial render is always expanded
// (matches the SSR markup); on mount we restore the user's preference,
// which causes a one-frame width change if they had it collapsed —
// acceptable trade-off vs the alternative of a flash-of-unstyled-content
// or a cookie round-trip.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, LogOut,
  User, LayoutDashboard, Users, FileText, ListChecks, Trophy, Inbox, Activity,
} from "lucide-react";

const STORAGE_KEY = "sidebar-collapsed";

// Icon ids are plain strings so they can cross the Server → Client component
// boundary in RSC payloads. Function references (the icon components
// themselves) can't be serialised that way.
export type NavIcon =
  | "me" | "overview" | "execs" | "reports"
  | "activities" | "wins" | "backlog" | "health";

const ICONS: Record<NavIcon, typeof User> = {
  me:         User,
  overview:   LayoutDashboard,
  execs:      Users,
  reports:    FileText,
  activities: ListChecks,
  wins:       Trophy,
  backlog:    Inbox,
  health:     Activity,
};

export type NavItem = { href: string; label: string; icon: NavIcon };

export function Sidebar({
  email,
  isAdmin,
  salesPersonName,
  navItems,
}: {
  email: string;
  isAdmin: boolean;
  salesPersonName: string | null;
  navItems: NavItem[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch { /* localStorage unavailable */ }
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <aside
      className={`shrink-0 border-r border-zinc-800 flex flex-col transition-[width] duration-200 ease-out ${
        collapsed ? "w-14 px-2 py-4" : "w-56 px-4 py-6"
      } ${hydrated ? "" : ""}`}
    >
      {/* Header */}
      <div className={collapsed ? "px-1" : "px-2"}>
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight">EOD Dashboard</div>
              <div className="mt-0.5 text-xs text-zinc-500 truncate">{email}</div>
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`shrink-0 rounded border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 flex items-center justify-center ${
              collapsed ? "mx-auto h-7 w-7" : "h-6 w-6"
            }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
        {!collapsed && (isAdmin || salesPersonName) && (
          <div className="mt-2 flex gap-1.5">
            {isAdmin && (
              <span className="inline-block rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                admin
              </span>
            )}
            {salesPersonName && (
              <span className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                {salesPersonName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={`mt-6 flex flex-col gap-0.5 text-sm ${collapsed ? "items-center" : ""}`}>
        {navItems.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = ICONS[item.icon];
          if (collapsed) {
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex h-9 w-9 items-center justify-center rounded ${
                  active
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <Icon size={18} strokeWidth={1.75} />
              </Link>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded px-2 py-1.5 ${
                active
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              <Icon size={16} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <form action="/auth/signout" method="post" className="mt-auto pt-6">
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={`rounded-md border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 flex items-center justify-center ${
            collapsed
              ? "mx-auto h-9 w-9"
              : "w-full gap-2 px-3 py-1.5 text-xs"
          }`}
        >
          <LogOut size={14} strokeWidth={1.75} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </form>
    </aside>
  );
}
