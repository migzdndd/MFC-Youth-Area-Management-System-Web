import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';

const LEADERSHIP_ROLES = new Set([
  'national_coordinator',
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'mfc_high_servant',
  'area_kids_servant',
  'chapter_servant'
]);

/**
 * API Route Handler: Allows a leadership profile to select and assign themselves to an Area.
 *
 * @param {import('http').IncomingMessage} req - The HTTP request object.
 * @param {import('http').ServerResponse} res - The HTTP response object.
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { supabase, profile, user } = await requireAuthenticatedProfile(req);
    if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: 'You do not have permission to select an Area.' });
    }
    if (profile.area_id) {
      return sendJson(res, 409, { ok: false, error: 'Your account is already assigned to an Area.' });
    }

    const areaId = String(req.body?.areaId || '').trim();
    if (!areaId) {
      return sendJson(res, 400, { ok: false, error: 'Select an Area.' });
    }

    const { data: area, error: areaError } = await supabase
      .from('areas')
      .select('id, name, code, is_active')
      .eq('id', areaId)
      .maybeSingle();
    if (areaError) throw areaError;
    if (!area || area.is_active === false) {
      return sendJson(res, 404, { ok: false, error: 'The selected Area is not available.' });
    }

    const memberLink = await ensureLeadershipMemberRecord({
      supabase,
      user,
      profile,
      areaId: area.id
    });

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
