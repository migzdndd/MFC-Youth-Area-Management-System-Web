-- Optional initial reference data for the first Area.
-- Change the name/code before running if needed.
insert into public.areas (name, code)
values ('MFC Youth NCR Central', 'NCR-CENTRAL')
on conflict (code) do nothing;

with a as (
  select id from public.areas where code = 'NCR-CENTRAL'
)
insert into public.services (area_id, name)
select a.id, service_name
from a
cross join (values
  ('Unit Servant'),
  ('Household Servant'),
  ('Chapter Servant'),
  ('Area Servant'),
  ('LIT Servant'),
  ('Campus Servant'),
  ('MFC High Servant')
) as service(service_name)
on conflict (area_id, name) do nothing;
