-- MFC High Servant Admin Role
-- Adds mfc_high_servant to access checks for members and profiles.

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
    'mfc_high_servant',
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
    'mfc_high_servant',
    'area_kids_servant',
    'chapter_servant',
    'member'
  ));
