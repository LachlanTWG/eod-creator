-- 0011: Multi-provider mailbox tracking (Gmail + Outlook).
-- Renames gmail_* tables, adds provider, keeps existing connected accounts as gmail.

-- ─── activities.source: allow outlook ───────────────────────────────
alter table activities drop constraint if exists activities_source_check;
alter table activities add constraint activities_source_check check (source in (
  'ghl', 'make', 'quotie', 'cli', 'sheets_backfill', 'manual', 'gmail', 'outlook'
));

-- ─── mailbox_accounts (from gmail_accounts) ─────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'gmail_accounts'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'mailbox_accounts'
  ) then
    alter table gmail_accounts rename to mailbox_accounts;
  end if;
end $$;

-- Fresh install path if 0010 was never applied under the old name
create table if not exists mailbox_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gmail'
    check (provider in ('gmail', 'outlook')),
  email text not null,
  sales_person_name text not null,
  refresh_token text not null,
  access_token text,
  token_expiry timestamptz,
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  status text not null default 'active'
    check (status in ('active', 'needs_reauth', 'disabled')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (email)
);

-- provider column (existing rows from 0010)
alter table mailbox_accounts
  add column if not exists provider text;

update mailbox_accounts set provider = 'gmail' where provider is null;

alter table mailbox_accounts
  alter column provider set default 'gmail';

-- enforce check + not null once backfilled
do $$
begin
  alter table mailbox_accounts alter column provider set not null;
exception when others then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mailbox_accounts_provider_check'
  ) then
    alter table mailbox_accounts
      add constraint mailbox_accounts_provider_check
      check (provider in ('gmail', 'outlook'));
  end if;
end $$;

-- history_id → sync_cursor (provider-agnostic: Gmail historyId or Graph deltaLink)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'mailbox_accounts' and column_name = 'history_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'mailbox_accounts' and column_name = 'sync_cursor'
  ) then
    alter table mailbox_accounts rename column history_id to sync_cursor;
  end if;
end $$;

alter table mailbox_accounts add column if not exists sync_cursor text;

drop index if exists gmail_accounts_status_idx;
create index if not exists mailbox_accounts_status_idx
  on mailbox_accounts (status) where status = 'active';
create index if not exists mailbox_accounts_provider_idx
  on mailbox_accounts (provider);

alter table mailbox_accounts enable row level security;

-- ─── contact_emails source widen ────────────────────────────────────
alter table contact_emails drop constraint if exists contact_emails_source_check;
alter table contact_emails add constraint contact_emails_source_check check (source in (
  'ghl', 'manual', 'import', 'gmail', 'outlook', 'mailbox'
));

-- ─── mailbox_unmatched (from gmail_unmatched) ───────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'gmail_unmatched'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'mailbox_unmatched'
  ) then
    alter table gmail_unmatched rename to mailbox_unmatched;
  end if;
end $$;

create table if not exists mailbox_unmatched (
  id uuid primary key default gen_random_uuid(),
  mailbox_account_id uuid not null references mailbox_accounts(id) on delete cascade,
  message_id text not null,
  occurred_at timestamptz,
  subject text,
  recipients text[] not null default '{}',
  reason text not null default 'no_contact_match',
  raw_headers jsonb,
  created_at timestamptz not null default now(),
  unique (mailbox_account_id, message_id)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'mailbox_unmatched' and column_name = 'gmail_account_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'mailbox_unmatched' and column_name = 'mailbox_account_id'
  ) then
    alter table mailbox_unmatched rename column gmail_account_id to mailbox_account_id;
  end if;
end $$;

-- Ensure FK points at mailbox_accounts after rename
do $$
begin
  alter table mailbox_unmatched
    drop constraint if exists gmail_unmatched_gmail_account_id_fkey;
  alter table mailbox_unmatched
    drop constraint if exists mailbox_unmatched_mailbox_account_id_fkey;
  alter table mailbox_unmatched
    add constraint mailbox_unmatched_mailbox_account_id_fkey
    foreign key (mailbox_account_id) references mailbox_accounts(id) on delete cascade;
exception when others then null;
end $$;

drop index if exists gmail_unmatched_account_idx;
create index if not exists mailbox_unmatched_account_idx
  on mailbox_unmatched (mailbox_account_id, created_at desc);

alter table mailbox_unmatched enable row level security;
