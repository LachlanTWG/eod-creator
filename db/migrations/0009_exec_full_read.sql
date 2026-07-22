-- 0009: full read visibility for roster execs.
--
-- Lachlan wants every roster exec (Max, Zac, Buzz, Benji, …) to see ALL
-- existing data: every client, every exec, and the stored reports. 0007
-- already opened activities/won_jobs/sales_people/companies peer-wide but
-- kept two gaps:
--   - activities with NO sales_person link (owner/client-side logged rows,
--     e.g. Ryan Maxwell's) stayed invisible to execs
--   - reports + report_deliveries stayed strict-own-only (0006)
--
-- Approach: additive permissive SELECT policies per table (OR'd with the
-- existing ones), mirroring the 0008 viewer pattern. Write policies are
-- untouched — execs still only INSERT/UPDATE their own slice, and the
-- dashboard's add-activity surface stays roster-scoped app-side.
--
-- webhook_events stays admin-only (ops internals). profiles stays self-only.

drop policy if exists activities_exec_select on activities;
create policy activities_exec_select on activities for select using (is_roster_exec());

drop policy if exists reports_exec_select on reports;
create policy reports_exec_select on reports for select using (is_roster_exec());

drop policy if exists report_deliveries_exec_select on report_deliveries;
create policy report_deliveries_exec_select on report_deliveries for select using (is_roster_exec());
