# Backend Phase 6.1 — Foundation

This phase starts the real backend without breaking the current localStorage prototype.

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
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/members`
- `POST /api/members`
- Member creation automatically provisions a Supabase Auth account and returns a temporary password once.
- Chapter Servant member creation is enforced server-side: the new member is assigned to the servant's chapter and receives Member access.
- Super Admin roles remain Couple Coordinator/s, Area Servant and LIT Servant.
- RLS is enabled with no anonymous table policies. The browser cannot directly read/write database tables.

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `Backend/supabase/001_initial_schema.sql`.
3. Run `Backend/supabase/002_seed_reference_data.sql` after confirming the initial Area name/code.
4. In Vercel Project Settings -> Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Redeploy.
6. Visit `/api/health`. It should report `configured: true`.

## Important: first management account

The current frontend Demo Login remains local-only for demonstration and is NOT a backend super-admin account.

Before switching production login to the backend, create the first real management Auth user in Supabase and link it to a `members` + `profiles` record. This bootstrap step will be formalized in Backend Phase 6.2 so that a service-role key never appears in the browser.

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

Never put `SUPABASE_SERVICE_ROLE_KEY` in HTML or browser JavaScript. It belongs only in Vercel Environment Variables and server-side functions in `Backend/api`.
