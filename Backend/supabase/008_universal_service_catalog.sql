-- Universal built-in service catalog + servant-role detection backfill
-- Run after 007_area_kids_and_area_lit.sql on existing Supabase projects.
--
-- Goals:
--   1. Guarantee all eight built-in Services exist for every Area.
--   2. Normalize legacy LIT/Kids service names without losing assignments.
--   3. Backfill a matching Service for servant-leader Member records that do
--      not have any explicit member_services assignment yet.

with standard_service(name) as (
  values
    ('Unit Servant'),
    ('Household Servant'),
    ('Chapter Servant'),
    ('Area Servant'),
    ('Area LIT Servant'),
    ('Campus Servant'),
    ('Area Kids Servant'),
    ('MFC High Servant')
)
insert into public.services (area_id, name, is_active)
select area.id, standard_service.name, true
from public.areas as area
cross join standard_service
on conflict (area_id, name) do update
set is_active = true,
    updated_at = now();

-- Merge known legacy aliases into their canonical service rows while keeping
-- existing member assignments intact.
do $$
declare
  legacy record;
  target_service_id uuid;
begin
  for legacy in
    select service.id, service.area_id, service.name,
           case
             when lower(service.name) = 'lit servant' then 'Area LIT Servant'
             when lower(service.name) = 'kids servant' then 'Area Kids Servant'
             else null
           end as canonical_name
    from public.services as service
    where lower(service.name) in ('lit servant', 'kids servant')
  loop
    select id into target_service_id
    from public.services
    where area_id = legacy.area_id
      and name = legacy.canonical_name
    limit 1;

    if target_service_id is not null and target_service_id <> legacy.id then
      insert into public.member_services (member_id, service_id, created_at)
      select member_id, target_service_id, created_at
      from public.member_services
      where service_id = legacy.id
      on conflict (member_id, service_id) do nothing;

      delete from public.member_services
      where service_id = legacy.id;

      delete from public.services
      where id = legacy.id;
    elsif target_service_id is null then
      update public.services
      set name = legacy.canonical_name,
          is_active = true,
          updated_at = now()
      where id = legacy.id;
    end if;
  end loop;
end $$;

-- Access levels that directly represent a service should be visible in the
-- Services dashboard even for accounts created before service linking existed.
-- Preserve any explicit existing service choice by backfilling only Members
-- that currently have no service assignment.
with role_service(access_level, service_name) as (
  values
    ('area_servant', 'Area Servant'),
    ('lit_servant', 'Area LIT Servant'),
    ('campus_servant', 'Campus Servant'),
    ('area_kids_servant', 'Area Kids Servant'),
    ('chapter_servant', 'Chapter Servant')
)
insert into public.member_services (member_id, service_id)
select member.id, service.id
from public.members as member
join role_service
  on role_service.access_level = member.access_level
join public.services as service
  on service.area_id = member.area_id
 and service.name = role_service.service_name
 and service.is_active = true
where not exists (
  select 1
  from public.member_services as existing
  where existing.member_id = member.id
)
on conflict (member_id, service_id) do nothing;
