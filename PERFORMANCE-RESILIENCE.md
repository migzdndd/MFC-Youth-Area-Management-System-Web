# Performance & Resilience Update

## Page loading
- Management pages render immediately from cached/browser data instead of waiting for cloud synchronization.
- Supabase synchronization for Members, Chapters, Services, Events, Participants, Reports, GIG, and Dashboard analytics now runs in the background after the initial render.
- Page-specific skeleton loaders are injected before `app.js` executes and mirror dashboard cards, toolbars, tables, service cards, events, reports, and the Member Portal.
- Internal links are prefetched during idle time and on hover.
- Navigation no longer has an artificial delay.

## Crash/error handling
- Backend API calls now have an 8-second client timeout with friendly network/timeout errors.
- Page rendering is wrapped in a crash boundary that shows a recoverable Try Again card instead of leaving a blank page.
- Background cloud synchronization failures do not wipe or block cached content.
- Loader/prefetch/navigation operations use defensive try/catch handling.
- Unhandled browser and promise errors are logged for debugging.

## Security note
Real `.env.local` files are intentionally excluded from distribution. Configure secrets locally or in Vercel environment variables only.

## Authentication policy

- Member records do not require login accounts or passwords.
- Account access is provisioned deliberately by authorized Admins using the email already stored on the Member record.
- Optional Member Portal access uses a secure password setup link.
- Servant Leader/Admin access uses password authentication after Admin-controlled provisioning.
- The private Servant Leader registration code is never used as the user's account password.

## Session resilience
- Access tokens are refreshed automatically when they are close to expiration.
- A 401 `INVALID_SESSION` / `AUTH_REQUIRED` response triggers one refresh attempt and one retry of the original authenticated request.
- Concurrent requests share the same in-flight refresh operation so the browser does not send multiple refresh requests at once.
- The authentication/change-password pages can also refresh a stored backend session when an authenticated request expires.
- If the refresh token itself is no longer valid, the cloud session and its scoped protected cache are cleared and the user is returned to sign-in.

## Part 3 — scoped fast cache

Immediate cached rendering is preserved, but authenticated cloud sessions now render only from an Area/account-scoped cache. Network synchronization still runs in the background, so this keeps the fast page-switching behavior without showing another account's previous cache.

A cloud cache is cleared on explicit logout/account removal and on definitive authentication failure. The legacy global cache is not used by authenticated cloud sessions.

## Authentication Failure Behavior

A failed cloud sign-in fails closed instead of falling back to browser-stored prototype credentials. The Demo Dashboard entry point has been removed.

## Account provisioning state

Member listing hydrates `account_setup_required` from `profiles.must_change_password`, so cached UI state can be corrected by the next cloud refresh. Password setup clears that flag server-side only after the password update succeeds.


## Member Portal session resilience

The Member Portal now uses the same access-token refresh/retry policy as the management dashboard. Setup-pending Member accounts are redirected to password setup before protected Member Portal data is synchronized or rendered.
