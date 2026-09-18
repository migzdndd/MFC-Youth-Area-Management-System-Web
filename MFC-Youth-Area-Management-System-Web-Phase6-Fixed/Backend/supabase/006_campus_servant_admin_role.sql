-- Campus Servant admin role
-- Adds campus_servant to the existing member/profile role constraints.

alter table public.members
  drop constraint if exists members_access_level_check;

alter table public.members
  add constraint members_access_level_check
  check (access_level in (
    'couple_coordinator',
    'area_servant',
    'lit_servant',
    'campus_servant',
    'chapter_servant',
    'member'
  ));

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'couple_coordinator',
    'area_servant',
    'lit_servant',
    'campus_servant',
    'chapter_servant',
    'member'
  ));
