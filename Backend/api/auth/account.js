import { query } from '../_lib/db.js';
import { requireAuthenticatedProfile, isSuperAdminRole, isChapterServantRole } from '../_lib/access.js';
import { clearSessionCookie } from '../_lib/auth-session.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, apiError, assertTrustedOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  try {
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'delete-account', 5, 3600);
    const { account, profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile?.role) && !isChapterServantRole(profile?.role)) {
      return sendJson(res, 403, { ok: false, error: 'Account deletion from the management portal is available only to Servant Leader accounts.' });
    }

    const memberId = profile?.member_id || null;
    await query('DELETE FROM accounts WHERE id = $1', [account.id]);
    if (memberId) await query('DELETE FROM members WHERE id = $1', [memberId]);
    clearSessionCookie(res);

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
