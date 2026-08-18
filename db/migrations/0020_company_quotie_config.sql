-- 0020: Per-client Quotie integration config.
--
-- Stores the REST API credentials and action mapping used to push EOD
-- outcomes into a client's Quotie instance (tasks / site visits). Shape:
--
--   {
--     "api_url":  "https://<ref>.supabase.co/functions/v1",
--     "api_key":  "qk_...",                         -- SECRET, server-only
--     "user_map": { "Lachlan": "<quotie users.auth_id>" },
--     "actions":  {
--       "<EOD3 outcome>": {
--         "type":          "task" | "site_visit",
--         "titleTemplate": "Prepare quote for {contact}",  -- task only, optional
--         "assign_to":     "<quotie users.auth_id>"        -- optional override
--       }
--       -- OR explicit null to disable the default action for that outcome
--     }
--   }
--
-- api_key and user_map are secrets — they must NEVER be sent to the client.
-- Only the { outcome -> type } projection (see safeQuotieActions) is exposed.

alter table companies add column if not exists quotie_config jsonb;

comment on column companies.quotie_config is
  'Per-client Quotie REST API config: {api_url, api_key, user_map, actions}. api_key is secret — never expose to client.';
