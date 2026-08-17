-- 0016: The Sales Department accounts layer.
--
-- Replaces "every roster exec sees every client" (0007/0009) with
-- company-scoped access plus explicit org roles:
--   owner      — Lachlan. Everything.
--   twg        — TWG operator login. Default: all clients, read-only, no health.
--   conversion — Conversion lead. Assigned clients only.
--   team       — Sales execs. Rostered clients only.
--   client     — Client-facing. Their company only, read-only.
--
-- Leaders are a *company* grant (company_memberships.access = 'leader'),
-- not a second org role — a person can lead one book and sit on another.
--
-- is_admin / is_viewer stay in sync so existing policies keep working.
-- The exec-wide SELECT policies from 0007/0009 are dropped.

-- ─── Profile role ───────────────────────────────────────────────────
alter table profiles
  add column if not exists role text not null default 'team';

alter table profiles
  drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('owner', 'twg', 'conversion', 'team', 'client'));

alter table profiles
  add column if not exists twg_see_all_clients boolean not null default true;

update profiles set role = 'owner' where is_admin = true;
update profiles set role = 'twg', twg_see_all_clients = true
  where is_viewer = true and is_admin = false;
update profiles set role = 'team'
  where is_admin = false and is_viewer = false and role = 'team';

-- Keep legacy flags aligned when role is written.
create or replace function sync_profile_role_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_admin := (new.role = 'owner');
  new.is_viewer := (new.role = 'twg');
  return new;
end;
$$;

drop trigger if exists profiles_sync_role_flags on profiles;
create trigger profiles_sync_role_flags
  before insert or update of role on profiles
  for each row execute function sync_profile_role_flags();

-- ─── Company grants ─────────────────────────────────────────────────
create table if not exists company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  access text not null check (access in ('leader', 'conversion', 'member', 'client', 'twg')),
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create index if not exists company_memberships_user_idx
  on company_memberships (user_id);
create index if not exists company_memberships_company_idx
  on company_memberships (company_id);

alter table company_memberships enable row level security;

-- ─── Helpers ────────────────────────────────────────────────────────
create or replace function sees_all_clients() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select is_admin
        or is_viewer
        or role = 'owner'
        or (role = 'twg' and twg_see_all_clients)
    from profiles
    where id = auth.uid()
  ), false);
$$;

-- Roster (active) + explicit memberships. Owner/TWG-all do not need rows here;
-- policies OR with sees_all_clients().
create or replace function my_company_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id
  from sales_people
  where user_id = auth.uid() and active = true
  union
  select company_id
  from company_memberships
  where user_id = auth.uid();
$$;

-- ─── Drop exec-wide reads ───────────────────────────────────────────
drop policy if exists activities_exec_select on activities;
drop policy if exists reports_exec_select on reports;
drop policy if exists report_deliveries_exec_select on report_deliveries;

-- ─── Recreate scoped SELECT policies ────────────────────────────────
drop policy if exists companies_select on companies;
create policy companies_select on companies for select using (
  is_admin()
  or sees_all_clients()
  or id in (select my_company_ids())
);

drop policy if exists sales_people_select on sales_people;
create policy sales_people_select on sales_people for select using (
  is_admin()
  or sees_all_clients()
  or company_id in (select my_company_ids())
);

drop policy if exists activities_select on activities;
create policy activities_select on activities for select using (
  is_admin()
  or sees_all_clients()
  or sales_person_id in (select my_sales_person_ids())
  or company_id in (select my_company_ids())
);

drop policy if exists won_jobs_select on won_jobs;
create policy won_jobs_select on won_jobs for select using (
  is_admin()
  or sees_all_clients()
  or sales_person_id in (select my_sales_person_ids())
  or company_id in (select my_company_ids())
);

drop policy if exists reports_select on reports;
create policy reports_select on reports for select using (
  is_admin()
  or sees_all_clients()
  or sales_person_id in (select my_sales_person_ids())
  or company_id in (select my_company_ids())
);

drop policy if exists report_deliveries_select on report_deliveries;
create policy report_deliveries_select on report_deliveries for select using (
  exists (
    select 1 from reports r
    where r.id = report_id and (
      is_admin()
      or sees_all_clients()
      or r.company_id in (select my_company_ids())
      or r.sales_person_id in (select my_sales_person_ids())
    )
  )
);

drop policy if exists pending_site_visits_exec_select on pending_site_visits;
create policy pending_site_visits_exec_select on pending_site_visits
  for select using (
    is_admin()
    or sees_all_clients()
    or company_id in (select my_company_ids())
  );

-- ─── Memberships + profile admin writes ─────────────────────────────
drop policy if exists company_memberships_select on company_memberships;
create policy company_memberships_select on company_memberships for select using (
  is_admin() or user_id = auth.uid()
);

drop policy if exists company_memberships_write on company_memberships;
create policy company_memberships_write on company_memberships
  for all using (is_admin()) with check (is_admin());

drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update using (is_admin()) with check (is_admin());

-- New signups stay team until an owner assigns otherwise.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.raw_user_meta_data->>'role', 'team')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
