# Phase 6 — Authentication & Account Security Status

## Canonical recovery route

The repository uses `Frontend/reset-password.html`. Because `Frontend/vercel.json` has `cleanUrls: true`, the public route is:

```text
https://mfc-youth-area-management-system.vercel.app/reset-password
```

Use this Supabase Recovery email link:

```html
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">
  Reset Password
</a>
```

The obsolete `/recover` page has been removed.

## Implemented

- Forgot Password UI and generic anti-enumeration response.
- Recovery success alert is hidden until a recovery request returns successfully.
- Reset Password page reads `token_hash`, immediately removes it from the visible URL, validates password confirmation, calls the backend reset endpoint, and requires a fresh sign-in afterward.
- Change Password verifies the current password in a temporary non-persistent Supabase session and revokes that temporary session before updating the caller's real session password.
- Self-service secure email-change request UI/API.
- Auth email -> `public.members.email` synchronization on authenticated login/account fetch after email confirmation.
- Area-level admin email override for same-Area provisioned Member accounts; `ACCOUNT_NOT_PROVISIONED` does not create an account implicitly.
- Frontend logout now calls the backend Supabase logout endpoint before clearing local browser session state.
- Role naming standardized to Area-level roles; no `super_admin` role is introduced.
- Forgot/reset/change-password UI readability and mobile behavior improved.

## Manual Supabase settings already required

- Site URL: `https://mfc-youth-area-management-system.vercel.app`
- Recovery redirect allow-list includes `/reset-password`.
- Custom recovery email template uses `{{ .TokenHash }}`.
- Custom SMTP configured.
- Access-token expiry: 3600 seconds.
- Refresh-token reuse detection enabled.
- Single-session-per-user: OFF for the current Phase 6 current-password verification design.

## Final E2E checks

1. Existing email -> forgot-password request -> email arrives -> `/reset-password?token_hash=...&type=recovery` loads.
2. Green success alert appears only after the forgot-password request completes; it is not visible on initial page load.
3. Reset token disappears from the address bar immediately after page load.
4. Old password fails after reset; new password succeeds.
5. Used/expired recovery token cannot be reused.
6. Change Password rejects a wrong current password, accepts the right one, and the temporary verification session is revoked.
7. Self-service email change requires Supabase confirmation before the new email is treated as authoritative.
8. On next login/account fetch after confirmation, `members.email` synchronizes to the Auth email.
9. Area-level admin override works only for a same-Area Member with a provisioned account; Chapter Servant/member/cross-Area attempts are denied.
10. Logout invalidates the Supabase session and clears browser session state.
11. Browser/server logs contain no passwords, access tokens, refresh tokens, recovery token hashes, SMTP passwords, or Supabase secret keys.
