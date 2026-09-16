# Part 1 — Safe Local Environment and Source Packaging

## What changed

- `Backend/.env.local` is still the correct place for real local credentials on the developer's computer.
- `.gitignore` already excludes `Backend/.env.local`; that rule was preserved.
- Shared source packages must not contain `.env.local`.
- Added `scripts/package-source.ps1` so future source ZIPs automatically exclude local secrets and build/cache files.
- Added packaging guidance to `SECURITY.md`.

## Local development

Keep your existing real file locally:

```text
Backend/.env.local
```

Do not overwrite it with `.env.example`.

## Safe package command

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-source.ps1
```

The resulting ZIP intentionally does not contain `.env.local`.

## Production

Configure the real environment values in Vercel Project Settings -> Environment Variables.
