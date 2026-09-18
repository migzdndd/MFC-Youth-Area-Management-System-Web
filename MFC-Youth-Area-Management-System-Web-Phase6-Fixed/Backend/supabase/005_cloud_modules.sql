-- =========================================================
-- MFC Youth Web - Cloud modules migration
-- Adds fields required by the existing Events and Activity Reports UI.
-- Safe to run once on an existing project; uses IF NOT EXISTS.
-- =========================================================

alter table public.events
  add column if not exists fee numeric(12,2) not null default 0 check (fee >= 0),
  add column if not exists manual_attendance integer not null default 0 check (manual_attendance >= 0);

alter table public.activity_reports
  add column if not exists prepared_by_name text,
  add column if not exists chapter_name_snapshot text,
  add column if not exists activity text,
  add column if not exists participant_count integer not null default 0 check (participant_count >= 0),
  add column if not exists location text,
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists chapters_area_active_name_idx
  on public.chapters(area_id, is_active, name);

create index if not exists services_area_active_name_idx
  on public.services(area_id, is_active, name);

create index if not exists member_services_service_idx
  on public.member_services(service_id, member_id);

create index if not exists events_area_starts_idx
  on public.events(area_id, starts_at desc);

create index if not exists event_participants_event_idx
  on public.event_participants(event_id, registered_at desc);

create index if not exists event_participants_member_idx
  on public.event_participants(member_id, event_id);

create index if not exists activity_reports_area_date_idx
  on public.activity_reports(area_id, activity_date desc);

create index if not exists activity_reports_chapter_date_idx
  on public.activity_reports(chapter_id, activity_date desc);

create index if not exists gig_contributions_area_date_idx
  on public.gig_contributions(area_id, contribution_date desc);

create index if not exists gig_contributions_member_date_idx
  on public.gig_contributions(member_id, contribution_date desc);
