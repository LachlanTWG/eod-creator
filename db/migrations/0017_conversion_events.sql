-- 0017: first-party conversion event log.
--
-- Replaces rented trackers (Hyros / Triple Whale style) with events we own.
-- Sales events are derived from activities so existing GHL / Quotie / EOD
-- writes fill the funnel automatically. VSL / landing-page pixels write
-- the same table via /api/conversion/collect (no activity row).

create table if not exists conversion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id text,
  contact_name text,
  visitor_id text,
  event text not null check (event in (
    'lead_in', 'vsl_view', 'vsl_complete', 'call',
    'quote_sent', 'site_visit', 'won', 'lost', 'email'
  )),
  source text,
  campaign text,
  page_key text,
  occurred_on date not null,
  occurred_at timestamptz not null default now(),
  activity_id uuid references activities(id) on delete set null,
  sales_person_id uuid references sales_people(id) on delete set null,
  sales_person_name text,
  value numeric,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversion_events_company_on_idx
  on conversion_events (company_id, occurred_on desc);
create index if not exists conversion_events_company_event_idx
  on conversion_events (company_id, event, occurred_on desc);
create index if not exists conversion_events_contact_idx
  on conversion_events (company_id, contact_id)
  where contact_id is not null;

create unique index if not exists conversion_events_activity_uidx
  on conversion_events (activity_id, event)
  where activity_id is not null;

create unique index if not exists conversion_events_pixel_uidx
  on conversion_events (
    company_id, event, occurred_on,
    coalesce(visitor_id, ''),
    coalesce(page_key, ''),
    coalesce(contact_id, '')
  )
  where activity_id is null;

alter table conversion_events enable row level security;

drop policy if exists conversion_events_select on conversion_events;
create policy conversion_events_select on conversion_events for select using (
  is_admin()
  or sees_all_clients()
  or company_id in (select my_company_ids())
);

-- Writes go through the trigger or the service-role collect route.
drop policy if exists conversion_events_admin_write on conversion_events;
create policy conversion_events_admin_write on conversion_events
  for all using (is_admin()) with check (is_admin());

-- ─── Map an activity row to a funnel event ──────────────────────────
create or replace function conversion_event_from_activity(
  event_type text,
  outcome text
) returns text
language plpgsql immutable as $$
declare
  o text := lower(coalesce(outcome, ''));
begin
  if event_type = 'quote_sent' then return 'quote_sent'; end if;
  if event_type = 'site_visit_booked' then return 'site_visit'; end if;
  if event_type = 'job_won' then return 'won'; end if;
  if event_type = 'email_sent' then return 'email'; end if;
  if event_type = 'eod_update' then
    if o like 'new lead%' then return 'lead_in'; end if;
    if o like '%lost%'
       or o like '%abandoned%'
       or o like '%disqualified%'
       or o like '%dq -%'
       or o like '%dq-%'
    then return 'lost'; end if;
    return 'call';
  end if;
  return null;
end;
$$;

create or replace function conversion_value_from_quote(raw text)
returns numeric
language sql immutable as $$
  select avg(n) from (
    select nullif(regexp_replace(part, '[^0-9.]', '', 'g'), '')::numeric as n
    from unnest(string_to_array(coalesce(raw, ''), '|')) as part
  ) x
  where n is not null and n > 0;
$$;

create or replace function conversion_events_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev text;
begin
  ev := conversion_event_from_activity(new.event_type, new.outcome);
  if ev is null then return new; end if;
  insert into conversion_events (
    company_id, contact_id, contact_name,
    event, source,
    occurred_on, occurred_at,
    activity_id, sales_person_id, sales_person_name,
    value, payload
  ) values (
    new.company_id, new.contact_id, new.contact_name,
    ev, nullif(trim(coalesce(new.ad_source, '')), ''),
    new.occurred_on,
    coalesce(new.occurred_at, new.created_at, now()),
    new.id, new.sales_person_id, new.sales_person_name,
    conversion_value_from_quote(new.quote_job_value),
    jsonb_build_object('activity_event', new.event_type, 'outcome', new.outcome)
  )
  on conflict (activity_id, event) where activity_id is not null
  do nothing;
  return new;
end;
$$;

drop trigger if exists activities_conversion_events on activities;
create trigger activities_conversion_events
  after insert on activities
  for each row execute function conversion_events_from_activity();

-- Backfill existing activity. ON CONFLICT needs the unique index above.
insert into conversion_events (
  company_id, contact_id, contact_name,
  event, source,
  occurred_on, occurred_at,
  activity_id, sales_person_id, sales_person_name,
  value, payload
)
select
  a.company_id, a.contact_id, a.contact_name,
  conversion_event_from_activity(a.event_type, a.outcome),
  nullif(trim(coalesce(a.ad_source, '')), ''),
  a.occurred_on,
  coalesce(a.occurred_at, a.created_at),
  a.id, a.sales_person_id, a.sales_person_name,
  conversion_value_from_quote(a.quote_job_value),
  jsonb_build_object('activity_event', a.event_type, 'outcome', a.outcome, 'backfill', true)
from activities a
where conversion_event_from_activity(a.event_type, a.outcome) is not null
on conflict (activity_id, event) where activity_id is not null
do nothing;
