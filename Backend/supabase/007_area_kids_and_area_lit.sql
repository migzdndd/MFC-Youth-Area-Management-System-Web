-- Area Kids Servant admin role + Area LIT Servant service rename
-- Run after 006_campus_servant_admin_role.sql on existing Supabase projects.

alter table public.members
  drop constraint if exists members_access_level_check;

alter table public.members
  add constraint members_access_level_check
  check (access_level in (
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
    'couple_coordinator',
    'area_servant',
    'lit_servant',
    'campus_servant',
    'area_kids_servant',
    'chapter_servant',
    'member'
  ));

-- Rename the existing LIT service safely. If an Area already has both names,
-- preserve assignments by moving links to Area LIT Servant before cleanup.
do $$
declare
  old_service record;
  target_service_id uuid;
begin
  for old_service in
    select id, area_id
    from public.services
    where name = 'LIT Servant'
  loop
    select id into target_service_id
    from public.services
    where area_id = old_service.area_id
      and name = 'Area LIT Servant'
    limit 1;

    if target_service_id is null then
      update public.services
      set name = 'Area LIT Servant', updated_at = now()
      where id = old_service.id;
    else
      insert into public.member_services (member_id, service_id, created_at)
      select member_id, target_service_id, created_at
      from public.member_services
      where service_id = old_service.id
      on conflict (member_id, service_id) do nothing;

      delete from public.member_services
      where service_id = old_service.id;

      delete from public.services
      where id = old_service.id;
    end if;
  end loop;
end $$;

-- Add Area Kids Servant to every existing Area.
insert into public.services (area_id, name, is_active)
select id, 'Area Kids Servant', true
from public.areas
on conflict (area_id, name) do update
set is_active = true, updated_at = now();
