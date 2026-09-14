# MFC Youth Area Management System — Web

Web companion for the MFC Youth Area Management System.

## Architecture

```text
Browser
  -> Frontend (Vercel, Root Directory: Frontend)
  -> Backend API (Vercel, Root Directory: Backend)
  -> Supabase Auth + PostgreSQL
```

## Setup

Start with [`SUPABASE-VERCEL-SETUP.md`](./SUPABASE-VERCEL-SETUP.md).

## Repository safety

Real `.env` / `.env.local` files, `.vercel` state, node_modules, and ZIP archives are ignored. This distributed source package intentionally contains no `.git` directory and no real credentials.
