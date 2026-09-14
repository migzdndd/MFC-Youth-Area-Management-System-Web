-- MFC Youth Area Management System
-- Run this ONCE on the Neon database that already contains the 10 application tables
-- created during the initial Neon setup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_unique ON accounts (LOWER(email));

ALTER TABLE areas ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS created_by_account_id UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_id UUID;

-- The earlier temporary schema required auth_user_id; the new backend uses account_id instead.
ALTER TABLE profiles ALTER COLUMN auth_user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_created_by_account_id_fkey'
  ) THEN
    ALTER TABLE members
      ADD CONSTRAINT members_created_by_account_id_fkey
      FOREIGN KEY (created_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_id_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_account_id_unique
  ON profiles(account_id) WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash CHAR(64) NOT NULL,
  action TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (key_hash, action)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_started_at);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Performance indexes used by the new backend.
CREATE INDEX IF NOT EXISTS idx_members_area ON members(area_id);
CREATE INDEX IF NOT EXISTS idx_members_chapter ON members(chapter_id);
CREATE INDEX IF NOT EXISTS idx_profiles_area ON profiles(area_id);
CREATE INDEX IF NOT EXISTS idx_profiles_member ON profiles(member_id);
CREATE INDEX IF NOT EXISTS idx_chapters_area ON chapters(area_id);
CREATE INDEX IF NOT EXISTS idx_services_area ON services(area_id);

-- Keep updated_at consistent for the auth tables.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;
CREATE TRIGGER accounts_set_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON profiles;
CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Delete expired sessions opportunistically whenever this migration is re-run.
DELETE FROM sessions WHERE expires_at <= NOW();
