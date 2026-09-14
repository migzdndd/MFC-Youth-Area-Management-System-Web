import { query, queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile, isSuperAdminRole, isChapterServantRole } from '../_lib/access.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, apiError, isUuid, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    assertReasonableBody(req, 32 * 1024);
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'chapter-assign-members', 100, 3600);
    const { profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile.role) && !isChapterServantRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'You do not have permission to assign chapter members.' });
    }

    const chapterId = String(req.body?.chapterId || '');
    const memberIds = Array.isArray(req.body?.memberIds)
      ? [...new Set(req.body.memberIds.map(String).filter(isUuid))].slice(0, 100)
      : [];
    if (!isUuid(chapterId)) return sendJson(res, 400, { ok: false, error: 'A valid Chapter ID is required.' });
    if (!memberIds.length) return sendJson(res, 400, { ok: false, error: 'Select at least one member.' });

    const chapter = await queryOne('SELECT id,area_id FROM chapters WHERE id=$1 AND area_id=$2 AND is_active=TRUE LIMIT 1', [chapterId, profile.area_id]);
    if (!chapter) return sendJson(res, 404, { ok: false, error: 'Chapter not found in your Area.' });
    if (isChapterServantRole(profile.role) && String(profile.chapter_id || '') !== chapterId) {
      return sendJson(res, 403, { ok: false, error: 'You can only assign members to your own chapter.' });
    }

    const updated = [];
    for (const memberId of memberIds) {
      const member = await queryOne(
        `UPDATE members
            SET chapter_id=$1, updated_at=NOW()
          WHERE id=$2 AND area_id=$3 AND chapter_id IS NULL
          RETURNING id,chapter_id`,
        [chapterId, memberId, profile.area_id]
      );
      if (member) {
        updated.push(member.id);
        await query(
          'UPDATE profiles SET chapter_id=$1, updated_at=NOW() WHERE member_id=$2',
          [chapterId, member.id]
        );
      }
    }

    return sendJson(res, 200, { ok: true, assignedMemberIds: updated, assignedCount: updated.length });
  } catch (error) {
    return apiError(res, error);
  }
}
