-- MFC Youth Area Management System
-- Account password / admin-provisioned onboarding policy
--
-- Regular Member records do not require a login account or password.
-- When Member Portal access is intentionally enabled, an Admin provisions the
-- linked Supabase Auth account and sends a secure password setup link.
--
-- Servant Leader/Admin accounts are created from Member records where possible.
-- Newly provisioned leadership accounts use must_change_password = true until
-- the user chooses a password through the secure setup flow.

alter table public.profiles
  alter column must_change_password set default false;
