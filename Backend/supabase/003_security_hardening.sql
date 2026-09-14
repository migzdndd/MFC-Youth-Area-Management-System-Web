-- MFC Youth Area Management System - Supabase security hardening
-- Run once after 001_initial_schema.sql and 002_seed_reference_data.sql.
-- This keeps application tables server-only. The Vercel backend uses SUPABASE_SECRET_KEY.

-- Defense in depth: browsers using anon/authenticated roles do not receive direct table privileges.
revoke all on table public.areas from anon, authenticated;
revoke all on table public.chapters from anon, authenticated;
revoke all on table public.members from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.services from anon, authenticated;
revoke all on table public.member_services from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.event_participants from anon, authenticated;
revoke all on table public.activity_reports from anon, authenticated;
revoke all on table public.gig_contributions from anon, authenticated;

-- Ensure the backend service role retains the permissions it needs.
grant usage on schema public to service_role;
grant all privileges on table public.areas to service_role;
grant all privileges on table public.chapters to service_role;
grant all privileges on table public.members to service_role;
grant all privileges on table public.profiles to service_role;
grant all privileges on table public.services to service_role;
grant all privileges on table public.member_services to service_role;
grant all privileges on table public.events to service_role;
grant all privileges on table public.event_participants to service_role;
grant all privileges on table public.activity_reports to service_role;
grant all privileges on table public.gig_contributions to service_role;

-- Keep RLS enabled even though browser roles have no direct privileges.
alter table public.areas force row level security;
alter table public.chapters force row level security;
alter table public.members force row level security;
alter table public.profiles force row level security;
alter table public.services force row level security;
alter table public.member_services force row level security;
alter table public.events force row level security;
alter table public.event_participants force row level security;
alter table public.activity_reports force row level security;
alter table public.gig_contributions force row level security;

-- Helpful indexes for scoped lookups; these also reduce database load as data grows.
create index if not exists members_area_id_idx on public.members(area_id);
create index if not exists members_chapter_id_idx on public.members(chapter_id);
create index if not exists profiles_area_id_idx on public.profiles(area_id);
create index if not exists profiles_chapter_id_idx on public.profiles(chapter_id);
create index if not exists chapters_area_id_idx on public.chapters(area_id);
create index if not exists services_area_id_idx on public.services(area_id);
create index if not exists events_area_id_starts_at_idx on public.events(area_id, starts_at);
create index if not exists activity_reports_area_date_idx on public.activity_reports(area_id, activity_date);
create index if not exists gig_contributions_area_date_idx on public.gig_contributions(area_id, contribution_date);
