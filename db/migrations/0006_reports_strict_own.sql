-- 0006: tighten reports RLS so non-admin execs can't see Team reports.
--
-- The original policy let an exec read any "Team" report at a company they
-- were rostered on. Those reports are pre-formatted aggregates that include
-- every other exec's numbers, so Zac viewing a Hughes Team report would see
-- Buzz's breakdown. Lachlan asked for execs to only ever see their own
-- numbers — this drops the Team clause.

drop policy if exists reports_select on reports;

create policy reports_select on reports for select using (
  is_admin()
  or sales_person_id in (select my_sales_person_ids())
);
