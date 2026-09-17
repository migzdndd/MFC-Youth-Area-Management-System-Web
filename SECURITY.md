# Security Notes

## Never commit or package secrets

Use `Backend/.env.example` only as a template. Real values belong in local environment files and Vercel Environment Variables.

The repository `.gitignore` and `scripts/package-source.ps1` exclude `.env` and `.env.*` files (except `.env.example`). Always create distributable ZIPs with the safe packaging script.

## Required production secrets

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only)
- `ADMIN_REGISTRATION_CODE` (server only)

Never expose `SUPABASE_SECRET_KEY` or `ADMIN_REGISTRATION_CODE` in frontend JavaScript, static HTML, logs, screenshots, support messages, or source archives.

## Rotation procedure after accidental exposure

1. Rotate/revoke the exposed Supabase secret/service credential in Supabase.
2. Update the backend's Vercel Environment Variable.
3. Generate a new administrator registration code and update `ADMIN_REGISTRATION_CODE` in Vercel.
4. Redeploy the backend.
5. Verify `/api/health` and sign-in with the new configuration.
6. Invalidate old artifacts/ZIPs containing the previous values.

## Database migrations

Run migrations in numeric order. Migration `006_admin_registration_rate_limit.sql` is required for database-backed admin-registration and login-failure protection.

## CSP-compatible UI actions

The frontend intentionally keeps a strict JavaScript Content-Security-Policy without `script-src 'unsafe-inline'`. Dynamic controls must use external-script event listeners or the `data-app-action` delegation pattern in `Frontend/js/app.js`; do not reintroduce inline `onclick`, `onchange`, or similar executable attributes.
