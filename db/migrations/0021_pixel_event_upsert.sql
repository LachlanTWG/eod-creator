-- 0021: record Studio / landing-page pixel hits without raising on the
-- daily unique index (conversion_events_pixel_uidx).
--
-- That index is the anti-double-count: one (company, event, day, visitor,
-- page, contact) row. React remounts, refreshes and Strict Mode fire the
-- pixel twice; INSERT then logged as a unique-violation. Swallow it here.

create or replace function record_pixel_conversion(
  p_company_id uuid,
  p_event text,
  p_occurred_on date,
  p_contact_id text default null,
  p_contact_name text default null,
  p_visitor_id text default null,
  p_source text default null,
  p_campaign text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_fbclid text default null,
  p_gclid text default null,
  p_campaign_id text default null,
  p_adset_id text default null,
  p_ad_id text default null,
  p_page_key text default null,
  p_value numeric default null,
  p_payload jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into conversion_events (
    company_id, event, occurred_on,
    contact_id, contact_name, visitor_id,
    source, campaign, page_key, value, payload,
    utm_source, utm_medium, utm_campaign, utm_content,
    fbclid, gclid, campaign_id, adset_id, ad_id
  ) values (
    p_company_id, p_event, p_occurred_on,
    p_contact_id, p_contact_name, p_visitor_id,
    p_source, p_campaign, p_page_key, p_value, p_payload,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content,
    p_fbclid, p_gclid, p_campaign_id, p_adset_id, p_ad_id
  )
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function record_pixel_conversion(
  uuid, text, date, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, numeric, jsonb
) from public;

grant execute on function record_pixel_conversion(
  uuid, text, date, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, numeric, jsonb
) to service_role;
