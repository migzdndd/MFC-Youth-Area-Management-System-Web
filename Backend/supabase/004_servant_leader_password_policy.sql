-- =========================================================
-- Servant Leader password policy
-- =========================================================
-- Self-registered Servant Leaders choose their own account password and
-- must not be forced through the temporary-password flow.
--
-- Admin-provisioned Member accounts continue to set
-- must_change_password = true explicitly in the backend.

alter table public.profiles
  alter column must_change_password set default false;
