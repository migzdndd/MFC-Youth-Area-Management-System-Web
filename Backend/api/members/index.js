import { query, queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile, isSuperAdminRole, isChapterServantRole } from '../_lib/access.js';
import { hashPassword } from '../_lib/auth-session.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError, isUuid, optionalIsoDate, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';
import { generateTemporaryPassword } from '../_lib/password.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const ACCESS_LEVELS = new Set(['area_servant','lit_servant','chapter_servant','member']);

function cleanText(value, max = 255) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

async function loadAreaMember(memberId, areaId) {
  if (!isUuid(memberId) || !isUuid(areaId)) return null;
  return queryOne('SELECT * FROM members WHERE id = $1 AND area_id = $2 LIMIT 1', [memberId, areaId]);
}

async function validateChapter(chapterId, areaId) {
  if (!chapterId) return null;
  if (!isUuid(chapterId)) {
    const error = new Error('The selected chapter is invalid.');
    error.statusCode = 400;
    throw error;
  }
  const chapter = await queryOne('SELECT id, area_id FROM chapters WHERE id = $1 LIMIT 1', [chapterId]);
  if (!chapter || String(chapter.area_id) !== String(areaId)) {
    const error = new Error('The selected chapter does not belong to your Area.');
    error.statusCode = 400;
    throw error;
  }
  return chapter;
}

async function listMembers(req, res) {
  const { profile } = await requireAuthenticatedProfile(req);
  if (!profile.area_id && isSuperAdminRole(profile.role)) return sendJson(res, 200, { ok: true, members: [] });

  let where = 'id = $1';
  let params = [profile.member_id];
  if (isSuperAdminRole(profile.role)) {
    where = 'area_id = $1';
    params = [profile.area_id];
  } else if (isChapterServantRole(profile.role) && profile.chapter_id) {
    where = 'chapter_id = $1';
    params = [profile.chapter_id];
  }

  const members = await query(
    `SELECT id, area_id, chapter_id, first_name, middle_name, last_name, birth_date,
            contact_number, email, address, status, first_attended_youth_camp,
            access_level, created_at, updated_at
       FROM members
      WHERE ${where}
      ORDER BY last_name ASC, first_name ASC
      LIMIT 5000`,
    params
  );
  return sendJson(res, 200, { ok: true, members: members || [] });
}

