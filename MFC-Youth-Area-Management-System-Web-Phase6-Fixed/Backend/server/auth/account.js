import { requireAuthenticatedProfile, isAreaAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';

/**
 * Permanently deletes the currently authenticated account.
 * Supabase Auth is deleted first so the login can never remain usable if
 * database cleanup encounters an unexpected error afterward.
 */
export default async function handler(req, res) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  try {
    const { supabase, user, profile } = await requireAuthenticatedProfile(req);
    if (!isAreaAdminRole(profile?.role) && !isChapterServantRole(profile?.role)) {
      return sendJson(res, 403, { ok: false, error: 'Account deletion from the management portal is available only to Servant Leader accounts.' });
    }

    const memberId = profile?.member_id || null;

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (authDeleteError) throw authDeleteError;

    // profiles.id references auth.users ON DELETE CASCADE, so the profile is
    // removed by the Auth deletion. The linked member is intentionally cleaned
    // up afterward because auth.users does not own public.members directly.
    if (memberId) {
      const { error: memberDeleteError } = await supabase
        .from('members')
        .delete()
        .eq('id', memberId);
      if (memberDeleteError) throw memberDeleteError;
    }

    return sendJson(res, 200, {
      ok: true,
      deleted: true,
      deletedAuthUser: true,
      deletedMember: Boolean(memberId)
    });
  } catch (error) {
    return apiError(res, error);
  }
}
