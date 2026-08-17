-- 0018: paid attribution (Hyros replacement).
-- Click IDs + UTMs on events, per-client Meta connection, daily ad spend.

alter table conversion_events
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists fbclid text,
  add column if not exists gclid text,
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists ad_id text;

create index if not exists conversion_events_campaign_idx
  on conversion_events (company_id, coalesce(utm_campaign, campaign, source));

create table if not exists company_ad_accounts (
  company_id uuid primary key references companies(id) on delete cascade,
  pixel_id text,
  meta_ad_account_id text,
  meta_access_token text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table company_ad_accounts enable row level security;

create or replace function is_conversion_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select role in ('owner', 'conversion') or is_admin
    from profiles where id = auth.uid()
  ), false);
$$;

drop policy if exists company_ad_accounts_select on company_ad_accounts;
create policy company_ad_accounts_select on company_ad_accounts for select using (
  is_admin()
  or sees_all_clients()
  or is_conversion_lead()
  or company_id in (select my_company_ids())
);

drop policy if exists company_ad_accounts_write on company_ad_accounts;
create policy company_ad_accounts_write on company_ad_accounts
  for all using (is_conversion_lead()) with check (is_conversion_lead());

create table if not exists ad_spend (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null default 'meta' check (provider in ('meta', 'google', 'manual')),
  spend_on date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric not null default 0,
  impressions int not null default 0,
  clicks int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists ad_spend_day_level_uidx
  on ad_spend (
    company_id, provider, spend_on,
    coalesce(campaign_id, ''),
    coalesce(adset_id, ''),
    coalesce(ad_id, '')
  );

create index if not exists ad_spend_company_on_idx
  on ad_spend (company_id, spend_on desc);

alter table ad_spend enable row level security;

drop policy if exists ad_spend_select on ad_spend;
create policy ad_spend_select on ad_spend for select using (
  is_admin()
  or sees_all_clients()
  or company_id in (select my_company_ids())
);

drop policy if exists ad_spend_write on ad_spend;
create policy ad_spend_write on ad_spend
  for all using (is_conversion_lead()) with check (is_conversion_lead());
