import { queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, isUuid, assertTrustedOrigin } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const LEADERSHIP_ROLES = new Set(['couple_coordinator','area_servant','lit_servant','chapter_servant']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'area-select', 20, 3600);
    const { profile, account } = await requireAuthenticatedProfile(req);
    if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: 'You do not have permission to select an Area.' });
    }
    if (profile.area_id) return sendJson(res, 409, { ok: false, error: 'Your account is already assigned to an Area.' });

    const areaId = String(req.body?.areaId || '').trim();
    if (!isUuid(areaId)) return sendJson(res, 400, { ok: false, error: 'Select a valid Area.' });

    const area = await queryOne('SELECT id,name,code,is_active FROM areas WHERE id = $1 LIMIT 1', [areaId]);
    if (!area || area.is_active === false) return sendJson(res, 404, { ok: false, error: 'The selected Area is not available.' });

    const memberLink = await ensureLeadershipMemberRecord({ account, profile, areaId: area.id });
    return sendJson(res, 200, {
      ok: true,
      area,
      profile: memberLink.profile,
      member: memberLink.member,
      memberCreated: memberLink.created,
      memberLinkedExisting: memberLink.linkedExisting
    });
  } catch (error) {
    return apiError(res, error);
  }
}
