-- OPTIONAL: only run if you want NCR Central pre-created instead of creating an Area in the app.
INSERT INTO areas (name, code, is_active)
VALUES ('MFC Youth NCR Central', 'NCR-CENTRAL', TRUE)
ON CONFLICT DO NOTHING;

WITH a AS (
  SELECT id FROM areas WHERE code = 'NCR-CENTRAL' LIMIT 1
)
INSERT INTO services (area_id, name, is_active)
SELECT a.id, service_name, TRUE
FROM a
CROSS JOIN (VALUES
  ('Unit Servant'),
  ('Household Servant'),
  ('Chapter Servant'),
  ('Area Servant'),
  ('LIT Servant'),
  ('Campus Servant'),
  ('MFC High Servant')
) AS service(service_name)
ON CONFLICT (area_id, name) DO NOTHING;