function validatedMemberInput(input, existing = {}) {
  const firstName = cleanText(input.firstName ?? existing.first_name, 100);
  const middleName = cleanText(input.middleName ?? existing.middle_name, 100) || null;
  const lastName = cleanText(input.lastName ?? existing.last_name, 100);
  const email = normalizeEmail(input.email ?? existing.email);
  const contactNumber = cleanText(input.contactNumber ?? existing.contact_number, 50) || null;
  const address = cleanText(input.address ?? existing.address, 1000) || null;
  const birthDate = optionalIsoDate(input.birthDate ?? existing.birth_date ?? null);
  const firstAttendedYouthCamp = optionalIsoDate(input.firstAttendedYouthCamp ?? existing.first_attended_youth_camp ?? null);
  const status = String(input.status ?? existing.status ?? 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  const requestedRole = String(input.accessLevel ?? existing.access_level ?? 'member').trim().toLowerCase();
  if (requestedRole === 'couple_coordinator') {
    return { error: 'Couple Coordinator accounts are management-only and are not stored as Member records.' };
  }
  const accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  const chapterId = input.chapterId || existing.chapter_id || null;

  if (!firstName || !lastName) return { error: 'First name and last name are required.' };
  if (!isValidEmail(email)) return { error: 'A valid email is required because it is used for member login.' };
  if (birthDate === undefined || firstAttendedYouthCamp === undefined) return { error: 'One of the supplied dates is invalid.' };
  if (accessLevel === 'chapter_servant' && !chapterId) return { error: 'A Chapter Servant must be assigned to a chapter.' };

  return { firstName, middleName, lastName, email, contactNumber, address, birthDate,
    firstAttendedYouthCamp, status, accessLevel, chapterId };
}

async function createMember(req, res) {
  assertReasonableBody(req, 32 * 1024);
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'member-create', 100, 3600);
  const { profile, account } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role) && !isChapterServantRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'You do not have permission to add members.' });
  }

  const parsed = validatedMemberInput(req.body || {});
  if (parsed.error) return sendJson(res, 400, { ok: false, error: parsed.error });
  let { accessLevel, chapterId } = parsed;
  const areaId = profile.area_id;
  if (isChapterServantRole(profile.role)) {
    accessLevel = 'member';
    chapterId = profile.chapter_id;
  }
  if (!areaId) return sendJson(res, 409, { ok: false, error: 'Your account is not assigned to an Area.' });
  if (isChapterServantRole(profile.role) && !chapterId) {
    return sendJson(res, 409, { ok: false, error: 'Your Chapter Servant account is not assigned to a chapter.' });
  }
  await validateChapter(chapterId, areaId);

  const duplicateMember = await queryOne('SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [parsed.email]);
  const duplicateAccount = await queryOne('SELECT id FROM accounts WHERE LOWER(email) = LOWER($1) LIMIT 1', [parsed.email]);
  if (duplicateMember || duplicateAccount) return sendJson(res, 409, { ok: false, error: 'A member/account with that email already exists.' });

  const temporaryPassword = generateTemporaryPassword(14);
  const passwordHash = await hashPassword(temporaryPassword);
  let member = null;
  let newAccount = null;
  let newProfile = null;
  try {
    member = await queryOne(
      `INSERT INTO members
        (area_id, chapter_id, first_name, middle_name, last_name, birth_date, contact_number,
         email, address, status, first_attended_youth_camp, access_level, created_by_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [areaId, chapterId, parsed.firstName, parsed.middleName, parsed.lastName, parsed.birthDate,
       parsed.contactNumber, parsed.email, parsed.address, parsed.status, parsed.firstAttendedYouthCamp,
       accessLevel, account.id]
    );

    const displayName = [parsed.firstName, parsed.middleName, parsed.lastName].filter(Boolean).join(' ');
    newAccount = await queryOne(
      `INSERT INTO accounts (email, display_name, password_hash, is_active)
       VALUES ($1,$2,$3,$4) RETURNING id,email,display_name`,
      [parsed.email, displayName, passwordHash, parsed.status !== 'Inactive']
    );
    newProfile = await queryOne(
      `INSERT INTO profiles
        (account_id, auth_user_id, member_id, role, area_id, chapter_id, must_change_password, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)
       RETURNING *`,
      [newAccount.id, String(newAccount.id), member.id, accessLevel, areaId, chapterId, parsed.status !== 'Inactive']
    );

    return sendJson(res, 201, {
      ok: true,
      member,
      account: { email: parsed.email, temporaryPassword, mustChangePassword: true, role: accessLevel }
    });
  } catch (error) {
    if (newProfile?.id) await query('DELETE FROM profiles WHERE id = $1', [newProfile.id]).catch(() => {});
    if (newAccount?.id) await query('DELETE FROM accounts WHERE id = $1', [newAccount.id]).catch(() => {});
    if (member?.id) await query('DELETE FROM members WHERE id = $1', [member.id]).catch(() => {});
    throw error;
  }
}

async function updateMember(req, res) {
  assertReasonableBody(req, 32 * 1024);
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'member-update', 200, 3600);
  const { profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can edit member records.' });
  }
  const memberId = String(req.body?.id || '');
  if (!isUuid(memberId)) return sendJson(res, 400, { ok: false, error: 'A valid Member ID is required.' });
  const existing = await loadAreaMember(memberId, profile.area_id);
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  const parsed = validatedMemberInput(req.body || {}, existing);
  if (parsed.error) return sendJson(res, 400, { ok: false, error: parsed.error });
  await validateChapter(parsed.chapterId, profile.area_id);

  const duplicate = await queryOne(
    'SELECT id FROM members WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
    [parsed.email, memberId]
  );
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'Another member already uses that email address.' });

  const linked = await queryOne(
    `SELECT p.id AS profile_id, p.account_id
       FROM profiles p WHERE p.member_id = $1 LIMIT 1`,
    [memberId]
  );
  if (linked?.account_id) {
    const duplicateAccount = await queryOne(
      'SELECT id FROM accounts WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1',
      [parsed.email, linked.account_id]
    );
    if (duplicateAccount) return sendJson(res, 409, { ok: false, error: 'Another account already uses that email address.' });
  }

  const updated = await queryOne(
    `UPDATE members
        SET chapter_id=$1, first_name=$2, middle_name=$3, last_name=$4, birth_date=$5,
            contact_number=$6, email=$7, address=$8, status=$9,
            first_attended_youth_camp=$10, access_level=$11, updated_at=NOW()
      WHERE id=$12 AND area_id=$13 RETURNING *`,
    [parsed.chapterId, parsed.firstName, parsed.middleName, parsed.lastName, parsed.birthDate,
     parsed.contactNumber, parsed.email, parsed.address, parsed.status, parsed.firstAttendedYouthCamp,
     parsed.accessLevel, memberId, profile.area_id]
  );

  if (linked?.profile_id) {
    await query(
      `UPDATE profiles SET role=$2, chapter_id=$3, is_active=$4, updated_at=NOW() WHERE id=$1`,
      [linked.profile_id, parsed.accessLevel, parsed.chapterId, parsed.status !== 'Inactive']
    );
    await query(
      `UPDATE accounts SET email=$2, display_name=$3, is_active=$4, updated_at=NOW() WHERE id=$1`,
      [linked.account_id, parsed.email, [parsed.firstName, parsed.middleName, parsed.lastName].filter(Boolean).join(' '), parsed.status !== 'Inactive']
    );
  }
  return sendJson(res, 200, { ok: true, member: updated });
}

async function deleteMember(req, res) {
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'member-delete', 50, 3600);
  const { profile, account } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can delete member records.' });
  }
  const memberId = String(req.query?.id || req.body?.id || '');
  if (!isUuid(memberId)) return sendJson(res, 400, { ok: false, error: 'A valid Member ID is required.' });
  const member = await loadAreaMember(memberId, profile.area_id);
  if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });
  if (String(profile.member_id || '') === memberId || String(member.email).toLowerCase() === String(account.email).toLowerCase()) {
    return sendJson(res, 409, { ok: false, error: 'Use Delete Account to remove your own signed-in account.' });
  }

  const linked = await queryOne('SELECT account_id FROM profiles WHERE member_id = $1 LIMIT 1', [memberId]);
  if (linked?.account_id) await query('DELETE FROM accounts WHERE id = $1', [linked.account_id]);
  await query('DELETE FROM members WHERE id = $1 AND area_id = $2', [memberId, profile.area_id]);

  return sendJson(res, 200, { ok: true, deleted: true, deletedAuthUser: Boolean(linked?.account_id), memberId });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listMembers(req, res);
    if (req.method === 'POST') return await createMember(req, res);
    if (req.method === 'PATCH') return await updateMember(req, res);
    if (req.method === 'DELETE') return await deleteMember(req, res);
    return methodNotAllowed(res, ['GET','POST','PATCH','DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
