-- 0007: open peer-exec visibility.
--
-- Lachlan wants Zac and Buzz to see the /execs leaderboard and drill into
-- each other's dashboards the same way an admin can. Today, RLS scopes
-- activities/won_jobs/sales_people to "own only" (or "own companies" for
-- sales_people), which means peer-exec pages render empty.
--
-- Approach: any roster exec (anyone with a sales_people.user_id row) can
-- read every other roster exec's activity + wins + sales_people +
-- companies. Owners and client-side employees stay invisible. Reports
-- remain strict-own-only (decided in 0006).

create or replace function is_roster_exec() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sales_people where user_id = auth.uid());
$$;

-- ─── activities ─────────────────────────────────────────────────────
drop policy if exists activities_select on activities;
create policy activities_select on activities for select using (
  is_admin()
  -- own rows (covers ad-hoc activity not yet linked to a roster exec)
  or sales_person_id in (select my_sales_person_ids())
  -- any other roster exec's activity, if the viewer is themselves a roster exec
  or (is_roster_exec() and sales_person_id is not null)
);

-- ─── won_jobs ────────────────────────────────────────────────────────
drop policy if exists won_jobs_select on won_jobs;
create policy won_jobs_select on won_jobs for select using (
  is_admin()
  or sales_person_id in (select my_sales_person_ids())
  or (is_roster_exec() and sales_person_id is not null)
);

-- ─── sales_people ────────────────────────────────────────────────────
-- Already allowed colleagues at own company; widen to any roster exec
-- across any company so peer-exec leaderboards and detail pages resolve
-- names + company affiliations.
drop policy if exists sales_people_select on sales_people;
create policy sales_people_select on sales_people for select using (
  is_admin()
  or company_id in (select my_company_ids())
  or is_roster_exec()
);

-- ─── companies ───────────────────────────────────────────────────────
-- Peer-exec pages need to render the company names tied to activities
-- they can now see — otherwise per-company breakdowns show "?".
drop policy if exists companies_select on companies;
create policy companies_select on companies for select using (
  is_admin()
  or id in (select my_company_ids())
  or is_roster_exec()
);
