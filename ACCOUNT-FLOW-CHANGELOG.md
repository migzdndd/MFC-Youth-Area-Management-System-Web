# Admin-Managed Account Flow Update

## Decision

The Web App now uses an Admin-managed, password-based account provisioning flow.

The Dashboard, management pages, Member form layout, and existing Member input structure were preserved.

## Current account model

### Regular Member records

- A Member can exist in the database without a login account.
- No password is required simply to create or maintain the Member record.
- No login account is automatically created for a normal `member` access level.
- If Member Portal access is wanted later, a Super Admin uses **Members → Access**.
- The Member receives a secure password setup/reset link at the email already stored on the Member record.

### Servant Leader / Admin accounts

- Leadership access is assigned using the existing **System Access Level** input on the Member form.
- Creating a new Member with a leadership role provisions the linked Auth/Profile account.
- Promoting an existing Member to a leadership role provisions the account if it does not already exist.
- **Members → Access** can create, link, or refresh account access.
- The leader chooses their own password through the secure setup link.
- No temporary password is generated or displayed to the administrator.

### Controlled bootstrap registration

The existing **Register an Admin Account** form remains for initial/bootstrap management access. It keeps its existing fields and no longer has an email-code stage.

If the registration email matches an existing Member record, the account is linked to that Member.

## Backend changes

- Removed the email-code request/verify routes.
- Removed the old self-claim route.
- Added reusable Admin-controlled account provisioning logic.
- Member creation no longer creates login accounts for normal Members.
- Leadership Member creation/promotion can provision Auth/Profile records.
- Members API now reports account provisioning state for accurate UI badges.
- Provider-specific email restrictions were removed; normal valid email addresses are accepted.

## Frontend changes

- Removed email-code panels and related handlers.
- Login is password-based for provisioned login accounts.
- Updated **Members → Access** to create/refresh account access using the stored Member email.
- Preserved management page structure, Dashboard layout, Member fields, and System Access Level input.
- Updated account-status badges to distinguish **Not Provisioned**, **Setup Pending**, **Active**, and **Disabled** where cloud status is available.

## Security behavior

- No password is sent back to Admins.
- No temporary password is generated.
- Password setup/reset links are handled through Supabase Auth.
- Backend role, Area, and Chapter authorization remain enforced.
- Real environment files remain excluded from distributable source packages.

## Part 3 — Area/account cache isolation

- Authenticated cloud cache keys are now scoped by Area and account identity.
- The management dashboard and Member Portal use the same scoped-cache rule.
- Explicit logout and account deletion clear the current cloud cache.
- Legacy `mfc_web_database_v1` data remains demo-only and is not migrated into authenticated cloud scopes.

## Part 4 — Production Auth Isolation

- Production email/password login is now Supabase/backend-only.
- Removed browser-account fallback after failed cloud login.
- Legacy `mfc_demo_users` credentials are no longer accepted.
- Demo access is explicit and isolated through the Demo button.
- Member Portal requires a real cloud-authenticated Member session.

## Part 5 - Account setup status

Provisioned Member Portal and Servant Leader accounts now remain **Setup Pending** while `must_change_password = true`. Completing the secure password setup clears the flag and changes the Members UI to **Active**. A Member record itself still does not require a login/password.
