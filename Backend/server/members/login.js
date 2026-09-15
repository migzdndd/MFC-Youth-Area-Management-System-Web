import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';
import { passwordSetupRedirectUrl } from '../_lib/frontend-url.js';
import { sendJson, methodNotAllowed, isGmailEmail, apiError } from '../_lib/http.js';

async function sendAccountOtp(email) {
  const authClient = createSupabaseAuthClient();
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });
  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { supabase, profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can manage member account access.' });
    }

    const memberId = req.body?.memberId;
    if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('*')
      .eq('id', memberId)
      .eq('area_id', profile.area_id)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });
    if (!member.email || !isGmailEmail(member.email)) {
      return sendJson(res, 400, { ok: false, error: 'This account needs a valid @gmail.com address before OTP access can be configured.' });
    }

    const role = String(member.access_level || 'member').toLowerCase();
    const { data: linkedProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (profileError) throw profileError;

    if (member.status === 'Inactive') {
      return sendJson(res, 409, { ok: false, error: 'This account is inactive. Activate the Member before sending account access.' });
    }

    let authUserId = linkedProfile?.id || null;
    let createdAccount = false;

    if (!authUserId) {
      const { data: authData, error: authCreateError } = await supabase.auth.admin.createUser({
        email: member.email,
        email_confirm: true,
        user_metadata: {
          display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
          registration_type: role === 'member' ? 'admin_provisioned_member' : 'admin_provisioned_leader',
          onboarding_method: 'email_otp',
          requested_role: role
        }
      });
      if (authCreateError || !authData?.user) throw authCreateError || new Error('Unable to create the account.');
      authUserId = authData.user.id;
      createdAccount = true;

      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: authUserId,
          member_id: member.id,
          role,
          area_id: member.area_id,
          chapter_id: member.chapter_id,
          must_change_password: role !== 'member',
          is_active: true
        });

      if (profileInsertError) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
        throw profileInsertError;
      }
    }

    // Regular Members always use passwordless email OTP by default.
    if (role === 'member') {
      await sendAccountOtp(member.email);
      return sendJson(res, 200, {
        ok: true,
        account: {
          email: member.email,
          codeSent: true,
          existingAccount: !createdAccount,
          mustChangePassword: false,
          passwordRequired: false,
          role: 'member',
          onboardingMethod: 'email_otp'
        },
        message: 'A one-time sign-in code was sent to the Member Gmail account. No password is required.'
      });
    }

    // Newly provisioned Servant Leaders must prove ownership of their Gmail
    // address with OTP before they are allowed to create their password.
    const mustChangePassword = createdAccount || linkedProfile?.must_change_password === true;
    if (mustChangePassword) {
      await sendAccountOtp(member.email);
      return sendJson(res, 200, {
        ok: true,
        account: {
          email: member.email,
          codeSent: true,
          existingAccount: !createdAccount,
          mustChangePassword: true,
          passwordRequired: true,
          role,
          onboardingMethod: 'email_otp_then_password'
        },
        message: 'A Gmail verification code was sent. After verification, the Servant Leader will be prompted to create their account password.'
      });
    }

    // Already-activated leaders use the existing recovery flow when Access is
    // requested again; OTP remains mandatory for the registration/onboarding stage.
    const redirectTo = passwordSetupRedirectUrl(req);
    const authClient = createSupabaseAuthClient();
    const { error: resetError } = await authClient.auth.resetPasswordForEmail(member.email, { redirectTo });
    if (resetError) throw resetError;

    return sendJson(res, 200, {
      ok: true,
      account: {
        email: member.email,
        setupEmailSent: true,
        existingAccount: true,
        mustChangePassword: false,
        passwordRequired: true,
        role,
        onboardingMethod: 'password_reset_email'
      },
      message: 'This Servant Leader account is already activated. A secure password reset email was sent.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
