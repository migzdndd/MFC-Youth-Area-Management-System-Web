# Backend Phase 0.7 — Neon PostgreSQL + Secure Server Authentication

The backend no longer depends on Supabase. The cloud database is Neon PostgreSQL provisioned through Vercel, and authentication is handled server-side by the Backend using salted `scrypt` password hashes and opaque database-backed sessions.

## Architecture

```text
Browser
   |
   v
Frontend (Vercel)
   |
   v
Frontend /api/* proxy
   |
   v
Backend (Vercel)
   |
   v
Neon PostgreSQL
```

The browser never receives `DATABASE_URL` and never connects directly to PostgreSQL.

## Required Backend environment variables

- `DATABASE_URL` — automatically supplied by the Vercel/Neon integration.
- `ADMIN_REGISTRATION_CODE` — server-only Servant Leader registration code.
- `FRONTEND_ORIGIN` — recommended production Frontend origin for origin validation.
- `SESSION_HOURS` — optional; defaults to 12.
- `REMEMBER_SESSION_DAYS` — optional; defaults to 30.

Never commit real environment files or connection strings.

## Database setup

For the Neon database that already has the 10 MFC Youth application tables, run:

```text
Backend/database/002_existing_schema_neon_auth_migration.sql
```

For a completely fresh Neon database, run:

```text
Backend/database/001_neon_schema.sql
```

`003_optional_seed.sql` is optional and only pre-creates MFC Youth NCR Central and its standard services.

## Authentication/security model

- Passwords are never stored as plaintext.
- Passwords are hashed server-side with Node.js `scrypt` and a random salt.
- Sessions use cryptographically random opaque tokens.
- Only SHA-256 session-token hashes are stored in PostgreSQL.
- The browser receives the session as `Secure`, `HttpOnly`, `SameSite=Lax` cookie through the Frontend API proxy.
- Login lockout activates after repeated invalid passwords.
- Password changes invalidate other active sessions.
- SQL uses parameterized PostgreSQL queries through `@neondatabase/serverless`.
- Backend errors are sanitized in production.
- Request size validation and optional origin validation are enabled.
- Vercel security headers enable HSTS and common browser protections.
- The Frontend uses a strict Content Security Policy without inline JavaScript event handlers; dynamic actions use delegated event listeners.

## Current cloud-backed endpoints

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/admin-register`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `DELETE /api/auth/account`
- `GET /api/areas`
- `POST /api/areas`
- `POST /api/areas/select`
- `GET /api/members`
- `POST /api/members`
- `PATCH /api/members`
- `DELETE /api/members`
- `POST /api/members/login`
- `GET /api/chapters`
- `POST /api/chapters`
- `PATCH /api/chapters`
- `DELETE /api/chapters`
- `POST /api/chapters/assign-members`

Services, Events, Activity Reports, GIG and dashboard analytics still have frontend/local prototype logic and should be migrated to the same backend in the next phases.

## Role behavior

- Couple Coordinator/s: management account only; intentionally not added to the Members roster.
- Area Servant: management account + Members record after Area onboarding.
- LIT Servant: management account + Members record after Area onboarding.
- Chapter Servant: chapter-scoped management account + Members record after Area onboarding.
- Member: Members record + login account provisioned by leadership.
