-- =========================================================
-- Servant Leader password policy
-- =========================================================
-- Self-registered Servant Leaders choose their own account password and
-- must not be forced through the temporary-password flow.
--
-- Newly created Member records do not create Auth accounts. Existing profiles
-- keep their stored password-change state for compatibility.

alter table public.profiles
  alter column must_change_password set default false;
