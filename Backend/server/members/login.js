import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';
import { passwordSetupRedirectUrl } from '../_lib/frontend-url.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';

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
    if (!member.email) return sendJson(res, 400, { ok: false, error: 'This Member needs a valid email address before account access can be configured.' });

    const { data: linkedProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (profileError) throw profileError;

    const redirectTo = passwordSetupRedirectUrl(req);

    if (linkedProfile?.id) {
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
          role: member.access_level || 'member',
          onboardingMethod: 'password_reset_email'
        },
        message: 'A secure password setup/reset email was sent to the Member. No temporary password was generated.'
      });
    }

    const { data: authData, error: authCreateError } = await supabase.auth.admin.inviteUserByEmail(member.email, {
      redirectTo,
      data: {
        display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
        registration_type: 'admin_provisioned_member',
        onboarding_method: 'email_invite'
      }
    });
    if (authCreateError || !authData?.user) throw authCreateError || new Error('Unable to send the Member account setup email.');

    const authUserId = authData.user.id;
    const { error: profileInsertError } = await supabase
      .from('profiles')
      .insert({
        id: authUserId,
        member_id: member.id,
        role: member.access_level || 'member',
        area_id: member.area_id,
        chapter_id: member.chapter_id,
        must_change_password: false,
        is_active: member.status !== 'Inactive'
      });

    if (profileInsertError) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
      throw profileInsertError;
    }

    return sendJson(res, 200, {
      ok: true,
      account: {
        email: member.email,
        setupEmailSent: true,
        existingAccount: false,
        mustChangePassword: false,
        role: member.access_level || 'member',
        onboardingMethod: 'email_invite'
      },
      message: 'The Member account was created and a secure setup email was sent. No temporary password was generated.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
