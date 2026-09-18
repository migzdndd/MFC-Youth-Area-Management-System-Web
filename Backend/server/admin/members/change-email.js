import { requireAuthenticatedProfile, isAreaAdminRole } from '../../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, isValidEmail, normalizeEmail } from '../../_lib/http.js';

function audit({ actorId, memberId, status, errorCode = null }) {
  const entry = {
    event: 'ADMIN_EMAIL_OVERRIDE',
    action: 'CHANGE_MEMBER_AUTH_EMAIL',
    actor_id: actorId,
    target_member_id: memberId,
    timestamp: new Date().toISOString(),
    status
  };
  if (errorCode) entry.error_code = errorCode;
  const line = JSON.stringify(entry);
  if (status === 'SUCCESS') console.info(line);
  else console.error(line);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { user, profile, supabase } = await requireAuthenticatedProfile(req);

    if (!isAreaAdminRole(profile.role)) {
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
      .select('id, area_id, email')
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
    if (!targetProfile?.id) {
      return sendJson(res, 400, {
        ok: false,
        error: 'This member does not have a provisioned portal account.',
        code: 'ACCOUNT_NOT_PROVISIONED'
      });
    }
    if (targetProfile.id === user.id) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Use Account Security to change your own sign-in email.',
        code: 'SELF_SERVICE_REQUIRED'
      });
    }

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(targetProfile.id, { email: newEmail });
    if (authUpdateError) {
      audit({ actorId: user.id, memberId: targetMember.id, status: 'FAILURE', errorCode: 'AUTH_UPDATE_FAILED' });
      throw authUpdateError;
    }

    const { error: syncError } = await supabase
      .from('members')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', targetMember.id);

    if (syncError) {
      audit({ actorId: user.id, memberId: targetMember.id, status: 'PARTIAL_FAILURE', errorCode: 'MEMBER_SYNC_FAILED' });
      return sendJson(res, 200, {
        ok: true,
        syncPending: true,
        message: 'The account email was changed. The Member record will be synchronized on a later authenticated account fetch.'
      });
    }

    audit({ actorId: user.id, memberId: targetMember.id, status: 'SUCCESS' });
    return sendJson(res, 200, {
      ok: true,
      syncPending: false,
      message: 'Account email has been successfully overridden.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
