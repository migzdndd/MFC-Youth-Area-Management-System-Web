import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';

const LEADERSHIP_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { supabase, profile } = await requireAuthenticatedProfile(req);
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

    const { data: updatedProfile, error: profileError } = await supabase
      .from('profiles')
      .update({ area_id: area.id })
      .eq('id', profile.id)
      .is('area_id', null)
      .select('id, role, area_id, chapter_id')
      .single();
    if (profileError) throw profileError;

    return sendJson(res, 200, {
      ok: true,
      area,
      profile: updatedProfile
    });
  } catch (error) {
    return apiError(res, error);
  }
}
