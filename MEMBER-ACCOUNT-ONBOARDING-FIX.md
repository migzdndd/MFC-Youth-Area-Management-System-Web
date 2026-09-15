# Member Account Onboarding Fix

## New rule

When a Servant Leader/Admin creates a Member account, the system **does not generate, display, or share a temporary password**.

## New production flow

1. An authorized Servant Leader adds the Member using the Member's official email address.
2. The backend creates the Member record in Supabase.
3. The backend provisions the linked Supabase Auth user with `inviteUserByEmail()`.
4. Supabase sends the Member a secure email setup link.
5. The Member opens `/change-password` through that secure link.
6. The Member chooses their own permanent password.
7. The Member signs in normally with their email and chosen password.

## Existing-account reset flow

The Members **Access** action no longer resets a Member to an admin-visible password. It sends a secure password setup/reset email instead. The Member chooses the replacement password from the email link.

## Deployment requirements

Set this backend environment variable:

```env
FRONTEND_URL=https://mfc-youth-area-management-system.vercel.app
```

In **Supabase Dashboard → Authentication → URL Configuration**, add the frontend password page to the allowed Redirect URLs:

```text
https://mfc-youth-area-management-system.vercel.app/change-password
```

Add equivalent localhost redirect URLs when testing locally.

## Security result

- No Member temporary password is generated.
- No Member password is revealed to a Servant Leader/Admin.
- Member passwords are chosen by the Member.
- Setup/recovery proof comes from the Supabase email link.
- Existing `must_change_password` database compatibility remains, but new Member invite onboarding uses `false`.
