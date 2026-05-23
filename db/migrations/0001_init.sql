-- EOD Creator initial schema
-- Run via: supabase db push   (or psql -f against $DATABASE_URL)
--
-- Conventions:
--   * IDs are uuid, generated client-side or via gen_random_uuid().
--   * Timestamps are timestamptz, stored UTC.
--   * occurred_on is the date in company TZ (matches what sheets store).
--   * Money values stay text — quote_job_value can be pipe-delimited.
--   * raw_payload preserves the original webhook body for audit / replay.

create extension if not exists "pgcrypto";

-- ─── profiles ───────────────────────────────────────────────────────
-- Joins auth.users to our app. is_admin grants full read.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── companies ──────────────────────────────────────────────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  owner_name text,
  timezone text not null default 'Australia/Sydney',
  ghl_location_id text unique,
  sheet_id text,                          -- legacy Google Sheet (dual-write target)
  clickup_workspace_id text,
  clickup_chat_channel_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_active_idx on companies (active) where active = true;

-- ─── sales_people ───────────────────────────────────────────────────
create table sales_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,  -- links exec to their login
  name text not null,
  active boolean not null default true,
  start_date date,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create index sales_people_company_idx on sales_people (company_id);
create index sales_people_user_idx on sales_people (user_id) where user_id is not null;

-- ─── activities ─────────────────────────────────────────────────────
-- The unified event stream. Replaces the per-company Activity Log sheet tab.
create table activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sales_person_id uuid references sales_people(id) on delete set null,
  sales_person_name text not null,         -- denormalised; survives sales_person deletion

  occurred_on date not null,               -- date in company TZ (what sheet has)
  occurred_at timestamptz,                 -- precise time, when known

  event_type text not null check (event_type in (
    'eod_update', 'job_won', 'site_visit_booked', 'quote_sent', 'email_sent'
  )),

  contact_name text,
  contact_id text,
  contact_address text,
  outcome text,
  ad_source text,
  quote_job_value text,                    -- pipe-delimited as today
  appointment_at timestamptz,

  source text not null check (source in (
    'ghl', 'make', 'quotie', 'cli', 'sheets_backfill', 'manual'
  )),
  source_row_id text,                      -- e.g. sheet row number for backfill idempotency
  raw_payload jsonb,                       -- original webhook body
  created_at timestamptz not null default now(),

  unique (company_id, source, source_row_id)  -- backfill / replay idempotency
);

create index activities_company_date_idx on activities (company_id, occurred_on);
create index activities_company_person_date_idx on activities (company_id, sales_person_id, occurred_on);
create index activities_event_date_idx on activities (event_type, occurred_on);
create index activities_created_idx on activities (created_at desc);

-- ─── reports ────────────────────────────────────────────────────────
-- Archived report snapshots. Replaces the per-company storage tabs.
create table reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sales_person_id uuid references sales_people(id) on delete set null,
  sales_person_name text not null,         -- 'Team' for team report

  report_type text not null check (report_type in (
    'eod', 'eow', 'eom', 'eoq', 'eoy'
  )),
  period_start date not null,
  period_end date not null,

  formatted_text text not null,            -- the Slack/ClickUp message body
  counts jsonb,
  names jsonb,
  efficiency_rates jsonb,

  created_at timestamptz not null default now(),

  unique (company_id, sales_person_name, report_type, period_start, period_end)
);

create index reports_company_type_period_idx on reports (company_id, report_type, period_start desc);

-- ─── report_deliveries ──────────────────────────────────────────────
create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  channel text not null check (channel in ('slack', 'clickup')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  payload jsonb,
  sent_at timestamptz not null default now()
);

create index report_deliveries_report_idx on report_deliveries (report_id);

-- ─── webhook_events ─────────────────────────────────────────────────
-- Audit log of every inbound webhook hit. Powers the health page.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  method text not null,
  status int not null,
  ip text,
  body jsonb,
  error text,
  received_at timestamptz not null default now()
);

create index webhook_events_received_idx on webhook_events (received_at desc);
create index webhook_events_path_idx on webhook_events (path, received_at desc);

-- ─── RLS ────────────────────────────────────────────────────────────
-- Admins see everything. Execs see only their own company + own rows.
-- Service role bypasses RLS (used by the Node service for writes).

alter table profiles enable row level security;
alter table companies enable row level security;
alter table sales_people enable row level security;
alter table activities enable row level security;
alter table reports enable row level security;
alter table report_deliveries enable row level security;
alter table webhook_events enable row level security;

-- Helper: is the current auth.uid() an admin?
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Helper: companies the current user belongs to (via sales_people)
create or replace function my_company_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id from sales_people where user_id = auth.uid();
$$;

-- Helper: sales_people rows owned by the current user
create or replace function my_sales_person_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from sales_people where user_id = auth.uid();
$$;

-- profiles: users see their own profile; admins see all
create policy profiles_select on profiles for select using (
  id = auth.uid() or is_admin()
);

-- companies: admins all; execs only companies they belong to
create policy companies_select on companies for select using (
  is_admin() or id in (select my_company_ids())
);

-- sales_people: admins all; execs see colleagues in their company
create policy sales_people_select on sales_people for select using (
  is_admin() or company_id in (select my_company_ids())
);

-- activities: admins all; execs see only their own activities
create policy activities_select on activities for select using (
  is_admin() or sales_person_id in (select my_sales_person_ids())
);

-- reports: admins all; execs see reports they're in (and team reports for their company)
create policy reports_select on reports for select using (
  is_admin()
  or sales_person_id in (select my_sales_person_ids())
  or (sales_person_name = 'Team' and company_id in (select my_company_ids()))
);

-- report_deliveries: visible to whoever can see the parent report
create policy report_deliveries_select on report_deliveries for select using (
  exists (select 1 from reports r where r.id = report_id and (
    is_admin()
    or r.sales_person_id in (select my_sales_person_ids())
    or (r.sales_person_name = 'Team' and r.company_id in (select my_company_ids()))
  ))
);

-- webhook_events: admin-only
create policy webhook_events_select on webhook_events for select using (is_admin());

-- ─── Realtime ───────────────────────────────────────────────────────
-- Publish the tables the dashboard subscribes to.
alter publication supabase_realtime add table activities;
alter publication supabase_realtime add table reports;
alter publication supabase_realtime add table webhook_events;
