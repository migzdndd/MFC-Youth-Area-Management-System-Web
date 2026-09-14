import { query, queryOne } from './db.js';
import { normalizeEmail } from './http.js';

const LEADERSHIP_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

const MEMBER_BACKED_ADMIN_ROLES = new Set([
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

function cleanText(value, max = 160) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function splitDisplayName(displayName, email) {
  const safeName = cleanText(displayName, 240) || cleanText(String(email || '').split('@')[0], 120) || 'Member';
  const parts = safeName.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], middleName: null, lastName: parts[0] };
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    lastName: parts[parts.length - 1]
  };
}

function memberLinkError(message, statusCode = 409, code = 'MEMBER_LINK_FAILED') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export async function ensureLeadershipMemberRecord({ account, profile, areaId, chapterId }) {
  const role = String(profile?.role || '').trim().toLowerCase();
  if (!LEADERSHIP_ROLES.has(role)) return { profile, member: null, created: false, linkedExisting: false };

  const targetAreaId = String(areaId || profile?.area_id || '').trim();
  const targetChapterId = chapterId !== undefined ? (chapterId || null) : (profile?.chapter_id || null);
  if (!targetAreaId) return { profile, member: null, created: false, linkedExisting: false };

  if (!MEMBER_BACKED_ADMIN_ROLES.has(role)) {
    const updatedProfile = await queryOne(
      `UPDATE profiles
          SET area_id = $1,
              chapter_id = COALESCE($2, chapter_id),
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [targetAreaId, targetChapterId, profile.id]
    );
    return { profile: updatedProfile, member: null, created: false, linkedExisting: false };
  }

  if (profile?.member_id) {
    const linked = await queryOne('SELECT * FROM members WHERE id = $1', [profile.member_id]);
    if (linked) {
      const updatedMember = await queryOne(
        `UPDATE members
            SET area_id = $1,
                chapter_id = COALESCE($2, chapter_id),
                access_level = $3,
                status = $4,
                updated_at = NOW()
          WHERE id = $5
          RETURNING *`,
        [targetAreaId, targetChapterId, role, profile.is_active === false ? 'Inactive' : 'Active', linked.id]
      );
      const updatedProfile = await queryOne(
        `UPDATE profiles
            SET area_id = $1, member_id = $2,
                chapter_id = COALESCE($3, chapter_id), updated_at = NOW()
          WHERE id = $4 RETURNING *`,
        [targetAreaId, updatedMember.id, targetChapterId, profile.id]
      );
      return { profile: updatedProfile, member: updatedMember, created: false, linkedExisting: false };
    }
  }

  const email = normalizeEmail(account?.email);
  if (!email) throw memberLinkError('This account does not have a valid email address.', 400, 'MEMBER_EMAIL_REQUIRED');

  const existingMember = await queryOne('SELECT * FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  if (existingMember) {
    if (String(existingMember.area_id) !== targetAreaId) {
      throw memberLinkError('A member with this email already belongs to another Area.', 409, 'MEMBER_AREA_CONFLICT');
    }
    const otherProfile = await queryOne(
      'SELECT id FROM profiles WHERE member_id = $1 AND id <> $2 LIMIT 1',
      [existingMember.id, profile.id]
    );
    if (otherProfile) throw memberLinkError('This member record is already linked to another account.', 409, 'MEMBER_ALREADY_LINKED');

    const updatedMember = await queryOne(
      `UPDATE members
          SET chapter_id = COALESCE($1, chapter_id), access_level = $2,
              status = $3, updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [targetChapterId, role, profile.is_active === false ? 'Inactive' : 'Active', existingMember.id]
    );
    const updatedProfile = await queryOne(
      `UPDATE profiles
          SET member_id = $1, area_id = $2,
              chapter_id = COALESCE($3, chapter_id), updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [updatedMember.id, targetAreaId, targetChapterId, profile.id]
    );
    return { profile: updatedProfile, member: updatedMember, created: false, linkedExisting: true };
  }

  const { firstName, middleName, lastName } = splitDisplayName(account?.display_name, email);
  let member = null;
  try {
    member = await queryOne(
      `INSERT INTO members
        (area_id, chapter_id, first_name, middle_name, last_name, email, status, access_level, created_by_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [targetAreaId, targetChapterId, firstName, middleName, lastName, email,
       profile.is_active === false ? 'Inactive' : 'Active', role, account.id]
    );
    const updatedProfile = await queryOne(
      `UPDATE profiles
          SET member_id = $1, area_id = $2,
              chapter_id = COALESCE($3, chapter_id), updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [member.id, targetAreaId, targetChapterId, profile.id]
    );
    return { profile: updatedProfile, member, created: true, linkedExisting: false };
  } catch (error) {
    if (member?.id) await query('DELETE FROM members WHERE id = $1', [member.id]).catch(() => {});
    throw error;
  }
}
