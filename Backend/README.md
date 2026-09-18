# Backend Phase 6.6 — Supabase Cloud Data Modules

The backend is now the production source of truth for Auth, Areas, Members, Chapters, Services, Events, Event Participants, Activity Reports and GIG. The browser keeps only a fast UI cache/demo fallback.

## Architecture

```text
Web Frontend (Vercel)
        |
        v
Frontend /api/* proxy routes
        |
        v
Backend/api/* backend implementation
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

The public API URLs remain unchanged (`/api/auth/login`, `/api/members`, etc.). Each Frontend `api/` route proxies to the separately deployed Backend through `BACKEND_URL`. Backend business logic remains only in `Backend/api/`.

## What is included

- Supabase/PostgreSQL schema for Areas, Chapters, Members, Profiles, Services, Events, Participants, Activity Reports and GIG.
- Server-only Supabase service-role client.
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/admin-register`
- `GET /api/areas`
- `POST /api/areas`
- `POST /api/areas/select`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/change-email`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/admin/members/change-email` (Area-level servant override for provisioned accounts)
- `GET/POST/PATCH/DELETE /api/members`
- `GET/POST/PATCH/DELETE /api/chapters`
- `POST /api/chapters/assign-members`
- `GET/PATCH /api/services` (one service assignment per Member)
- `GET/POST/PATCH/DELETE /api/events`
- `GET/POST/PATCH/DELETE /api/participants`
- `GET/POST/PATCH/DELETE /api/reports`
- `GET/POST/DELETE /api/gig`
- `GET /api/sync` for one-request Area data + dashboard analytics hydration
- Member creation creates only the organizational Member record. Optional portal access is claimed separately by the Member.
- `POST /api/auth/member-claim` creates a self-chosen portal account after matching the verified email to an existing Member record.
- Chapter Servant member creation is enforced server-side: the new member is assigned to the servant's chapter and receives Member access.
- Area-level servant roles are Couple Coordinator/s, Area Servant, Area LIT Servant, Campus Servant, and Area Kids Servant.
- The canonical Services catalog contains Unit Servant, Household Servant, Chapter Servant, Area Servant, Area LIT Servant, Campus Servant, Area Kids Servant, and MFC High Servant. Missing built-in services are repaired automatically during Services/Sync requests, while migration 008 backfills older databases.
- RLS is enabled with no anonymous table policies. The browser cannot directly read/write database tables.

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `Backend/supabase/001_initial_schema.sql`.
3. Run `Backend/supabase/002_seed_reference_data.sql` after confirming the Area seed values.
4. Run `Backend/supabase/003_security_hardening.sql`, `004_servant_leader_password_policy.sql`, `005_cloud_modules.sql`, `006_campus_servant_admin_role.sql`, `007_area_kids_and_area_lit.sql`, `008_universal_service_catalog.sql`, `009_national_coordinator_and_school_fields.sql`, and `010_mfc_high_servant.sql` in order on an existing project.
5. In Vercel Project Settings -> Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ADMIN_REGISTRATION_CODE` (set this privately to the approved Servant Leader registration password)
6. Redeploy.
7. Visit `/api/health`. It should report `configured: true`.

## First management / Servant Leader account

Use the **First-Time Access** page in the Frontend and the **Register an Admin Account** card. The backend verifies `ADMIN_REGISTRATION_CODE`, creates a Supabase Auth user + `profiles` record, signs the new user in, and requires Area selection before normal management access.

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

Servant Leader registration creates the Supabase Auth user and `public.profiles` row first.
Because `public.members.area_id` is required, the corresponding `public.members` row is
created (or an existing same-email member is linked) when the leader selects or creates
their Area. `GET /api/auth/me` also repairs older leadership profiles that already have
an Area but still have `member_id = NULL`.


## Password provisioning policy

- Self-registered Servant Leaders use the password they choose during registration. Their profile uses `must_change_password = false`.
- Admin-added Members receive only an organizational `public.members` record. Member Portal access is optional and is claimed by the Member with their verified email and self-chosen password.
- The Servant Leader registration code authorizes registration only; it is never used as the user account password.

Member records and login accounts are separate. A Member Portal claim matches the verified
Supabase Auth email to `lower(public.members.email)`, rejects missing or already-linked
records, and creates the `profiles` link server-side without creating a duplicate member.
