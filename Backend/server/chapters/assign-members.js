import {
  requireAuthenticatedProfile,
  isAreaAdminRole,
  isChapterServantRole
} from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { requireArea, ensureChapterInArea } from '../_lib/cloud-data.js';

function canAssign(profile) {
  return isAreaAdminRole(profile.role) || isChapterServantRole(profile.role);
}

async function validateAssignmentScope(supabase, profile, chapterId, areaId) {
  if (!canAssign(profile)) {
    const error = new Error('You do not have permission to assign chapter members.');
    error.statusCode = 403;
    throw error;
  }
  if (!chapterId) {
    const error = new Error('Chapter is required.');
    error.statusCode = 400;
    throw error;
  }
  if (isChapterServantRole(profile.role) && String(profile.chapter_id || '') !== String(chapterId)) {
    const error = new Error('You can only assign members to your own chapter.');
    error.statusCode = 403;
    throw error;
  }
  await ensureChapterInArea(supabase, chapterId, areaId);
}

async function listUnassigned(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const chapterId = req.query?.chapterId;
  await validateAssignmentScope(supabase, profile, chapterId, areaId);

  const { data, error } = await supabase
    .from('members')
    .select('id, first_name, middle_name, last_name, email, contact_number, status')
    .eq('area_id', areaId)
    .is('chapter_id', null)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(500);
  if (error) throw error;

  return sendJson(res, 200, { ok: true, members: data || [] });
}

async function assignMembers(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const chapterId = req.body?.chapterId;
  const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(String).filter(Boolean))].slice(0, 250);
  await validateAssignmentScope(supabase, profile, chapterId, areaId);
  if (!memberIds.length) return sendJson(res, 400, { ok: false, error: 'Select at least one member.' });

  const { data: available, error: loadError } = await supabase
    .from('members')
    .select('id')
    .eq('area_id', areaId)
    .is('chapter_id', null)
    .in('id', memberIds);
  if (loadError) throw loadError;
  const availableIds = (available || []).map(item => item.id);
  if (!availableIds.length) return sendJson(res, 409, { ok: false, error: 'The selected members are no longer unassigned.' });

  const { data: updated, error: updateError } = await supabase
    .from('members')
    .update({ chapter_id: chapterId })
    .eq('area_id', areaId)
    .in('id', availableIds)
    .select('id, chapter_id');
  if (updateError) throw updateError;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ chapter_id: chapterId })
    .in('member_id', availableIds);
  if (profileError) throw profileError;

  return sendJson(res, 200, { ok: true, assignedCount: updated?.length || 0, memberIds: availableIds, chapterId });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listUnassigned(req, res);
    if (req.method === 'POST') return await assignMembers(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return apiError(res, error);
  }
}
