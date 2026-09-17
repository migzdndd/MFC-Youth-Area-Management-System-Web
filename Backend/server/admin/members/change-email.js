import { requireAuthenticatedProfile, isSuperAdminRole } from '../../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, isValidEmail, normalizeEmail } from '../../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { user, profile, supabase } = await requireAuthenticatedProfile(req);
    
    if (!isSuperAdminRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'Only Area-level servants can override email addresses.' });
    }

    const memberId = req.body?.id || req.query?.id;
    if (!memberId) {
      return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });
    }

    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!isValidEmail(newEmail)) {
      return sendJson(res, 400, { ok: false, error: 'A valid email is required.' });
    }

    const { data: targetMember, error: memberError } = await supabase
      .from('members')
      .select('id, area_id')
      .eq('id', memberId)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!targetMember || targetMember.area_id !== profile.area_id) {
      return sendJson(res, 403, { ok: false, error: 'Member not found or not in your Area.' });
    }

    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, member_id')
      .eq('member_id', targetMember.id)
      .maybeSingle();
      
    if (profileError) throw profileError;
    if (!targetProfile || !targetProfile.id) {
      return sendJson(res, 400, { ok: false, error: 'This member does not have a provisioned portal account.', code: 'ACCOUNT_NOT_PROVISIONED' });
    }

    const authId = targetProfile.id;
    const { data: authData, error: authUpdateError } = await supabase.auth.admin.updateUserById(authId, { email: newEmail });

    if (authUpdateError) {
      console.error(JSON.stringify({
        event: 'ADMIN_EMAIL_OVERRIDE',
        actor_id: user.id,
        target_member_id: targetMember.id,
        timestamp: new Date().toISOString(),
        status: 'FAILURE',
        error_code: 'AUTH_UPDATE_FAILED'
      }));
      throw authUpdateError;
    }

    const { error: syncError } = await supabase
      .from('members')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', targetMember.id);

    if (syncError) {
      console.error(JSON.stringify({
        event: 'ADMIN_EMAIL_OVERRIDE',
        actor_id: user.id,
        target_member_id: targetMember.id,
        timestamp: new Date().toISOString(),
        status: 'SUCCESS',
        error_code: 'SYNC_FAILED'
      }));
    } else {
      console.info(JSON.stringify({
        event: 'ADMIN_EMAIL_OVERRIDE',
        actor_id: user.id,
        target_member_id: targetMember.id,
        timestamp: new Date().toISOString(),
        status: 'SUCCESS'
      }));
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Account email has been successfully overridden.'
    });

  } catch (error) {
    return apiError(res, error);
  }
}
