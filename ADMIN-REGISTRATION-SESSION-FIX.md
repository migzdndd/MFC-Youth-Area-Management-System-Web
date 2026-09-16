# Admin Registration Session Fix

## Problem
A newly created Servant Leader/Admin account could successfully register and reach the Area setup modal, but the first authenticated Area request could fail with:

`Session is invalid or expired.`

This prevented the Existing Area list from loading and prevented creation of a new Area even though account creation itself succeeded.

## Fix
- End-user bearer tokens are now validated with the Supabase publishable/anon Auth client instead of the privileged backend client.
- The backend secret/service-role client remains responsible for profile and database operations only.
- Added `POST /api/auth/refresh` to exchange a valid refresh token for a fresh access token.
- Authenticated frontend API requests now retry once after a successful automatic session refresh when the backend returns `INVALID_SESSION` or `AUTH_REQUIRED`.
- Refreshed access/refresh tokens and profile fields are persisted back into the existing browser session.
- No OTP flow was restored or reintroduced.
- Existing Dashboard, Members, Chapters, Services, Reports, Events, and Area onboarding UI structure are preserved.

## Expected flow
1. Create a new Admin/Servant Leader account.
2. The registration endpoint signs the account in and stores its access + refresh session.
3. Dashboard opens Area setup.
4. `/api/areas` validates the new access token using the user Auth client.
5. If the access token is stale/invalid but the refresh token is valid, the app refreshes once and retries automatically.
6. Existing Areas load, or the account can create a new Area.
