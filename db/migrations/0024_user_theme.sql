-- 0024: per-user appearance. Theme lives on profiles so it follows the
-- login, not the browser. Default dark — the original app look.

alter table profiles
  add column if not exists theme text not null default 'dark';

alter table profiles drop constraint if exists profiles_theme_check;
alter table profiles
  add constraint profiles_theme_check check (theme in ('dark', 'light'));

create or replace function set_my_theme(p_theme text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_theme not in ('dark', 'light') then
    raise exception 'invalid theme';
  end if;
  update profiles set theme = p_theme where id = auth.uid();
  if not found then
    raise exception 'not signed in';
  end if;
  return p_theme;
end;
$$;

revoke all on function set_my_theme(text) from public;
grant execute on function set_my_theme(text) to authenticated;
