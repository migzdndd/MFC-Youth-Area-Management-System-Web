# Account Onboarding Policy

This document defines the current Admin-managed account flow.

## Core rule

A **Member record** and a **login account** are separate concepts.

- A regular Member can exist in the database with no login account and no password.
- Login access is created only when an authorized Admin intentionally enables it.
- Existing dashboard structure and Member form inputs remain unchanged.
- Account creation uses the email already stored on the Member record.
- No temporary password is generated.

## Regular Members

1. An authorized Servant Leader/Admin creates the Member record.
2. No login account is required.
3. If Member Portal access is wanted, a Super Admin opens **Members → Access**.
4. The backend creates/links the Supabase Auth account for that Member.
5. A secure password setup link is sent to the Member email.
6. The Member chooses their own password and can then sign in to the Member Portal.

Member Portal access is optional; being a Member in the database never requires a password.

## Servant Leaders / Admins

Leadership accounts should normally be created from an existing Member record:

1. The Admin opens **Members**.
2. The Member's **System Access Level** is set to the approved leadership role.
3. The backend creates or links the Supabase Auth account using the Member email.
4. A secure password setup link is sent to the Member email.
5. The leader chooses their own password.
6. Their Area/Chapter scope comes from the linked Member/profile data.

The **Members → Access** action can also create or refresh the account setup link.

## Initial/bootstrap administrator

The existing **Register an Admin Account** form remains available as a controlled bootstrap path using:

- Full Name
- Email Address
- System Access Level
- Administrator Registration Code
- Account Password
- Confirm Account Password

This path does not generate a temporary password. If the email already matches a Member record, the new leadership account is linked to that Member.
