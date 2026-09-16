import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { ensureMemberAuthAccount, sendPasswordSetupEmail } from '../_lib/account-provision.js';
import { sendJson, methodNotAllowed, isValidEmail, apiError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { supabase, profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can manage Member account access.' });
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
    if (!member.email || !isValidEmail(member.email)) {
      return sendJson(res, 400, { ok: false, error: 'Add a valid Member email address before configuring account access.' });
    }
    if (member.status === 'Inactive') {
      return sendJson(res, 409, { ok: false, error: 'This account is inactive. Activate the Member before configuring account access.' });
    }

    const role = String(member.access_level || 'member').trim().toLowerCase();
    const leaderAccount = role !== 'member';

    // A Member record itself never requires a login/password. However, once an
    // Admin explicitly enables optional Member Portal access, that provisioned
    // login must remain Setup Pending until the Member creates a password.
    const account = await ensureMemberAuthAccount({
      supabase,
      member,
      role,
      requirePasswordSetup: true
    });

    let setupEmailSent = false;
    let emailWarning = '';

    try {
      await sendPasswordSetupEmail(req, member.email);
      setupEmailSent = true;
    } catch (error) {
      emailWarning = 'Account access was created, but the password setup email could not be sent. Try Access again after checking the email configuration.';
    }

    return sendJson(res, 200, {
      ok: true,
      account: {
        email: member.email,
        setupEmailSent,
        existingAccount: !account.createdAccount,
        mustChangePassword: account.profile?.must_change_password === true,
        // Password is required only for the provisioned login account. A plain
        // Member record still has no password requirement.
        passwordRequired: true,
        role,
        onboardingMethod: 'admin_password_setup'
      },
      message: setupEmailSent
        ? (leaderAccount
          ? 'Servant Leader account setup is pending. A secure password setup link was sent to the Member email.'
          : 'Optional Member Portal setup is pending. A secure password setup link was sent to the Member email.')
        : emailWarning
    });
  } catch (error) {
    return apiError(res, error);
  }
}
