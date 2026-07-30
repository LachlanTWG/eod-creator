-- 0010: Native Gmail email tracking (Option B).
--
-- One OAuth-connected mailbox per exec replaces N×M Make "watch sent"
-- scenarios. Sent mail is attributed to a client via contact_emails
-- (recipient address → company). Activities land as email_sent with
-- source='gmail' and source_row_id = Gmail message id (idempotent).

-- ─── activities.source: allow gmail ─────────────────────────────────
alter table activities drop constraint if exists activities_source_check;
alter table activities add constraint activities_source_check check (source in (
  'ghl', 'make', 'quotie', 'cli', 'sheets_backfill', 'manual', 'gmail'
));

-- ─── gmail_accounts ─────────────────────────────────────────────────
-- One connected mailbox per auth user. Tokens are service-role only
-- (no client policies — dashboard uses admin client for own-row reads).
create table if not exists gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  -- Canonical short roster name ("Lachlan", "Buzz", …) used on activities
  sales_person_name text not null,
  refresh_token text not null,
  access_token text,
  token_expiry timestamptz,
  -- Gmail History API cursor for incremental sync
  history_id text,
  last_synced_at timestamptz,
  last_error text,
  status text not null default 'active'
    check (status in ('active', 'needs_reauth', 'disabled')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (email)
);

create index if not exists gmail_accounts_status_idx
  on gmail_accounts (status) where status = 'active';

alter table gmail_accounts enable row level security;
-- No policies for authenticated role: only service role (Node + admin client).

-- ─── contact_emails ─────────────────────────────────────────────────
-- Recipient → company map. Populated from GHL webhooks (and optional backfill).
-- email is stored lowercased. Same address may exist under multiple companies
-- (rare); attribution prefers companies the sending exec is rostered on.
create table if not exists contact_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  contact_name text,
  contact_id text,
  source text not null default 'ghl'
    check (source in ('ghl', 'manual', 'import', 'gmail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create index if not exists contact_emails_email_idx on contact_emails (email);
create index if not exists contact_emails_contact_id_idx
  on contact_emails (contact_id) where contact_id is not null;

alter table contact_emails enable row level security;

create policy contact_emails_select on contact_emails for select using (
  is_admin() or company_id in (select my_company_ids())
);

-- ─── gmail_unmatched ────────────────────────────────────────────────
-- Sent messages that couldn't be attributed to a known contact email.
-- Keeps personal/noise mail out of EODs while still reviewable.
create table if not exists gmail_unmatched (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references gmail_accounts(id) on delete cascade,
  message_id text not null,
  occurred_at timestamptz,
  subject text,
  recipients text[] not null default '{}',
  reason text not null default 'no_contact_match',
  raw_headers jsonb,
  created_at timestamptz not null default now(),
  unique (gmail_account_id, message_id)
);

create index if not exists gmail_unmatched_account_idx
  on gmail_unmatched (gmail_account_id, created_at desc);

alter table gmail_unmatched enable row level security;
-- Service role only (no client policies).
