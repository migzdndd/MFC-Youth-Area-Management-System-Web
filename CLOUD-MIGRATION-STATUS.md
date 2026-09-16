# Supabase Cloud Migration Status

This baseline completes the previously yellow web-app data modules.

## Supabase source of truth

Authenticated production sessions now read/write these modules through the Vercel Backend and Supabase:

- Areas / account onboarding
- Members + Supabase Auth provisioning
- Chapters + chapter-member assignment
- Services + member-service assignments
- Events
- Event Participants / payment / attendance
- Activity Reports
- GIG Contributions
- Dashboard analytics / summary hydration

`localStorage` remains only as an Area/account-scoped fast UI cache for authenticated cloud sessions. Authenticated cloud mutations are sent to the Backend first and the cache is reconciled from Supabase afterward.

## Required migration on an existing Supabase project

If `001` through `004` have already been run, run only:

```text
Backend/supabase/005_cloud_modules.sql
```

It adds the UI-compatible Event/Activity Report fields and supporting indexes. Do not rerun the original schema on a live database.

## New API routes

```text
/api/chapters
/api/chapters/assign-members
/api/services
/api/events
/api/participants
/api/reports
/api/gig
/api/sync
```

Every route authenticates the Supabase access token on the Backend and applies Area/role scoping server-side. The browser never receives `SUPABASE_SECRET_KEY`.

## Area isolation

- Super Admin roles: scoped to their own `area_id`.
- Chapter Servant: Chapter/member/report/GIG data is limited to the assigned Chapter where applicable.
- Member: cloud sync exposes only the member's own Member/Service/GIG/participant records while Area events remain visible for the Member Portal.


## Chapter Servant compatibility

Chapter Servants continue to receive only their own chapter roster during normal member synchronization. When they open **Add Unassigned Members**, the frontend now requests the unassigned-member pool on demand through `/api/chapters/assign-members?chapterId=...`. The Backend validates the Chapter Servant role, Area, and assigned Chapter before returning that limited list, so unassigned members are not exposed through the ordinary Members page.

## Dashboard

Dashboard counts and quick analytics are hydrated from `/api/sync` and therefore reflect Supabase data after reconciliation rather than independent browser-only records.

## Vercel deployment architecture

To remain compatible with Vercel Hobby limits, the Backend exposes one serverless router function and keeps route implementations under `Backend/server/`. The Frontend uses an external rewrite for `/api/:path*` instead of generating proxy functions. Public API paths remain unchanged.

## Account provisioning

Member records and login accounts are now intentionally separate:

- Regular Members can exist without a Supabase Auth account or password.
- Super Admins can enable optional Member Portal access from **Members → Access**.
- Leadership accounts are created from Member records by assigning the approved System Access Level, or by using **Members → Access**.
- Newly provisioned accounts use a secure password setup/reset link sent to the Member email.
- The controlled bootstrap Admin registration form remains available for first management-account setup.

The main dashboard, Member inputs, role model, Area scoping, and cloud data modules remain unchanged.

## Part 3 update — browser cache isolation

Authenticated Supabase sessions now store frontend cache data under an Area/account-scoped localStorage key. The old global browser database is no longer consumed by cloud-authenticated management or Member Portal sessions. This closes the transient cross-account/Area cache exposure that could occur before a background cloud refresh completed.

## Authentication Isolation Update

Production authentication no longer falls back to browser-created prototype users. Cloud accounts authenticate through the backend/Supabase only, and the Demo Dashboard entry point has been removed.

## Part 5 - Account setup state

Admin-provisioned login accounts now have an explicit Setup Pending -> Active transition using the existing `profiles.must_change_password` field. No database schema migration is required for this phase.


## Migration 006 - Administrator registration throttling

After `005_cloud_modules.sql`, run `Backend/supabase/006_admin_registration_rate_limit.sql` to enable persistent Administrator Registration Code throttling.
