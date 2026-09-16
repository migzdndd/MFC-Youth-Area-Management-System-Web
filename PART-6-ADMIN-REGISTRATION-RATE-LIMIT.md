# Part 6 — Administrator Registration Rate Limiting

This phase hardens the bootstrap **Register an Admin Account** flow against repeated guessing of the server-only `ADMIN_REGISTRATION_CODE`.

## Policy

- Maximum failed registration-code attempts: **5**
- Counting window: **15 minutes**
- Lockout after the limit is reached: **15 minutes**
- A locked request returns HTTP **429 Too Many Requests** and a `Retry-After` header.
- A correct registration code clears previous failures for the matching rate-limit scopes.

## Scope

Failures are tracked using two privacy-preserving identifiers:

1. Request client address fingerprint.
2. Submitted email fingerprint.

The backend stores only HMAC-SHA256 fingerprints. It does not store the raw client IP address in `auth_rate_limits`.

The HMAC key is the existing server-only `ADMIN_REGISTRATION_CODE`, so no new browser-visible configuration is introduced.

## Required Supabase migration

Run:

```text
Backend/supabase/006_admin_registration_rate_limit.sql
```

This creates:

```text
public.auth_rate_limits
public.check_auth_rate_limit(...)
public.record_auth_rate_limit_failure(...)
public.reset_auth_rate_limit(...)
```

Browser roles cannot read or modify the rate-limit table/functions. Execution is granted only to the Supabase backend service role.

The bootstrap registration endpoint intentionally fails closed with `RATE_LIMIT_STORAGE_NOT_CONFIGURED` if the migration has not been applied.

## Existing behavior preserved

- Admin registration still uses the same form and inputs.
- No OTP flow was reintroduced.
- Existing Admin-managed Member/account provisioning remains unchanged.
- Part 2 session refresh remains active.
- Part 3 Area/account cache isolation remains active.
- Part 4 production/demo authentication isolation remains active.
- Part 5 setup-pending account state remains active.
