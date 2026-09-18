import { requireAuthenticatedProfile, isAreaAdminRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { cleanText, nullableText, requireArea, requireAreaAdmin, asNonNegativeNumber, asNonNegativeInteger, loadAreaRow } from '../_lib/cloud-data.js';

function eventPayload(input, areaId, userId) {
  const rawDate = String(input.date || '').trim();
  const name = cleanText(input.name, 160);
  const localDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const date = localDatePattern.test(rawDate)
    ? new Date(`${rawDate}:00+08:00`)
    : new Date(rawDate);
  if (!rawDate || Number.isNaN(date.getTime())) {
    const error = new Error('A valid event date and time is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!name) {
    const error = new Error('Event name is required.');
    error.statusCode = 400;
    throw error;
  }
  return {
    area_id: areaId,
    name,
    description: nullableText(input.description, 3000),
    venue: nullableText(input.venue, 255),
    starts_at: date.toISOString(),
    ends_at: null,
    fee: asNonNegativeNumber(input.fee, 0),
    manual_attendance: asNonNegativeInteger(input.peopleAttended, 0),
    ...(userId ? { created_by: userId } : {})
  };
}

async function listEvents(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const { data, error } = await supabase
    .from('events')
    .select('id, area_id, name, description, venue, starts_at, ends_at, fee, manual_attendance, created_at, updated_at')
    .eq('area_id', areaId)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return sendJson(res, 200, { ok: true, events: data || [] });
}

async function createEvent(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile, 'Only Area-level servant accounts can add Area events.');
  const areaId = requireArea(req, profile);
  const payload = eventPayload(req.body || {}, areaId, user.id);
  const { data, error } = await supabase.from('events').insert(payload).select('*').single();
  if (error) throw error;
  return sendJson(res, 201, { ok: true, event: data });
}

async function updateEvent(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile, 'Only Area-level servant accounts can edit Area events.');
  const areaId = requireArea(req, profile);
  const id = req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Event ID is required.' });
  const existing = await loadAreaRow(supabase, 'events', id, areaId, 'id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Event not found in your Area.' });
  const payload = eventPayload(req.body || {}, areaId, null);
  delete payload.created_by;
  const { data, error } = await supabase.from('events').update(payload).eq('id', id).eq('area_id', areaId).select('*').single();
  if (error) throw error;
  return sendJson(res, 200, { ok: true, event: data });
}

async function deleteEvent(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile, 'Only Area-level servant accounts can delete Area events.');
  const areaId = requireArea(req, profile);
  const id = req.query?.id || req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Event ID is required.' });
  const existing = await loadAreaRow(supabase, 'events', id, areaId, 'id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Event not found in your Area.' });
  const { error } = await supabase.from('events').delete().eq('id', id).eq('area_id', areaId);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listEvents(req, res);
    if (req.method === 'POST') return await createEvent(req, res);
    if (req.method === 'PATCH') return await updateEvent(req, res);
    if (req.method === 'DELETE') return await deleteEvent(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
