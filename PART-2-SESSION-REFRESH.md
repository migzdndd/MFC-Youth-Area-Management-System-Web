# Part 2 — Session Refresh and New-Admin Area Setup Fix

This update restores and strengthens the session lifecycle that was accidentally reverted in Web(8).

## Changes

- `Backend/server/_lib/access.js` now validates end-user bearer tokens with `createSupabaseAuthClient()` and uses `createSupabaseAdmin()` only after authentication for profile/data operations.
- Added `POST /api/auth/refresh` in `Backend/server/auth/refresh.js`.
- Registered `auth/refresh` in the single Vercel API router.
- `Frontend/js/app.js` now:
  - refreshes an access token shortly before expiry,
  - retries a protected request once after `INVALID_SESSION` or `AUTH_REQUIRED`,
  - stores rotated access/refresh tokens,
  - deduplicates concurrent refresh attempts.
- `Frontend/js/auth.js` now retries authenticated password/account requests once after a successful refresh.
- Backend/Frontend package versions moved to the `admin-session-fix` revision.

## Expected new-admin flow

```text
Create Admin / Servant Leader
        ↓
Supabase creates + signs in account
        ↓
Access token + refresh token stored
        ↓
Dashboard opens Area setup
        ↓
Protected Area API validates user token
        ↓
If access token expires, refresh token renews it
        ↓
Original request retries once
```

## Validation performed

- JavaScript syntax check across Backend + Frontend
- JSON parse validation
- Relative-import resolution
- `auth/refresh` route presence
- End-user token verification uses the normal Auth client
- OTP endpoints/calls remain absent
- `.env.local` remains excluded from the distributable ZIP
