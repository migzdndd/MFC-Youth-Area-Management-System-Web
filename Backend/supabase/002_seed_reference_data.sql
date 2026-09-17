-- Initial reference data for the four NCR Areas.

insert into public.areas (name, code)
values
  ('NCR Central', 'NCR-CENTRAL'),
  ('NCR East', 'NCR-EAST'),
  ('NCR South', 'NCR-SOUTH'),
  ('NCR North', 'NCR-NORTH')
on conflict (code) do update set name = excluded.name;

-- Add the default Services to all four NCR Areas.
with selected_areas as (
  select id
  from public.areas
  where code in ('NCR-CENTRAL', 'NCR-EAST', 'NCR-SOUTH', 'NCR-NORTH')
)
insert into public.services (area_id, name)
select selected_areas.id, service.service_name
from selected_areas
cross join (values
  ('Unit Servant'),
  ('Household Servant'),
  ('Chapter Servant'),
  ('Area Servant'),
  ('Area LIT Servant'),
  ('Campus Servant'),
  ('Area Kids Servant'),
  ('MFC High Servant')
) as service(service_name)
on conflict (area_id, name) do nothing;
