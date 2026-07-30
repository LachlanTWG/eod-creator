-- 0014: Pending site visits from GHL calendar bookings.
-- Calendar webhook creates a lightweight "to-log" row; the EOD popup is where
-- execs fill address/comment and Log once → real site_visit_booked activity.
-- Pending rows stay visible until resolved (or dismissed).

create table if not exists pending_site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  contact_id text,
  contact_name text,
  contact_address text,
  sales_person_name text,

  -- Original appointment string from GHL + parsed instant when we can parse it
  appointment_raw text,
  appointment_at timestamptz,

  source text not null default 'ghl',
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_activity_id uuid references activities(id) on delete set null,
  dismissed_at timestamptz
);

-- Open queue for a client (popup banner)
create index if not exists pending_site_visits_open_company_idx
  on pending_site_visits (company_id, created_at desc)
  where resolved_at is null and dismissed_at is null;

-- Prefer matching open rows for the contact the exec is looking at
create index if not exists pending_site_visits_open_contact_idx
  on pending_site_visits (company_id, contact_id)
  where resolved_at is null and dismissed_at is null and contact_id is not null;

-- Soft-dedupe: one open pending per company + contact + appointment_raw
create unique index if not exists pending_site_visits_open_dedup_uidx
  on pending_site_visits (
    company_id,
    coalesce(contact_id, ''),
    coalesce(appointment_raw, '')
  )
  where resolved_at is null and dismissed_at is null;

alter table pending_site_visits enable row level security;

-- Dashboard popup uses the service-role admin client (bypasses RLS).
-- Keep policies for any future session-based reads.
drop policy if exists pending_site_visits_admin_all on pending_site_visits;
create policy pending_site_visits_admin_all on pending_site_visits
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists pending_site_visits_exec_select on pending_site_visits;
create policy pending_site_visits_exec_select on pending_site_visits
  for select using (
    exists (
      select 1 from sales_people sp
      where sp.user_id = auth.uid() and sp.active = true
    )
  );
