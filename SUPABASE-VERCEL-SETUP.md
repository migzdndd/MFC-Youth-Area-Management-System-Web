# MFC Youth Web — Supabase + Vercel Setup

This repository uses two Vercel projects from one GitHub repository:

- **Backend project** — Root Directory: `Backend`
- **Frontend project** — Root Directory: `Frontend`
- **Database + Auth** — Supabase

## 1. Create a fresh Supabase project

Create a new Supabase project and wait for it to finish provisioning.

Do not reuse any previously leaked/revoked secret key.

## 2. Create the database schema

In Supabase -> SQL Editor:

1. Run `Backend/supabase/001_initial_schema.sql`.
2. Optionally edit and then run `Backend/supabase/002_seed_reference_data.sql`.

The optional seed creates `MFC Youth NCR Central` and the default Services. If you want to create the Area from the app instead, skip the seed file.

## 3. Get the Supabase values

From the Supabase project **Connect** dialog or **Settings -> API Keys**, copy:

- Project URL -> `SUPABASE_URL`
- Publishable key (`sb_publishable_...`) -> `SUPABASE_PUBLISHABLE_KEY`
- Secret key (`sb_secret_...`) -> `SUPABASE_SECRET_KEY`

The secret key is backend-only. Never place it in Frontend files, GitHub, screenshots, ZIP backups, or chat messages.

## 4. Configure the Vercel Backend project

Import this GitHub repository into Vercel (or reuse the existing Backend project).

Set:

- **Root Directory:** `Backend`

Add these Vercel Environment Variables to **Production and Preview**:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
ADMIN_REGISTRATION_CODE=your-private-registration-code
```

Redeploy the Backend after saving environment variables.

Then open:

```text
https://YOUR-BACKEND.vercel.app/api/health
```

A healthy response should include:

```json
{
  "ok": true,
  "configured": true,
  "databaseConnected": true
}
```

## 5. Configure the Vercel Frontend project

Import the **same GitHub repository** as a second Vercel project (or reuse the existing Frontend project).

Set:

- **Root Directory:** `Frontend`

Add this Environment Variable:

```text
BACKEND_URL=https://YOUR-BACKEND.vercel.app
```

Do not add `/api` to the end of `BACKEND_URL`.

Redeploy the Frontend after saving it.

## 6. Test the application

Recommended test order:

1. Open the Frontend login page.
2. Create a Servant Leader account using First-Time Access.
3. Select or create an Area.
4. Confirm the account appears in Supabase Authentication.
5. Confirm the linked row exists in `public.profiles`.
6. For non-Couple-Coordinator leaders, confirm a linked row appears in `public.members` after Area onboarding.
7. Log out and log back in.
8. Test Members View / Edit / Services / GIG / Login / Delete.

## 7. Local development (optional)

Create `Backend/.env.local` from `Backend/.env.example` and fill in your real values.

Never commit `.env.local`.

The repository includes `.gitattributes` to prevent Windows line-ending changes from making already-committed files appear modified.

## Security rules

- `SUPABASE_SECRET_KEY` must exist only in Backend server environments.
- Keep Row Level Security enabled on Supabase tables.
- The browser should communicate with the Frontend/Backend API, not directly with the secret key.
- Rotate a secret key immediately if it is ever committed or uploaded publicly.
- Do not commit source ZIPs containing local environment files.
