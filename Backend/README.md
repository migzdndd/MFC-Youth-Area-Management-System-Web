# Backend — Admin-Provisioned Accounts + Supabase Cloud Data

The Backend is the production source of truth for authentication, Area scoping, Members, Chapters, Services, Events, Event Participants, Activity Reports, GIG, and dashboard synchronization.

The current account policy intentionally separates a **Member record** from a **login account**.

## Architecture

```text
Web Frontend (Vercel)
        |
        v
Frontend /api/* rewrite
        |
        v
Backend/api/router.js
        |
        v
Backend/server/* handlers
        |
        +--> Supabase Auth
        |
        +--> PostgreSQL (Supabase)
```

The future WinForms client should use the same Backend API so authentication, role permissions, Area isolation, and synchronization rules stay centralized.

## Current API routes

```text
GET    /api/health

POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/admin-register
GET    /api/auth/me
POST   /api/auth/change-password
DELETE /api/auth/account

GET    /api/areas
POST   /api/areas
POST   /api/areas/select

GET    /api/members
POST   /api/members
PATCH  /api/members
DELETE /api/members
POST   /api/members/login

GET/POST/PATCH/DELETE /api/chapters
POST                  /api/chapters/assign-members
GET/PATCH             /api/services
GET/POST/PATCH/DELETE /api/events
GET/POST/PATCH/DELETE /api/participants
GET/POST/PATCH/DELETE /api/reports
GET/POST/DELETE       /api/gig

GET /api/sync
```

`POST /api/members/login` is retained as the existing account-management endpoint name. It now creates/links account access for the selected Member and sends a secure password setup/reset email.

`GET /api/sync` is the optimized protected-page bootstrap endpoint. It now returns authoritative profile scope, complete scoped Member records with account state, Chapters, Services/assignments, Events/Participants, Reports, GIG, and Dashboard totals in one response. This replaces the older startup sequence that separately called `/api/auth/me`, `/api/members`, and `/api/sync`.

## Account policy

### Regular Member

A regular Member record:

- requires an email in the current Member form,
- does **not** automatically require a Supabase Auth login,
- does **not** require a password simply to exist in the database.

If Portal access is wanted, an authorized Super Admin uses the state-aware Member login action (**Enable Login / Resend Setup / Reset Login / Manage Login**). The Backend creates or links the Supabase Auth user and sends a secure password setup email to the Member's stored email address.

### Servant Leader / Admin

Leadership account creation is Admin-controlled.

Preferred flow:

1. Create or open the Member record.
2. Set the Member's **System Access Level** to the approved leadership role.
3. The Backend creates/links the account using that Member email.
4. The system sends a secure password setup link.
5. The Servant Leader chooses their own password.

The same setup/reset email can be resent through **Members → Access**.

No temporary password is exposed to the administrator.

### Initial/bootstrap management account

The existing **Register an Admin Account** form remains as a controlled bootstrap path so a new deployment is not locked out before the first management account exists.

It uses:

- Full Name
- Email Address
- System Access Level
- Administrator Registration Code
- Account Password
- Confirm Account Password

If the submitted email already matches a Member record, the new profile is linked to that Member and inherits its Area/Chapter relationship where applicable.

## Roles

```text
couple_coordinator
area_servant
lit_servant
chapter_servant
member
```

Super Admin roles:

```text
couple_coordinator
area_servant
lit_servant
```

Chapter Servants remain restricted to their assigned Chapter where applicable.

## Supabase migrations

For a new project, run:

```text
Backend/supabase/001_initial_schema.sql
Backend/supabase/002_seed_reference_data.sql
Backend/supabase/003_security_hardening.sql
Backend/supabase/004_servant_leader_password_policy.sql
Backend/supabase/005_cloud_modules.sql
Backend/supabase/006_admin_registration_rate_limit.sql
```

For an existing project already through migration `004`, run `005` if needed and then run `006_admin_registration_rate_limit.sql` to enable persistent Administrator Registration Code throttling.

## Environment variables

Configure in the Backend Vercel project:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
ADMIN_REGISTRATION_CODE
FRONTEND_URL
```

`FRONTEND_URL` is used for secure password setup/reset links and should point to the deployed Frontend origin.

Never expose `SUPABASE_SECRET_KEY`, SMTP credentials, Google App Passwords, or `ADMIN_REGISTRATION_CODE` in browser JavaScript.

## Supabase Auth configuration

Allow the password setup destination in **Authentication → URL Configuration → Redirect URLs**:

```text
${FRONTEND_URL}/change-password
```

Password setup/reset emails use Supabase Auth's recovery flow.

Custom SMTP may still be used for reliable production delivery of password setup/reset emails.

## Existing Member promotion

Editing a Member's **System Access Level** to a leadership role can provision the leadership account without changing the Member form structure.

If a matching account already exists, the profile is linked/updated rather than creating a duplicate account.

## Area and Member linking

- `profiles.member_id` links login identity to the corresponding Member record.
- `profiles.area_id` and `profiles.chapter_id` drive authorization.
- `members.access_level` mirrors the approved application role.
- `GET /api/auth/me` continues to repair older leadership accounts that have an Area but do not yet have a linked Member record.

## Security

- The browser never receives the Supabase secret key.
- Cloud module operations require an authenticated Backend session.
- User access tokens are validated through the normal Supabase Auth client; the privileged Backend client is reserved for profile/data operations.
- Expired access tokens can be renewed through `POST /api/auth/refresh` using the stored refresh token, and authenticated frontend requests retry once after a successful refresh.
- Accounts marked `must_change_password = true` are blocked from protected Area-data routes until password setup succeeds.
- Administrator Registration Code failures are persistently rate-limited after migration 006.
- Queries are scoped server-side by Area and role.
- RLS remains enabled.
- Raw user input is not concatenated into SQL.
- Regular Member records are not automatically turned into login accounts.
- Only authorized Admin roles can manage account access from the Members dashboard.
- Real environment files must not be included in source ZIPs.

## Deployment check

After deploying:

1. Visit `/api/health`.
2. Confirm the response reports `ok: true`, `databaseConnected: true`, and `schemaReady: true`.
3. Sign in with an existing management account.
4. Add a normal Member and confirm no login account/password is required.
5. Promote a test Member to a leadership role and confirm a password setup email is sent.
6. Use **Members → Access** to resend/refresh account setup.
7. Confirm the user can choose a password and sign in.
8. Verify Area/Chapter restrictions still apply.
9. Verify an expired access token refreshes automatically in both the management dashboard and Member Portal.
10. Verify a setup-pending Member/Servant Leader is redirected to password setup before protected data is shown.

## Security packaging requirement

Do not distribute `Backend/.env.local` or any real environment file. Use `../scripts/package-source.ps1` to create source archives; it excludes `.env`/`.env.*` while retaining `.env.example`. See `../SECURITY.md` and `../AUDIT_REPORT_2026-09-17.md`.
