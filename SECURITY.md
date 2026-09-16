# Security Notes

## Database transport
- Production Supabase connections are accepted only over HTTPS.
- Backend requests to Supabase use a 10-second timeout, no-store caching, and refuse redirects.
- Vercel sends HSTS and related transport/security headers.
- `SUPABASE_SECRET_KEY` must exist only in the Backend Vercel project. Never expose it to Frontend JavaScript.

## SQL injection protection
The application does not construct raw SQL from request input. Backend CRUD uses `@supabase/supabase-js` / PostgREST query methods (`.eq`, `.insert`, `.update`, etc.), which transmit values as structured request parameters rather than interpolating them into SQL strings. Inputs are also normalized/validated before use.

Do not add endpoints that concatenate user input into SQL or PostgREST filter expressions. If raw SQL is introduced later, it must use parameterized queries only.

## Database access
Run `Backend/supabase/003_security_hardening.sql` after the schema and seed scripts. It revokes direct table privileges from `anon` and `authenticated`, keeps RLS enforced, and grants server-side access to `service_role`.

## Area and role isolation
- All cloud module endpoints authenticate the Supabase access token on the Backend.
- Queries are scoped by `profiles.area_id`; Chapter Servants are additionally constrained to their assigned Chapter where applicable.
- Regular Members receive only their own member-linked service/GIG/participant data while Area events remain visible to the Member Portal.
- Run `Backend/supabase/005_cloud_modules.sql` after migrations 001-004 on an existing project.

## Account provisioning security
- Regular Member records do not automatically receive login accounts.
- Only authorized Super Admin roles can manage account access from the Members dashboard.
- Leadership account scope is derived from the linked Member/Profile role, Area, and Chapter.
- Account setup/reset emails are sent through Supabase Auth; no temporary passwords are generated or exposed to administrators.
- The private `ADMIN_REGISTRATION_CODE` remains only for the controlled bootstrap registration path and must stay server-side.
- SMTP credentials, Google App Passwords, Supabase secret keys, and registration codes must never be committed to the repository or distributed in source archives.
