// Shared live messages panel — renders the period tabs + per-company /
// per-team cards. Used by /me (viewer's own dashboard) and /execs/[name]
// (admin viewing any exec; exec viewing their own).
//
// Server component — pulls the data on render. Wrap with <LiveRefresh /> at
// the page level to get realtime re-render on activity changes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDashboardMessages } from "@/lib/messages";
import { LiveMessage } from "@/components/LiveMessage";
import { PeriodTabs } from "@/components/PeriodTabs";
import type { Period } from "@/lib/dates";

export async function LiveMessagesPanel({
  supabase,
  period,
  targetExecName,
  targetSalesPersonIds,
  targetCompanyIds,
  isAdmin,
  basePath,
}: {
  supabase: SupabaseClient;
  period: Period;
  targetExecName: string | null;             // null if no exec linked (admin only)
  targetSalesPersonIds: Set<string>;
  targetCompanyIds: Set<string>;
  isAdmin: boolean;
  basePath: string;                           // for period tab links (e.g. "/me" or "/execs/Zac")
}) {
  const messages = await loadDashboardMessages(supabase, {
    period,
    mySalesPersonIds: targetSalesPersonIds,
    myCompanyIds: targetCompanyIds,
    myDisplayName: targetExecName || "Team",
  });

  const onRoster = messages.perCompany.filter(c => targetCompanyIds.has(c.company.id));
  const offRoster = messages.perCompany.filter(c => !targetCompanyIds.has(c.company.id));
  const ordered = [...onRoster, ...offRoster];

  return (
    <>
      <PeriodTabs basePath={basePath} active={period} />

      {targetSalesPersonIds.size > 0 && (
        <section className="mt-6">
          <SectionHeader
            title={targetExecName ? `${targetExecName}'s activity` : "Personal"}
            subtitle="Per company, scoped to this exec."
          />
          <CardRow>
            {ordered
              .filter(c => targetCompanyIds.has(c.company.id))
              .map(c => (
                <LiveMessage key={`p-${c.company.id}`} data={c.personal} variant="hero" />
              ))}
            {messages.personalTotal && (
              <LiveMessage key="p-total" data={messages.personalTotal} variant="hero" />
            )}
          </CardRow>
        </section>
      )}

      <section className="mt-8">
        <SectionHeader
          title="Team"
          subtitle={isAdmin ? "Every exec across every active company." : "Limited to what RLS lets you see."}
        />
        <CardRow>
          {ordered.map(c => (
            <LiveMessage key={`t-${c.company.id}`} data={c.team} variant="hero" />
          ))}
          {messages.grandTotal && (
            <LiveMessage key="t-total" data={messages.grandTotal} variant="hero" />
          )}
        </CardRow>
      </section>
    </>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      {subtitle && <span className="text-xs text-zinc-500">{subtitle}</span>}
    </div>
  );
}

function CardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {children}
    </div>
  );
}
