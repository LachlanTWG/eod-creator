-- 0012: One mailbox connection per exec per client (not one per exec).
--
-- mailbox_accounts is now (user_id, company_id) scoped. The same person can
-- connect Gmail for Bolton and Outlook for HDK, etc. Company is fixed on the
-- connection — attribution does not guess the client from the recipient.

-- ─── company_id ─────────────────────────────────────────────────────
alter table mailbox_accounts
  add column if not exists company_id uuid references companies(id) on delete cascade;

create index if not exists mailbox_accounts_company_idx
  on mailbox_accounts (company_id);

create index if not exists mailbox_accounts_user_idx
  on mailbox_accounts (user_id);

-- Drop old 1-per-user / 1-per-email uniques (from gmail_accounts rename).
-- Must drop CONSTRAINT first (indexes are owned by the constraint).
alter table mailbox_accounts drop constraint if exists gmail_accounts_user_id_key;
alter table mailbox_accounts drop constraint if exists gmail_accounts_email_key;
alter table mailbox_accounts drop constraint if exists mailbox_accounts_user_id_key;
alter table mailbox_accounts drop constraint if exists mailbox_accounts_email_key;
drop index if exists gmail_accounts_user_id_key;
drop index if exists gmail_accounts_email_key;
drop index if exists mailbox_accounts_user_id_key;
drop index if exists mailbox_accounts_email_key;

-- One connection per exec per client
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mailbox_accounts_user_company_key'
  ) then
    -- Only add if no conflicting rows (table empty or already unique)
    alter table mailbox_accounts
      add constraint mailbox_accounts_user_company_key unique (user_id, company_id);
  end if;
end $$;

-- Same email address may be used for multiple clients (e.g. shared alias patterns),
-- but not twice for the same client.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mailbox_accounts_email_company_key'
  ) then
    alter table mailbox_accounts
      add constraint mailbox_accounts_email_company_key unique (email, company_id);
  end if;
end $$;

-- Rows without company_id cannot be used — leave them disabled until reconnected
-- (only relevant if any pre-0012 rows exist without a company).
update mailbox_accounts
   set status = 'disabled',
       last_error = 'Reconnect required: mailbox must be bound to a client'
 where company_id is null
   and status = 'active';
