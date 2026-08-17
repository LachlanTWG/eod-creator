-- 0019: Studio CMS — per-client VSL / landing / nurture pages.

create table if not exists studio_pages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('landing', 'vsl', 'pre_call', 'post_call', 'nurture')),
  title text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  headline text,
  subhead text,
  body text,
  video_url text,
  cta_label text,
  cta_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);

create index if not exists studio_pages_company_idx
  on studio_pages (company_id, updated_at desc);

alter table studio_pages enable row level security;

drop policy if exists studio_pages_select on studio_pages;
create policy studio_pages_select on studio_pages for select using (
  is_admin()
  or sees_all_clients()
  or is_conversion_lead()
  or company_id in (select my_company_ids())
);

drop policy if exists studio_pages_write on studio_pages;
create policy studio_pages_write on studio_pages
  for all using (is_conversion_lead()) with check (is_conversion_lead());

create or replace function set_studio_pages_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists studio_pages_updated_at on studio_pages;
create trigger studio_pages_updated_at
  before update on studio_pages
  for each row execute function set_studio_pages_updated_at();
