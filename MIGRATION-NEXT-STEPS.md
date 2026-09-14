# Neon Migration - Deployment Steps

This package removes the Supabase runtime dependency for authentication, Area onboarding, Members, and Chapters. The remaining modules still use the existing frontend/local prototype layer until their cloud migration phases.

## 1. Run the Neon auth/security migration

Your Neon project already contains the 10 application tables created during setup. In **Neon Console -> SQL Editor**, run:

`Backend/database/002_existing_schema_neon_auth_migration.sql`

This adds:
- `accounts`
- `sessions`
- `rate_limits`
- secure account/profile linking
- login lockout fields
- missing `is_active` columns used by the backend
- member audit linkage
- required indexes

Do **not** run `001_neon_schema.sql` over the existing database. That file is only for a completely fresh database.

## 2. Backend Vercel environment variables

In the Backend Vercel project, confirm:

- `DATABASE_URL` exists (provided by the Neon/Vercel integration)
- `ADMIN_REGISTRATION_CODE` is set privately
- `FRONTEND_ORIGIN` is the exact production Frontend origin, e.g. `https://mfc-youth-area-management-system.vercel.app`

Optional:
- `SESSION_HOURS=12`
- `REMEMBER_SESSION_DAYS=30`

Remove any old Supabase environment variables. Never commit `DATABASE_URL`, passwords, `.env`, or `.env.local`.

## 3. Frontend Vercel environment variable

Confirm the Frontend Vercel project has:

`BACKEND_URL=https://mfc-youth-area-management-backend.vercel.app`

Do not append `/api`.

## 4. Deploy order

1. Commit and push this source.
2. Redeploy **Backend first**.
3. Open `https://mfc-youth-area-management-backend.vercel.app/api/health`.
4. Confirm `databaseConnected: true` and `schemaReady: true`.
5. Redeploy **Frontend**.
6. Test Servant Leader registration -> Area onboarding -> Members.
7. Test Members actions: View, Edit, Services, GIG, Login, Delete.
8. Test Chapters: create, rename, assign members, and delete.
9. Test logout/login, password change, member temporary-password reset, Member Portal preview, and Delete Account.

## 5. Security behavior in this build

- `DATABASE_URL` is backend-only and never sent to the browser.
- Passwords are stored only as salted `scrypt` hashes.
- Session tokens are cryptographically random; only SHA-256 token hashes are stored in Neon.
- Real sessions use `Secure`, `HttpOnly`, `SameSite=Lax` cookies.
- Failed authentication attempts are rate-limited and repeated password failures trigger account lockout.
- Password changes invalidate other sessions.
- SQL calls use PostgreSQL parameters instead of concatenating untrusted input.
- Request bodies, UUIDs, dates, email addresses, roles, and Area/Chapter scope are validated.
- Production database errors are sanitized.
- Database requests have timeouts.
- HSTS, CSP, frame blocking, MIME sniffing protection, referrer policy, and permissions policy are enabled.
- Dynamic UI buttons use CSP-safe delegated event listeners; inline JavaScript handlers were removed.
- Management pages verify the server session before rendering cloud data.

## 6. Current cloud-backed modules

- Authentication and sessions
- Servant Leader registration
- Area selection/creation
- Members and member account provisioning
- Chapters and chapter member assignment

## 7. Next development phase

After production tests pass, migrate the remaining prototype/localStorage modules in this order:

**Services -> Events + Participants -> Activity Reports + GIG -> Dashboard/Analytics -> remove production localStorage data writes**
