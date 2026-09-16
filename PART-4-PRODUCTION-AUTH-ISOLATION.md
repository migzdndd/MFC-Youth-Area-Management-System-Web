# Part 4 — Production Authentication Isolation

## Goal

Separate the production Supabase authentication path from the old browser-only prototype account fallback without redesigning the existing login, Dashboard, Members, Chapters, Reports, Events, or Services interfaces.

## Changes

- The normal email/password sign-in form now authenticates only through `/api/auth/login`.
- Failed Supabase/backend authentication no longer falls back to `mfc_demo_users` stored in `localStorage`.
- The obsolete `mfc_demo_users` browser credential registry is removed when the updated frontend starts.
- Legacy browser-only sessions are rejected and redirected to the sign-in page.
- Password changes require either a valid cloud-authenticated session or a valid secure setup/recovery link.
- Member Portal access requires a cloud-authenticated Member session. Browser-created Member accounts are no longer accepted.
- Demo mode remains available only through the explicit **Open Demo Dashboard** button.
- Demo mode is marked with `demo: true`, `backendAuth: false`, and `authMode: 'demo'` and continues to use only isolated local presentation data.
- Real cloud sessions are marked with `backendAuth: true`, `demo: false`, and `authMode: 'cloud'`.
- Demo/local Member editing no longer creates browser login accounts; account provisioning remains a backend/Supabase operation.

## Security Result

Editing `localStorage.mfc_demo_users` can no longer create a production login. A forged legacy browser-only session is also discarded. The explicit Demo session may still be recreated in browser storage, but it is intentionally isolated from cloud APIs and live Area data.

## Preserved Behavior

- Existing Dashboard structure and inputs remain unchanged.
- Part 1 safe environment packaging remains in place.
- Part 2 session refresh remains in place.
- Part 3 Area/account-scoped cloud cache remains in place.
- OTP authentication remains removed.
