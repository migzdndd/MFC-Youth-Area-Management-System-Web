import {
  requireAuthenticatedProfile,
  isAreaAdminRole,
  isChapterServantRole
} from '../_lib/access.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
  apiError
} from '../_lib/http.js';
import { ensureRoleServiceAssignment } from '../_lib/service-catalog.js';
import { requireArea } from '../_lib/cloud-data.js';

const ACCESS_LEVELS = new Set([
  'national_coordinator',
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'mfc_high_servant',
  'area_kids_servant',
  'chapter_servant',
  'member'
]);

function cleanText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

async function loadAreaMember(supabase, memberId, areaId) {
  if (!memberId || !areaId) return null;
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', memberId)
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function validateChapter(supabase, chapterId, areaId) {
  if (!chapterId) return null;
  const { data: chapter, error } = await supabase
    .from('chapters')
    .select('id, area_id')
    .eq('id', chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!chapter || String(chapter.area_id) !== String(areaId)) {
    const invalid = new Error('The selected chapter does not belong to your Area.');
    invalid.statusCode = 400;
    throw invalid;
  }
  return chapter;
}

async function listMembers(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);

  let query = supabase
    .from('members')
    .select('id, area_id, chapter_id, first_name, middle_name, last_name, birth_date, contact_number, email, address, status, first_attended_youth_camp, access_level, academic_track, grade_level, school, created_at, updated_at')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  const areaId = requireArea(req, profile);

  if (isAreaAdminRole(profile.role)) {
    query = query.eq('area_id', areaId);
  } else if (isChapterServantRole(profile.role)) {
    query = profile.chapter_id
      ? query.eq('chapter_id', profile.chapter_id)
      : query.eq('id', profile.member_id);
  } else {
    query = query.eq('id', profile.member_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  return sendJson(res, 200, { ok: true, members: data || [] });
}

async function createMember(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role) && !isChapterServantRole(profile.role)) {
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
  const academicTrack = cleanText(input.academicTrack, 100) || null;
  const gradeLevel = cleanText(input.gradeLevel, 50) || null;
  const school = cleanText(input.school, 255) || null;

  if (!firstName || !lastName) {
    return sendJson(res, 400, { ok: false, error: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, error: 'A valid email is required.' });

  const requestedRole = String(input.accessLevel || 'member').trim().toLowerCase();
  let accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  const areaId = requireArea(req, profile);
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
  if (accessLevel === 'chapter_servant' && !chapterId) {
    return sendJson(res, 400, { ok: false, error: 'A Chapter Servant must be assigned to a chapter.' });
  }

  await validateChapter(supabase, chapterId, areaId);

  const { data: existingMember, error: existingError } = await supabase
    .from('members')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingMember) {
    return sendJson(res, 409, { ok: false, error: 'A member with that email already exists.' });
  }

  const { data: createdMember, error: memberError } = await supabase
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
      academic_track: academicTrack,
      grade_level: gradeLevel,
      school,
      created_by: user.id
    })
    .select('*')
    .single();
  if (memberError) throw memberError;

  await ensureRoleServiceAssignment(supabase, {
    memberId: createdMember.id,
    areaId,
    role: accessLevel
  });

  return sendJson(res, 201, { ok: true, member: createdMember });
}

