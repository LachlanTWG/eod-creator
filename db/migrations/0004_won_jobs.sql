-- 0004: won_jobs pipeline.
--
-- Tracks each won job through the agency revenue pipeline:
--   verbal_confirmation → client_approved → invoiced → paid
--
-- One row per agency invoice (typically one per won job, but a single job
-- can spawn a retainer + a commission, or be 50/50 split between execs
-- producing two rows). Each row attributes the win to ONE exec.
--
-- amounts:
--   job_value          — what the client charges their customer (homeowner)
--   commission_amount  — what we invoice the client. Drives "money down".

create table won_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  sales_person_id uuid references sales_people(id),
  source_activity_id uuid references activities(id),   -- optional link back to Job Won activity

  contact_name text,
  contact_address text,
  contact_id text,

  job_value numeric(12, 2),
  commission_amount numeric(12, 2),

  type text not null default 'comms'
    check (type in ('comms', 'retainer', 'other')),

  stage text not null
    check (stage in ('verbal_confirmation', 'client_approved', 'invoiced', 'paid')),

  verbal_at   timestamptz,
  approved_at timestamptz,
  invoiced_at timestamptz,
  paid_at     timestamptz,

  invoice_number text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index won_jobs_company_stage_idx on won_jobs (company_id, stage);
create index won_jobs_sales_person_idx  on won_jobs (sales_person_id);
create index won_jobs_invoiced_at_idx   on won_jobs (invoiced_at desc nulls last);
create index won_jobs_paid_at_idx       on won_jobs (paid_at desc nulls last);

alter table won_jobs enable row level security;

-- Same access model as activities:
--   admin can read / write any row
--   exec can read / write rows where sales_person_id is one of theirs
create policy won_jobs_select on won_jobs for select using (
  is_admin() or sales_person_id in (select my_sales_person_ids())
);

create policy won_jobs_insert on won_jobs for insert with check (
  is_admin() or sales_person_id in (select my_sales_person_ids())
);

create policy won_jobs_update on won_jobs for update
  using (
    is_admin() or sales_person_id in (select my_sales_person_ids())
  )
  with check (
    is_admin() or sales_person_id in (select my_sales_person_ids())
  );

create policy won_jobs_delete on won_jobs for delete using (
  is_admin() or sales_person_id in (select my_sales_person_ids())
);

-- updated_at auto-bump
create or replace function set_won_jobs_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger won_jobs_updated_at
before update on won_jobs
for each row execute function set_won_jobs_updated_at();

-- Stream changes to subscribers (matches activities)
alter publication supabase_realtime add table won_jobs;
