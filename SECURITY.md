# Security Policy

## Supported Versions
Only the latest **Web Beta (Phase 6)** receives security updates. Older versions are unsupported.

## Reporting a Vulnerability
Please report security vulnerabilities privately to **miguel7riovaldez@gmail.com**. Do not open public issues for security exploits.

## Security Architecture
- Connections to Supabase are strictly HTTPS.
- SQL injection is mitigated via parameterized queries using `@supabase/supabase-js`.
- Strict Row Level Security (RLS) restricts data access per user and area.
- Secrets (`SUPABASE_SECRET_KEY`) reside only in the backend and must never be exposed to the browser.
- Password updates and recoveries utilize secure, isolated Supabase sessions.
