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

## Session security
- End-user access tokens are validated with the normal Supabase Auth client rather than the privileged Backend client.
- The Supabase secret/service-role client is used only for trusted profile and database operations after the user token has been validated.
- `POST /api/auth/refresh` accepts a Supabase refresh token over HTTPS and returns a renewed access/refresh-token pair after confirming the account profile is still active.
- Frontend authenticated requests retry at most once after a successful refresh, preventing infinite refresh loops.
- The management frontend also performs a best-effort refresh shortly before token expiry.

## Account provisioning security
- Regular Member records do not automatically receive login accounts.
- Only authorized Super Admin roles can manage account access from the Members dashboard.
- Leadership account scope is derived from the linked Member/Profile role, Area, and Chapter.
- Account setup/reset emails are sent through Supabase Auth; no temporary passwords are generated or exposed to administrators.
- The private `ADMIN_REGISTRATION_CODE` remains only for the controlled bootstrap registration path and must stay server-side.
- SMTP credentials, Google App Passwords, Supabase secret keys, and registration codes must never be committed to the repository or distributed in source archives.

## Safe source packaging

Real local environment files are required for local development, but they must never be committed or included in shared source archives.

Keep the real local backend configuration at:

```text
Backend/.env.local
```

Git already ignores it. When creating a ZIP for sharing, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-source.ps1
```

The packaging script keeps `.env.example` files but excludes `.env`, `.env.*` (including `.env.local`), `.git`, `node_modules`, `.vercel`, build output, logs, and existing ZIP archives.

Production secrets belong in the Vercel project's Environment Variables, not in the repository or distributable source ZIP.

## Part 3 — browser cache isolation

Authenticated cloud cache data is isolated by both Area and account instead of using one shared browser database key. The application uses a key derived from the authenticated Area ID and Supabase/user identity. Explicit logout and account deletion clear the current cloud cache before the session is removed. The original `mfc_web_database_v1` key is treated as a legacy prototype cache and is not trusted by cloud-authenticated sessions.

This prevents cached Area A data from being rendered for Area B or another signed-in account on a shared browser while a cloud refresh is pending.

## Production authentication

The Web App uses cloud-only backend/Supabase authentication. The obsolete `mfc_demo_users` browser credential registry is removed and legacy browser-only/demo sessions are rejected. The public Demo Dashboard entry point has been removed.

## Account setup state

Provisioned login accounts are not considered setup-complete until the password setup endpoint succeeds. `profiles.must_change_password` is the source of truth for **Setup Pending** vs **Active** in the Members UI. Re-running Members -> Access intentionally returns the login account to Setup Pending while a new secure setup link is outstanding.


## Password-setup enforcement

Accounts with `profiles.must_change_password = true` are blocked from protected Area-data endpoints until password setup succeeds. Only `/api/auth/me` and `/api/auth/change-password` may operate while setup is pending.

## Administrator registration throttling

Run `Backend/supabase/006_admin_registration_rate_limit.sql`. Failed Administrator Registration Code attempts are rate-limited by HMAC-fingerprinted client/email scopes without storing raw IP addresses or email addresses in the limiter table.

## Public diagnostics and CSP

The public health endpoint exposes only service/database readiness state, not Supabase hostnames, configuration flags, or raw database errors. Vercel security headers now include a Content Security Policy while preserving the external Visby font stylesheet and jsPDF libraries used by Reports.

## Mutation consistency

Member/profile/Auth updates use compensation rollback when a multi-step mutation fails. Member deletion removes the database-owned Member/profile state before final Auth cleanup; if Auth cleanup fails after retries, the remaining Auth identity has no application profile and cannot access protected routes.
