-- 0013: Default mailbox provider per client.
-- Bolton & Phased → Outlook; everyone else → Gmail (default).
-- UI uses this to pre-select provider when connecting; OAuth still allows switch.

alter table companies
  add column if not exists mailbox_provider text not null default 'gmail';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_mailbox_provider_check'
  ) then
    alter table companies
      add constraint companies_mailbox_provider_check
      check (mailbox_provider in ('gmail', 'outlook'));
  end if;
end $$;

-- Known Outlook clients
update companies
   set mailbox_provider = 'outlook'
 where slug in ('bolton-ec', 'phased-power-solutions')
    or lower(name) in ('bolton ec', 'phased power solutions');

-- Everything else stays gmail (explicit for clarity)
update companies
   set mailbox_provider = 'gmail'
 where mailbox_provider is distinct from 'outlook'
   and slug not in ('bolton-ec', 'phased-power-solutions')
   and lower(name) not in ('bolton ec', 'phased power solutions');
