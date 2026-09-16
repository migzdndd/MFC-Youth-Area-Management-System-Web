# Part 5 - Account Setup State Accuracy

## Goal
Prevent newly provisioned login accounts from appearing **Active** before the account owner has actually created a password.

## Behavior

### Regular Member record
A Member record still does **not** require a login account or password.

### Optional Member Portal access
When an authorized Admin chooses **Members -> Access** for a regular Member:

1. The linked Supabase Auth account is created or refreshed.
2. `profiles.must_change_password` is set to `true`.
3. A secure password setup/reset email is sent.
4. The Members UI reports **Setup Pending**.
5. `/api/auth/change-password` sets `must_change_password = false` only after the password update succeeds.
6. The next Members refresh reports the account as **Active**.

### Servant Leader access
The same Setup Pending -> Active transition applies to provisioned leadership accounts.

## Resend / Access behavior
Choosing **Access** again is treated as an explicit setup/reset action. The account returns to **Setup Pending** until the setup link is completed. This also repairs Member Portal accounts created by older builds that were incorrectly shown as Active before password setup.

## UI preservation
No Dashboard, Members form, Chapters, Services, Reports, or Events layout was redesigned. The existing `System Access Level` field remains unchanged.

## Security model
No temporary passwords and no OTP flow are introduced. Password setup continues to use Supabase's secure recovery/setup link and the backend `change-password` endpoint.
