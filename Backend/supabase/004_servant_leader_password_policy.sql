-- =========================================================
-- Servant Leader password policy
-- =========================================================
-- Self-registered Servant Leaders choose their own account password and
-- use the password they chose during registration.
--
-- Admin-provisioned Member accounts use secure email-invite onboarding.
-- Members choose their own permanent password from the invite link, so the
-- backend does not generate temporary passwords and does not set
-- must_change_password = true.

alter table public.profiles
  alter column must_change_password set default false;
