# Web(7) OTP Removal Audit

## Result

The Web(7) source was corrected so email OTP / verification-code authentication is no longer part of the active application flow.

## Preserved UI

The existing Dashboard, Members, Chapters, Services, Reports, Events, navigation, Member form layout, and existing Member inputs were preserved. The existing **System Access Level** input remains the control used to assign leadership access.

## Current account flow

### Regular Members

- Creating a normal Member creates the database record only.
- A normal Member does not require a login account or password.
- Optional Member Portal access may be provisioned later through **Members → Access**.

### Servant Leaders / Admins

- Leadership access is assigned through the Member record's existing **System Access Level** field.
- Creating or promoting a Member to a leadership role provisions the linked Supabase Auth/Profile account.
- The system uses the email already stored on the Member record.
- A secure password setup link can be sent to the Member's email.
- No temporary password is generated or shown to the Admin.

### Bootstrap Admin registration

- The existing controlled Admin registration page remains for initial/bootstrap access.
- It uses the Administrator Registration Code and a user-chosen password.
- There is no email OTP stage.

## Removed from Web(7)

- Member email-code request endpoint
- Member email-code verification endpoint
- Self-claim endpoint/helper
- `signInWithOtp()` and `verifyOtp()` application calls
- Gmail-only account validation
- Email-code UI panels and handlers
- Old Gmail/email-code documentation

## Packaging

`Backend/.env.local` is excluded from this corrected source package. Keep real secrets only in local/Vercel environment variables.
