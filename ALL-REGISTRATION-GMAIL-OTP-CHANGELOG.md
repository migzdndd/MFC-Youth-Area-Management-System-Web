# All-Registration Gmail OTP Authentication Changelog

## Implemented

- Enforced `@gmail.com` for new Admin, Servant Leader, and Member registration/onboarding.
- Changed self-registered Servant Leader/Admin signup into a two-step Gmail OTP flow.
- The Admin profile is now created only after Supabase verifies the email OTP.
- Admin-created regular Members remain passwordless and use Gmail OTP.
- Admin-created Servant Leaders now receive Gmail OTP before first-time password creation instead of being onboarded only through an invite/password link.
- First-time Servant Leaders can use the OTP-authenticated session to create their password without entering a nonexistent current password.
- Members → Access can resend Gmail OTP for Members and not-yet-activated Servant Leaders.
- Established Servant Leaders retain normal password sign-in and password recovery behavior.
- Backend validation prevents frontend bypass of the Gmail-only registration rule.
- No Member temporary password is created or exposed.
- Added production Supabase email/SMTP setup documentation.

## No database migration required

The existing `profiles.must_change_password` field is reused for Admin-provisioned Servant Leaders who have verified neither their first-time OTP nor created their permanent password yet.
