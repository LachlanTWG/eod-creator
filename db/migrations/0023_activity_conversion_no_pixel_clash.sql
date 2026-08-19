-- 0023: activity edits/deletes must not collide with conversion_events_pixel_uidx.
--
-- What went wrong:
--   conversion_events.activity_id is ON DELETE SET NULL. Deleting (or
--   replacing) an activity left a conversion row with activity_id NULL.
--   Those orphans occupy the pixel unique index (company, event, day,
--   visitor, page, contact) — the same key a later activity write or
--   pixel hit uses. Edit/save then fails with conversion_events_pixel_uidx
--   even though this is an EOD row, not a Studio pixel.
--
-- Fix:
--   1. Pixel uniqueness only applies to real pixels (visitor_id or page_key).
--   2. Deleting an activity cascades the conversion row instead of orphaning it.
--   3. Keep conversion_events in sync on UPDATE, and never fail the activity
--      write if a conversion unique index still fires.
--   4. Drop the existing activity-derived orphans.

drop index if exists conversion_events_pixel_uidx;
create unique index conversion_events_pixel_uidx
  on conversion_events (
    company_id, event, occurred_on,
    coalesce(visitor_id, ''),
    coalesce(page_key, ''),
    coalesce(contact_id, '')
  )
  where activity_id is null
    and (visitor_id is not null or page_key is not null);

alter table conversion_events drop constraint conversion_events_activity_id_fkey;
alter table conversion_events
  add constraint conversion_events_activity_id_fkey
  foreign key (activity_id) references activities(id) on delete cascade;

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

  if tg_op = 'UPDATE' then
    delete from conversion_events where activity_id = new.id;
  end if;

  if ev is null then return new; end if;

  begin
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
    do update set
      company_id = excluded.company_id,
      contact_id = excluded.contact_id,
      contact_name = excluded.contact_name,
      source = excluded.source,
      occurred_on = excluded.occurred_on,
      occurred_at = excluded.occurred_at,
      sales_person_id = excluded.sales_person_id,
      sales_person_name = excluded.sales_person_name,
      value = excluded.value,
      payload = excluded.payload;
  exception
    when unique_violation then
      null;
  end;
  return new;
end;
$$;

drop trigger if exists activities_conversion_events on activities;
create trigger activities_conversion_events
  after insert or update on activities
  for each row execute function conversion_events_from_activity();

delete from conversion_events
where activity_id is null
  and visitor_id is null
  and page_key is null
  and payload ? 'activity_event';
