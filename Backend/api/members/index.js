import {
  requireAuthenticatedProfile,
  isSuperAdminRole,
  isChapterServantRole
} from '../_lib/access.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
  apiError
} from '../_lib/http.js';
import { generateTemporaryPassword } from '../_lib/password.js';

const ACCESS_LEVELS = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant',
  'member'
]);

function cleanText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

async function listMembers(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);

  let query = supabase
    .from('members')
    .select('id, area_id, chapter_id, first_name, middle_name, last_name, birth_date, contact_number, email, status, first_attended_youth_camp, access_level, created_at, updated_at')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  if (isSuperAdminRole(profile.role)) {
    query = query.eq('area_id', profile.area_id);
  } else if (isChapterServantRole(profile.role)) {
    query = query.eq('chapter_id', profile.chapter_id);
  } else {
    query = query.eq('id', profile.member_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  return sendJson(res, 200, { ok: true, members: data || [] });
}

async function createMember(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role) && !isChapterServantRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'You do not have permission to add members.' });
  }

  const input = req.body || {};
  const firstName = cleanText(input.firstName, 100);
  const middleName = cleanText(input.middleName, 100) || null;
  const lastName = cleanText(input.lastName, 100);
  const email = normalizeEmail(input.email);
  const contactNumber = cleanText(input.contactNumber, 50) || null;
  const address = cleanText(input.address, 1000) || null;
  const birthDate = input.birthDate || null;
  const firstAttendedYouthCamp = input.firstAttendedYouthCamp || null;
  const status = String(input.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';

  if (!firstName || !lastName) {
    return sendJson(res, 400, { ok: false, error: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { ok: false, error: 'A valid email is required because it is used for member login.' });
  }

  const requestedRole = String(input.accessLevel || 'member').trim().toLowerCase();
  let accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  let areaId = profile.area_id;
  let chapterId = input.chapterId || null;

  if (isChapterServantRole(profile.role)) {
    accessLevel = 'member';
    chapterId = profile.chapter_id;
  }

  if (!areaId) {
    return sendJson(res, 409, { ok: false, error: 'Your account is not assigned to an Area.' });
  }
  if (isChapterServantRole(profile.role) && !chapterId) {
    return sendJson(res, 409, { ok: false, error: 'Your Chapter Servant account is not assigned to a chapter.' });
  }

  if (chapterId) {
    const { data: chapter, error: chapterError } = await supabase
      .from('chapters')
      .select('id, area_id')
      .eq('id', chapterId)
      .maybeSingle();
    if (chapterError) throw chapterError;
    if (!chapter || String(chapter.area_id) !== String(areaId)) {
      return sendJson(res, 400, { ok: false, error: 'The selected chapter does not belong to your Area.' });
    }
  }

  const { data: existingMember, error: existingError } = await supabase
    .from('members')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingMember) {
    return sendJson(res, 409, { ok: false, error: 'A member with that email already exists.' });
  }

  const temporaryPassword = generateTemporaryPassword();
  let createdMember = null;
  let createdAuthUserId = null;

  try {
    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({
        area_id: areaId,
        chapter_id: chapterId,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        birth_date: birthDate,
        contact_number: contactNumber,
        email,
        address,
        status,
        first_attended_youth_camp: firstAttendedYouthCamp,
        access_level: accessLevel,
        created_by: user.id
      })
      .select('*')
      .single();
    if (memberError) throw memberError;
    createdMember = member;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        display_name: [firstName, middleName, lastName].filter(Boolean).join(' ')
      }
    });
    if (authError || !authData?.user) throw authError || new Error('Unable to create login account.');
    createdAuthUserId = authData.user.id;

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: createdAuthUserId,
        member_id: createdMember.id,
        role: accessLevel,
        area_id: areaId,
        chapter_id: chapterId,
        must_change_password: true,
        is_active: status !== 'Inactive'
      });
    if (profileError) throw profileError;

    return sendJson(res, 201, {
      ok: true,
      member: createdMember,
      account: {
        email,
        temporaryPassword,
        mustChangePassword: true,
        role: accessLevel
      }
    });
  } catch (error) {
    if (createdAuthUserId) {
      await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => {});
    }
    if (createdMember?.id) {
      await supabase.from('members').delete().eq('id', createdMember.id).catch(() => {});
    }
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listMembers(req, res);
    if (req.method === 'POST') return await createMember(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return apiError(res, error);
  }
}
