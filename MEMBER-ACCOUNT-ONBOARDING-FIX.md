# Account Onboarding Policy

This document supersedes the earlier temporary-password onboarding design.

## Regular Members

- Admin/Servant Leader supplies the Member's `@gmail.com` address.
- The backend provisions the Auth identity without a password.
- Supabase sends a Gmail OTP.
- The Member enters the OTP to access the Member Portal.
- Password remains optional.

## Admin-provisioned Servant Leaders

- Admin supplies the Servant Leader's `@gmail.com` address and access level.
- The account is provisioned without a password.
- Supabase sends a Gmail OTP.
- OTP verification is required before first-time password creation.
- The verified Servant Leader creates their permanent password.

## Self-registered Servant Leaders/Admins

- Registration requires a valid Gmail address and the private Administrator Registration Code.
- Supabase sends a Gmail OTP before the application profile is finalized.
- The profile is created only after successful OTP verification.
- No temporary password is generated.

See `ALL-REGISTRATION-GMAIL-OTP.md` for deployment and SMTP configuration.
