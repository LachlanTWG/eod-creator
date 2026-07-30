-- 0015: Richer pending site-visit fields for popup log + Slack summary.
-- Auto fields (from GHL calendar webhook) + optional manual summary fields
-- filled when the exec Logs in the popup.

alter table pending_site_visits
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists booked_on date,
  add column if not exists appointment_display text,
  add column if not exists rough_job_value text,
  add column if not exists ideal_start_date text,
  add column if not exists details_comment text,
  add column if not exists vertical text,
  add column if not exists summary_sent_at timestamptz;
