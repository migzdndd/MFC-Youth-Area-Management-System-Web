# Backend Phase 6.7 — Gmail OTP Registration + Supabase Cloud Data Modules

The backend is now the production source of truth for Auth, Areas, Members, Chapters, Services, Events, Event Participants, Activity Reports and GIG. The browser keeps only a fast UI cache/demo fallback.

## Architecture

```text
Web Frontend (Vercel)
        |
        v
Frontend /api/* direct Vercel rewrite
        |
        v
Backend/api/router.js
        |
        v
Backend/server/* route handlers
        |
        +--> Supabase Auth
        |
        +--> PostgreSQL (Supabase)
```

The future WinForms desktop app should use the same API instead of talking directly to the cloud database. That keeps RBAC and Area/Chapter authorization in one place.


## Project layout

The backend and frontend are now separated as sibling projects in the repository:

```text
Web-Source/
├── Backend/
│   ├── api/          # Real server-side implementation
│   ├── supabase/     # PostgreSQL schema and seed SQL
│   ├── .env.example
│   └── README.md
└── Frontend/
    ├── api/          # Lightweight proxy routes only
    ├── css/
    ├── js/
    └── *.html
```

The public API URLs remain unchanged (`/api/auth/login`, `/api/members`, etc.). `Frontend/vercel.json` rewrites `/api/*` directly to the separately deployed Backend. `Backend/api/router.js` is the single Vercel Function and dispatches requests to `Backend/server/*` handlers.

## What is included

- Supabase/PostgreSQL schema for Areas, Chapters, Members, Profiles, Services, Events, Participants, Activity Reports and GIG.
- Server-only Supabase service-role client.
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/member-otp/request`
- `POST /api/auth/member-otp/verify`
- `POST /api/auth/admin-register`
- `GET /api/areas`
- `POST /api/areas`
- `POST /api/areas/select`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET/POST/PATCH/DELETE /api/members`
- `GET/POST/PATCH/DELETE /api/chapters`
- `POST /api/chapters/assign-members`
- `GET/PATCH /api/services`
- `GET/POST/PATCH/DELETE /api/events`
- `GET/POST/PATCH/DELETE /api/participants`
- `GET/POST/PATCH/DELETE /api/reports`
- `GET/POST/DELETE /api/gig`
- `GET /api/sync` for one-request Area data + dashboard analytics hydration
- New live account registration/onboarding is Gmail-verified. Regular Members are passwordless by default and use a one-time code sent to their registered `@gmail.com` address; an optional password can be added later.
- Admin-created Servant Leaders receive a Gmail OTP before first-time password creation.
- Self-registered Servant Leaders/Admins must verify a Gmail OTP before their `profiles` row is created.
- Chapter Servant member creation is enforced server-side: the new member is assigned to the servant's chapter and receives Member access.
- Super Admin roles remain Couple Coordinator/s, Area Servant and LIT Servant.
- RLS is enabled with no anonymous table policies. The browser cannot directly read/write database tables.

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `Backend/supabase/001_initial_schema.sql`.
3. Run `Backend/supabase/002_seed_reference_data.sql` after confirming the Area seed values.
4. Run `Backend/supabase/003_security_hardening.sql`, `004_servant_leader_password_policy.sql`, and `005_cloud_modules.sql` in order on an existing project.
5. In Vercel Project Settings -> Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ADMIN_REGISTRATION_CODE` (set this privately to the approved Servant Leader registration authorization code)
   - `FRONTEND_URL` (public Frontend origin used for Servant Leader invite/recovery links where applicable)
6. In Supabase Auth Email Templates, configure passwordless email sign-in to display `{{ .Token }}` so registration/sign-in emails contain a code instead of only a magic link.
7. Configure **Custom SMTP** in Supabase Auth before real external-user testing. The default Supabase sender is development-only and is not suitable for production Gmail delivery. See `ALL-REGISTRATION-GMAIL-OTP.md`.
8. If password recovery links are used, allow `${FRONTEND_URL}/change-password` in Supabase Auth Redirect URLs.
9. Redeploy.
10. Visit `/api/health`. It should report `configured: true`.

## First management / Servant Leader account

Use the **First-Time Access** page in the Frontend and the **Register an Admin Account** card. The backend first validates `ADMIN_REGISTRATION_CODE`, then sends a Gmail OTP. The Servant Leader `profiles` row is created only after Supabase successfully verifies that OTP. The verified user is then signed in and required to select/create an Area before normal management access.

If the user's Area already exists, choose it. If not, **Create Area-Based Account** creates a row in `public.areas`, seeds the standard Services for that Area, and links the new profile to it.

The registration code must remain only in `Backend/.env.local` and Vercel Backend Environment Variables. Never hardcode it in Frontend files.

## Migration strategy

Do not switch every page at once. Recommended order:

1. Backend foundation (this phase).
2. Real login/session + first admin bootstrap.
3. Members / Chapters / Services.
4. Events / Event Participants.
5. Activity Reports / GIG.
6. Dashboard / Analytics queries.
7. One-time localStorage data importer.
8. Remove production localStorage writes.
9. Add desktop sync endpoints.

## Security rule

Never put `SUPABASE_SECRET_KEY` in HTML or browser JavaScript. It belongs only in Vercel Environment Variables and server-side functions in `Backend/api`.


## Registration diagnostics

`GET /api/health` now performs a real Supabase database request instead of only checking whether environment variables are non-empty.

A healthy response must include:

- `"ok": true`
- `"databaseConnected": true`

Admin registration errors also return a safe `code` and `stage` when a backend step fails, without exposing secret keys.

## Environment-file safety

- `Backend/.env.local` is local-only and must never be committed, uploaded in source ZIPs, or shared.
- Copy the Supabase Project URL directly from the Supabase **Connect** dialog into `SUPABASE_URL`.
- Environment values are trimmed by the backend so accidental leading/trailing spaces do not cause misleading connection errors.
- `/api/health` reports only the sanitized Supabase host, never API keys or secrets.

## Leadership account ↔ member linking

Servant Leader self-registration creates/uses a pending Supabase Auth identity to deliver the OTP, but the `public.profiles` row is created only after Gmail OTP verification succeeds. Because `public.members.area_id` is required, the corresponding `public.members` row is then created (or an existing same-email member is linked) when the verified leader selects or creates their Area. `GET /api/auth/me` also repairs older leadership profiles that already have
an Area but still have `member_id = NULL`.


## Authentication policy

- New registration/onboarding requires a valid `@gmail.com` address. The backend enforces the Gmail-only rule.
- Self-registered Servant Leaders choose their permanent password, but the account profile is finalized only after a real Supabase email OTP is verified. Their final profile uses `must_change_password = false`.
- Admin-added regular Members are provisioned with Gmail only and do **not** require a password. They sign in with a one-time Gmail code generated by Supabase Auth.
- Members may add an optional password later while keeping email-code sign-in available.
- Admin-added Servant Leaders are initially provisioned without a password and with `must_change_password = true`. They verify a Gmail OTP first, then create their permanent password.
- `POST /api/auth/member-otp/request` uses `signInWithOtp(..., shouldCreateUser: false)` for already-provisioned accounts. It supports regular Members and first-time Servant Leaders awaiting password setup.
- `POST /api/auth/member-otp/verify` verifies the code and issues the appropriate session.
- `POST /api/auth/admin-register` uses two stages: `request_otp` and `verify_otp`.
- The Servant Leader `ADMIN_REGISTRATION_CODE` authorizes registration only; Gmail OTP separately proves email ownership.
- Real external email delivery requires Supabase Custom SMTP and an email template containing `{{ .Token }}`.
