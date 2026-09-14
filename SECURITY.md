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
