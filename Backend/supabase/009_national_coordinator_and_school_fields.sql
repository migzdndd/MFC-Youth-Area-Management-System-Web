-- National Coordinator Admin Role & School Fields
-- Adds national_coordinator to access checks and adds academic_track, grade_level, school to members.

alter table public.members
  drop constraint if exists members_access_level_check;

alter table public.members
  add constraint members_access_level_check
  check (access_level in (
    'national_coordinator',
    'couple_coordinator',
    'area_servant',
    'lit_servant',
    'campus_servant',
    'area_kids_servant',
    'chapter_servant',
    'member'
  ));

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'national_coordinator',
    'couple_coordinator',
    'area_servant',
    'lit_servant',
    'campus_servant',
    'area_kids_servant',
    'chapter_servant',
    'member'
  ));

alter table public.members
  add column if not exists academic_track text,
  add column if not exists grade_level text,
  add column if not exists school text;
