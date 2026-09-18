import { requireAuthenticatedProfile, isAreaAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { cleanText, requireArea, validateIsoDate, asNonNegativeNumber, loadAreaRow } from '../_lib/cloud-data.js';

async function canManageMember(supabase, profile, memberId, areaId) {
  const member = await loadAreaRow(supabase, 'members', memberId, areaId, 'id, chapter_id');
  if (!member) return null;
  if (isAreaAdminRole(profile.role)) return member;
  if (isChapterServantRole(profile.role) && profile.chapter_id && String(member.chapter_id || '') === String(profile.chapter_id)) return member;
  return null;
}

async function listGig(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  let query = supabase
    .from('gig_contributions')
    .select('id, area_id, chapter_id, member_id, amount, contribution_date, notes, created_at')
    .eq('area_id', areaId)
    .order('contribution_date', { ascending: false });
  if (isChapterServantRole(profile.role)) {
    if (!profile.chapter_id) return sendJson(res, 200, { ok: true, gig: [] });
    query = query.eq('chapter_id', profile.chapter_id);
  } else if (!isAreaAdminRole(profile.role)) {
    if (!profile.member_id) return sendJson(res, 200, { ok: true, gig: [] });
    query = query.eq('member_id', profile.member_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, { ok: true, gig: data || [] });
}

async function createGig(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const memberId = req.body?.memberId;
  const member = await canManageMember(supabase, profile, memberId, areaId);
  if (!member) return sendJson(res, 403, { ok: false, error: 'You can only manage GIG records for members you are allowed to manage.' });
  const amount = asNonNegativeNumber(req.body?.amount, -1);
  if (!(amount > 0)) return sendJson(res, 400, { ok: false, error: 'Contribution amount must be greater than zero.' });
  const date = validateIsoDate(req.body?.date, { required: true });
  const { data, error } = await supabase.from('gig_contributions').insert({
    area_id: areaId,
    chapter_id: member.chapter_id || null,
    member_id: memberId,
    amount,
    contribution_date: date,
    notes: cleanText(req.body?.note, 500) || null,
    recorded_by: user.id
  }).select('*').single();
  if (error) throw error;
  return sendJson(res, 201, { ok: true, contribution: data });
}

async function deleteGig(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const id = req.query?.id || req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Contribution ID is required.' });
  const existing = await loadAreaRow(supabase, 'gig_contributions', id, areaId, 'id, member_id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Contribution not found in your Area.' });
  if (!(await canManageMember(supabase, profile, existing.member_id, areaId))) return sendJson(res, 403, { ok: false, error: 'You do not have permission to delete this contribution.' });
  const { error } = await supabase.from('gig_contributions').delete().eq('id', id).eq('area_id', areaId);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listGig(req, res);
    if (req.method === 'POST') return await createGig(req, res);
    if (req.method === 'DELETE') return await deleteGig(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
