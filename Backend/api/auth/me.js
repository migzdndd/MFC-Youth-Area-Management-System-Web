import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const { user, profile, supabase } = await requireAuthenticatedProfile(req);
    let member = null;

    if (profile.member_id) {
      const { data, error } = await supabase
        .from('members')
        .select('id, first_name, middle_name, last_name, email, status, area_id, chapter_id, first_attended_youth_camp')
        .eq('id', profile.member_id)
        .maybeSingle();
      if (error) throw error;
      member = data;
    }

    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        memberId: profile.member_id,
        role: profile.role,
        areaId: profile.area_id,
        chapterId: profile.chapter_id,
        mustChangePassword: profile.must_change_password
      },
      member
    });
  } catch (error) {
    return apiError(res, error);
  }
}
