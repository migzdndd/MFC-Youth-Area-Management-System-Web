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

## Gmail OTP registration verification
- New live account registration/onboarding is restricted to `@gmail.com` addresses and is validated again on the Backend.
- Self-registered Servant Leader/Admin profiles are created only after Supabase verifies the Gmail OTP.
- Admin-provisioned Members are passwordless by default and use Gmail OTP.
- Admin-provisioned Servant Leaders receive Gmail OTP before their first password is created.
- The private `ADMIN_REGISTRATION_CODE` authorizes leadership registration but is not treated as proof of email ownership.
- Supabase Custom SMTP must be configured for production email delivery. Never store SMTP passwords or Google App Passwords in the repository.
