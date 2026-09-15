-- =========================================================
-- Account password / OTP onboarding policy
-- =========================================================
-- Self-registered Servant Leaders choose their own account password, but the
-- profile is created only after their Gmail address is verified by email OTP.
-- Their final profile uses must_change_password = false.
--
-- Admin-provisioned Servant Leaders are created without a password, receive a
-- Gmail OTP, and use must_change_password = true until OTP verification lets
-- them create their permanent password.
--
-- Admin-provisioned regular Members are passwordless by default. Members use
-- one-time Gmail codes and may optionally add a password later.

alter table public.profiles
  alter column must_change_password set default false;
