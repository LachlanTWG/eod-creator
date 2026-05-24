-- 0005: add 'lost' stage to won_jobs.
-- Used to flag verbal-confirmation rows that never matured (ghosted, lost to
-- competitor, etc.) — keeps them out of the active pipeline without deletion.

alter table won_jobs drop constraint won_jobs_stage_check;
alter table won_jobs add constraint won_jobs_stage_check
  check (stage in ('verbal_confirmation', 'client_approved', 'invoiced', 'paid', 'lost'));