async function updateMember(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can edit member records.' });
  }

  const input = req.body || {};
  const memberId = input.id;
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

  const areaId = requireArea(req, profile);
  const existing = await loadAreaMember(supabase, memberId, areaId);
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  const firstName = cleanText(input.firstName ?? existing.first_name, 100);
  const middleName = cleanText(input.middleName ?? existing.middle_name, 100) || null;
  const lastName = cleanText(input.lastName ?? existing.last_name, 100);
  const email = normalizeEmail(input.email ?? existing.email);
  const contactNumber = cleanText(input.contactNumber ?? existing.contact_number, 50) || null;
  const address = cleanText(input.address ?? existing.address, 1000) || null;
  const birthDate = input.birthDate ?? existing.birth_date ?? null;
  const firstAttendedYouthCamp = input.firstAttendedYouthCamp ?? existing.first_attended_youth_camp ?? null;
  const status = String(input.status ?? existing.status) === 'Inactive' ? 'Inactive' : 'Active';
  const academicTrack = cleanText(input.academicTrack ?? existing.academic_track, 100) || null;
  const gradeLevel = cleanText(input.gradeLevel ?? existing.grade_level, 50) || null;
  const school = cleanText(input.school ?? existing.school, 255) || null;
  const requestedRole = String(input.accessLevel ?? existing.access_level ?? 'member').trim().toLowerCase();
  const accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  const chapterId = input.chapterId || null;

  if (!firstName || !lastName) {
    return sendJson(res, 400, { ok: false, error: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { ok: false, error: 'A valid email is required.' });
  }
  if (accessLevel === 'chapter_servant' && !chapterId) {
    return sendJson(res, 400, { ok: false, error: 'A Chapter Servant must be assigned to a chapter.' });
  }

  await validateChapter(supabase, chapterId, areaId);

  const { data: duplicate, error: duplicateError } = await supabase
    .from('members')
    .select('id')
    .ilike('email', email)
    .neq('id', memberId)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'Another member already uses that email address.' });

  const { data: updated, error: updateError } = await supabase
    .from('members')
    .update({
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
      academic_track: academicTrack,
      grade_level: gradeLevel,
      school
    })
    .eq('id', memberId)
    .eq('area_id', areaId)
    .select('*')
    .single();
  if (updateError) throw updateError;

  const { data: linkedProfile, error: linkedProfileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('member_id', memberId)
    .maybeSingle();
  if (linkedProfileError) throw linkedProfileError;

  if (linkedProfile?.id) {
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        role: accessLevel,
        chapter_id: chapterId,
        is_active: status !== 'Inactive'
      })
      .eq('id', linkedProfile.id);
    if (profileUpdateError) throw profileUpdateError;

    const authChanges = {
      email,
      user_metadata: {
        display_name: [firstName, middleName, lastName].filter(Boolean).join(' ')
      }
    };
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(linkedProfile.id, authChanges);
    if (authUpdateError) throw authUpdateError;
  }

  await ensureRoleServiceAssignment(supabase, {
    memberId: updated.id,
    areaId,
    role: accessLevel
  });

  return sendJson(res, 200, { ok: true, member: updated });
}

async function deleteMember(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can delete member records.' });
  }

  const memberId = req.query?.id || req.body?.id;
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

  const areaId = requireArea(req, profile);
  const member = await loadAreaMember(supabase, memberId, areaId);
  if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  // A signed-in leader must never be able to remove their own member record
  // through the Members management endpoint. Full self-deletion is handled
  // separately by /api/auth/account so it is an explicit account action.
  if (String(profile.member_id || '') === String(memberId)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'You cannot delete your own member record from the Members tab. Use Delete Account if you intend to permanently remove your account.'
    });
  }

  const { data: linkedProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('member_id', memberId)
    .maybeSingle();
  if (profileError) throw profileError;

  // Defense in depth for legacy profiles whose member_id may not have been
  // hydrated yet: never delete the profile/auth user making this request.
  if (linkedProfile?.id && String(linkedProfile.id) === String(profile.id)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'You cannot delete your own member record from the Members tab. Use Delete Account if you intend to permanently remove your account.'
    });
  }

  if (linkedProfile?.id) {
    return sendJson(res, 409, {
      ok: false,
      error: 'This Member is linked to a portal account. Delete the account explicitly before deleting the Member record.'
    });
  }

  const { error: memberDeleteError } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
    .eq('area_id', areaId);
  if (memberDeleteError) throw memberDeleteError;

  return sendJson(res, 200, {
    ok: true,
    deleted: true,
    deletedAuthUser: false,
    memberId
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listMembers(req, res);
    if (req.method === 'POST') return await createMember(req, res);
    if (req.method === 'PATCH') return await updateMember(req, res);
    if (req.method === 'DELETE') return await deleteMember(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
