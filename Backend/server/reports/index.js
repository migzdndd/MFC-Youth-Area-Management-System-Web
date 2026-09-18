import { requireAuthenticatedProfile, isAreaAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { cleanText, nullableText, requireArea, validateIsoDate, asNonNegativeInteger, ensureChapterInArea, loadAreaRow } from '../_lib/cloud-data.js';

async function listReports(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  let query = supabase
    .from('activity_reports')
    .select('id, area_id, chapter_id, prepared_by_member_id, prepared_by_name, chapter_name_snapshot, report_type, activity_date, title, activity, participant_count, location, event_id, notes, created_at, updated_at')
    .eq('area_id', areaId)
    .order('activity_date', { ascending: false });
  if (isChapterServantRole(profile.role)) {
    if (!profile.chapter_id) return sendJson(res, 200, { ok: true, reports: [] });
    query = query.eq('chapter_id', profile.chapter_id);
  } else if (!isAreaAdminRole(profile.role)) {
    return sendJson(res, 200, { ok: true, reports: [] });
  }
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, { ok: true, reports: data || [] });
}

async function saveReport(req, res, isUpdate) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role) && !isChapterServantRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'You do not have permission to manage activity reports.' });
  const areaId = requireArea(req, profile);
  const input = req.body || {};
  let chapterId = input.chapterId || null;
  if (isChapterServantRole(profile.role)) chapterId = profile.chapter_id;
  if (chapterId) await ensureChapterInArea(supabase, chapterId, areaId);
  if (input.eventId) {
    const event = await loadAreaRow(supabase, 'events', input.eventId, areaId, 'id');
    if (!event) return sendJson(res, 400, { ok: false, error: 'The linked event does not belong to your Area.' });
  }
  const reportType = cleanText(input.type, 100);
  const date = validateIsoDate(input.date, { required: true });
  if (!reportType) return sendJson(res, 400, { ok: false, error: 'Report type is required.' });
  const payload = {
    area_id: areaId,
    chapter_id: chapterId,
    prepared_by_member_id: isChapterServantRole(profile.role) ? profile.member_id : (input.preparedByMemberId || profile.member_id || null),
    prepared_by_name: nullableText(input.preparedBy, 160),
    chapter_name_snapshot: nullableText(input.chapterName, 160),
    report_type: reportType,
    activity_date: date,
    title: nullableText(input.title, 160),
    activity: nullableText(input.activity, 160),
    participant_count: asNonNegativeInteger(input.participants, 0),
    location: nullableText(input.location, 255),
    event_id: input.eventId || null,
    notes: nullableText(input.description, 4000),
    created_by: user.id
  };
  if (!isUpdate) {
    const { data, error } = await supabase.from('activity_reports').insert(payload).select('*').single();
    if (error) throw error;
    return sendJson(res, 201, { ok: true, report: data });
  }
  const id = input.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Report ID is required.' });
  const existing = await loadAreaRow(supabase, 'activity_reports', id, areaId, 'id, chapter_id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Report not found in your Area.' });
  if (isChapterServantRole(profile.role) && String(existing.chapter_id || '') !== String(profile.chapter_id || '')) return sendJson(res, 403, { ok: false, error: 'You can only edit reports for your assigned chapter.' });
  delete payload.created_by;
  const { data, error } = await supabase.from('activity_reports').update(payload).eq('id', id).eq('area_id', areaId).select('*').single();
  if (error) throw error;
  return sendJson(res, 200, { ok: true, report: data });
}

async function deleteReport(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role) && !isChapterServantRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'You do not have permission to delete activity reports.' });
  const areaId = requireArea(req, profile);
  const id = req.query?.id || req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Report ID is required.' });
  const existing = await loadAreaRow(supabase, 'activity_reports', id, areaId, 'id, chapter_id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Report not found in your Area.' });
  if (isChapterServantRole(profile.role) && String(existing.chapter_id || '') !== String(profile.chapter_id || '')) return sendJson(res, 403, { ok: false, error: 'You can only delete reports for your assigned chapter.' });
  const { error } = await supabase.from('activity_reports').delete().eq('id', id).eq('area_id', areaId);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listReports(req, res);
    if (req.method === 'POST') return await saveReport(req, res, false);
    if (req.method === 'PATCH') return await saveReport(req, res, true);
    if (req.method === 'DELETE') return await deleteReport(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
