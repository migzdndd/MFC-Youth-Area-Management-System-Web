# Phase 6 Auth Hardening Fixes

This source package includes the remaining Phase 6 code fixes and route cleanup.

## Completed

- Restored and standardized the password recovery page as `Frontend/reset-password.html`.
- Removed the obsolete duplicate `Frontend/recover.html` page.
- Standardized clean public routes to `/forgot-password`, `/reset-password`, and `/change-email` (Vercel `cleanUrls` remains enabled).
- Hardened recovery-token handling: requires `type=recovery`, removes the token from the address bar immediately, never persists it, adds password confirmation, and uses a no-referrer page policy.
- Added server-side logout calls for both management and Member Portal logout buttons.
- Hardened temporary password-verification sessions so only the temporary session is revoked (`scope: local`).
- Updated normal password changes to use the original caller JWT rather than an admin password override.
- Added self-service Change Email UI and backend flow using the caller's JWT so Supabase Secure Email Change remains authoritative.
- Added best-effort `auth.users.email -> public.members.email` synchronization on the next authenticated backend request after confirmation.
- Kept the Area-scoped Admin Email Override and added the canonical dynamic route `/api/admin/members/:id/change-email`.
- Replaced misleading `Super Admin` terminology in active frontend/backend authorization logic with Area Admin / Area-level servant terminology. No `super_admin` database role was introduced.
- Removed the browser-only local account fallback from production login. The explicit Demo Dashboard remains isolated as the only local presentation-mode exception.
- Prevented Forgot Password from deriving recovery destinations from untrusted `Origin` / `Host` request headers.
- Pinned `@supabase/supabase-js` to `2.57.0` to match the approved Phase 6 compatibility design.

## Supabase Dashboard requirement

The Reset Password template must use the deployed clean route:

```html
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">
  Reset Password
</a>
```

Production Site URL should remain the deployed HTTPS Vercel site, and the reset route should be allowlisted where required.

## Validation performed

- `node --check` passed for all Backend and Frontend JavaScript files.
- All Frontend HTML files parsed successfully.
- Verified `reset-password.html`, `forgot-password.html`, and `change-email.html` exist.
- Verified obsolete `/recover` page/reference cleanup.
- No real `.env.local` file is included in the sanitized output ZIP.

## Manual end-to-end checks still required after deployment

1. Forgot Password email -> `/reset-password?token_hash=...&type=recovery`.
2. Recovery token disappears from the address bar immediately.
3. Old password fails and new password succeeds after reset.
4. Current-password change rejects an incorrect current password.
5. Normal logout revokes the server refresh session and clears browser storage.
6. Self-service email change requires Supabase confirmation and later synchronizes the Member record.
7. Area Admin email override is same-Area only; Chapter Servant and Member roles are denied.
