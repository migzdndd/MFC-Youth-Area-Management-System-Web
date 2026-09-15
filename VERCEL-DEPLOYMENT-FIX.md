# Vercel Hobby Deployment Fix

The cloud migration originally created one Vercel Function for every API route in both the Backend and Frontend projects. Direct Vercel Functions on the Hobby plan are limited to 12 functions per deployment.

This package fixes that architecture without changing the public API URLs:

- Backend: all route implementations live under `Backend/server/` and one Vercel Function (`Backend/api/router.js`) dispatches requests internally.
- Backend `vercel.json` rewrites `/api/:path*` to that single router function.
- Frontend: the redundant serverless proxy functions were removed.
- Frontend `vercel.json` now rewrites `/api/:path*` directly to the stable Backend Vercel domain.

Result:

- Backend Vercel Functions: 1
- Frontend Vercel Functions: 0
- Existing frontend calls such as `/api/auth/login`, `/api/members`, `/api/events`, etc. remain unchanged.

No Supabase migration changes are required for this deployment fix. If `005_cloud_modules.sql` has not yet been run, run it separately as previously instructed.
