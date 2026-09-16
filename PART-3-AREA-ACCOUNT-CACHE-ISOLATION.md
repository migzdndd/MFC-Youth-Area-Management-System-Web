# Part 3 — Area / Account Browser Cache Isolation

## Goal
Prevent cached cloud data from one authenticated user or MFC Youth Area from being rendered for another account that later signs in on the same browser.

## Implementation

The management application and Member Portal no longer use the shared `mfc_web_database_v1` key for authenticated cloud sessions.

Cloud sessions now use a scoped key in this form:

```text
mfc_web_database_v1::cloud::<area-id>::<account-id>
```

The account component prefers the Supabase user ID, then the linked Member ID, then the normalized email as a final fallback. Accounts that have not selected an Area yet use an isolated `unassigned-area` scope.

The legacy `mfc_web_database_v1` key is retained only for the explicit browser/demo fallback so existing prototype/demo data is not silently destroyed.

## Logout behavior

Explicit logout, account deletion, and self-member deletion now remove the current authenticated cloud cache before removing the session. This reduces sensitive data remaining in the browser after sign-out.

## Important behavior

- Area A / Account A cannot read Area B / Account B's cache through normal application rendering.
- A newly authenticated cloud account starts from its own scoped cache and then synchronizes from Supabase.
- Old global browser data is never auto-migrated into a cloud scope because its original owner/Area cannot be safely proven.
- Supabase remains the source of truth for authenticated cloud mode.
- Legacy prototype cache data remains separate from authenticated cloud cache scopes. The later complete-functioning fix removes the Demo Dashboard entry point.

## Files changed

- `Frontend/js/app.js`
- `Frontend/js/member.js`
- `Frontend/package.json`
- `SECURITY.md`
- `PERFORMANCE-RESILIENCE.md`
- `CLOUD-MIGRATION-STATUS.md`
- `ACCOUNT-FLOW-CHANGELOG.md`
