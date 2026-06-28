-- 0008: read-only "viewer" role.
--
-- Lachlan wants to give a teammate a login that can see ALL data across every
-- client, but is NOT an exec and can NOT edit anything. There was no such role
-- before: admins see+edit everything; roster execs see+edit their own slice; a
-- plain logged-in user with neither flag sees nothing (RLS rejects every row).
--
-- Approach: add profiles.is_viewer + an is_viewer() helper, then add a SEPARATE
-- permissive SELECT policy per table granting viewers read access. Postgres
-- combines multiple permissive policies for the same command with OR, so this
-- leaves every existing admin/exec policy untouched and just widens read.
--
-- Crucially, NO insert/update/delete policy references is_viewer(), and every
-- dashboard write goes through the user's own RLS session (no service-role
-- bypass), so the database itself makes a viewer strictly read-only.
--
-- webhook_events stays admin-only (ops internals, surfaced only on the
-- admin-only /health page). profiles stays self-only (a viewer never needs to
-- read other people's profile rows).

alter table profiles add column if not exists is_viewer boolean not null default false;

-- Helper: is the current auth.uid() a read-only viewer?
create or replace function is_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_viewer from profiles where id = auth.uid()), false);
$$;

-- Additive per-table viewer read access (OR'd with existing policies).
drop policy if exists companies_viewer_select on companies;
create policy companies_viewer_select on companies for select using (is_viewer());

drop policy if exists sales_people_viewer_select on sales_people;
create policy sales_people_viewer_select on sales_people for select using (is_viewer());

drop policy if exists activities_viewer_select on activities;
create policy activities_viewer_select on activities for select using (is_viewer());

drop policy if exists won_jobs_viewer_select on won_jobs;
create policy won_jobs_viewer_select on won_jobs for select using (is_viewer());

drop policy if exists reports_viewer_select on reports;
create policy reports_viewer_select on reports for select using (is_viewer());

drop policy if exists report_deliveries_viewer_select on report_deliveries;
create policy report_deliveries_viewer_select on report_deliveries for select using (is_viewer());
