import { queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const { account, profile: authenticatedProfile } = await requireAuthenticatedProfile(req);
    let profile = authenticatedProfile;
    let member = null;

    if (!profile.member_id && profile.area_id) {
      const memberLink = await ensureLeadershipMemberRecord({
        account,
        profile,
        areaId: profile.area_id,
        chapterId: profile.chapter_id
      });
      profile = memberLink.profile;
      member = memberLink.member;
    }

    if (!member && profile.member_id) {
      member = await queryOne(
        `SELECT id, first_name, middle_name, last_name, email, status, area_id,
                chapter_id, first_attended_youth_camp, access_level, contact_number, address, birth_date
           FROM members WHERE id = $1 LIMIT 1`,
        [profile.member_id]
      );
    }

    return sendJson(res, 200, {
      ok: true,
      user: {
        id: account.id,
        email: account.email,
        name: account.display_name || account.email,
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
