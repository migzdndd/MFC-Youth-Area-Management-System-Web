# Web(9) Complete Functioning Fixes

This package is the corrected Web(9) source after the full login/authentication and consistency audit.

## Completed fixes

- Production login is Supabase/backend-only; the Demo Dashboard entry point is removed.
- OTP authentication remains removed.
- Access-token refresh/retry works for both the management application and Member Portal.
- Definitively expired/inactive sessions clear the scoped protected cache and return to sign-in.
- `must_change_password` is enforced for Members and Servant Leaders before protected Area data is accessible.
- Password-setup links can still call `/api/auth/me` and `/api/auth/change-password` while setup is pending.
- Browser cache is isolated by Area + account identity.
- Administrator Registration Code throttling (migration 006) is included.
- Bootstrap Admin rollback restores a linked Member access level if account creation fails.
- Member editing now keeps Auth, Profile, and Member records consistent with compensation rollback.
- Member deletion removes database records first, then cleans up the linked Auth user; a failed final Auth cleanup cannot leave usable application access.
- Account provisioning rolls back newly-created/modified profile state on failure.
- Leadership Member linking now rolls back partial Member changes if profile linking fails.
- Dead temporary-password generation code is removed.
- Public health output is reduced and now treats migration 006 as part of schema readiness.
- CSP/security headers are enabled without changing the management dashboard/page structure.
- Inline HTML navigation handlers were replaced with CSP-compatible `data-nav` handling.
- Safe packaging excludes `.env.local`, `.git`, `node_modules`, build output, logs, and nested ZIP files.

## Required deployment step

Run `Backend/supabase/006_admin_registration_rate_limit.sql` in the Supabase SQL Editor before deploying this build.

Keep `Backend/.env.local` only on your local machine. Production values belong in Vercel Environment Variables.

## Validation performed

- JavaScript syntax validation across Backend and Frontend.
- JSON validation.
- Backend module import validation.
- HTML duplicate-ID, local asset, inline-handler, and frontend/API-route consistency checks.
- Mocked login, wrong-password, inactive-account, refresh-token, invalid-token, and password-setup enforcement tests.
- Mocked Administrator Registration Code and account-creation rollback tests.
- Mocked Member edit rollback and Member/Auth deletion consistency tests.
- ZIP integrity and secret-exclusion verification.

Live Supabase/Vercel delivery still requires the configured environment variables, migration 006, and deployment-specific end-to-end testing.
