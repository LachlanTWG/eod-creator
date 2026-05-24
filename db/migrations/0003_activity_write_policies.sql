-- 0003: dashboard activity edit/delete policies.
--
-- Permission model:
--   Admin       — can update or delete any activity row.
--   Exec        — can update or delete rows where sales_person_id is one of
--                 their own sales_people IDs (via my_sales_person_ids()).
--   Others      — no write access.
--
-- The `with check` on update prevents an exec from reassigning a row to
-- another person. Admin can reassign freely.
--
-- No INSERT policy: webhooks/backfill use the service role, dashboard does
-- not create rows.

create policy activities_update on activities for update
  using (
    is_admin() or sales_person_id in (select my_sales_person_ids())
  )
  with check (
    is_admin() or sales_person_id in (select my_sales_person_ids())
  );

create policy activities_delete on activities for delete
  using (
    is_admin() or sales_person_id in (select my_sales_person_ids())
  );
