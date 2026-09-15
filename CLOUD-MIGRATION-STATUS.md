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

`localStorage` remains only as a fast UI cache and for the explicit demo/offline prototype path. Authenticated cloud mutations are sent to the Backend first and the cache is reconciled from Supabase afterward.

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

## Gmail OTP account verification

New live registration/onboarding now requires Gmail OTP verification across account types:

- Self-registered Servant Leader/Admin: Gmail OTP is verified before the profile is finalized.
- Admin-provisioned regular Member: Gmail OTP is the default passwordless sign-in method.
- Admin-provisioned Servant Leader: Gmail OTP is required before first-time password creation.

Production delivery requires Supabase Custom SMTP and an Auth email template containing `{{ .Token }}`. See `ALL-REGISTRATION-GMAIL-OTP.md`.
