import { requireAuthenticatedProfile, isAreaAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { cleanText, requireArea, loadAreaRow } from '../_lib/cloud-data.js';

async function eventInArea(supabase, eventId, areaId) {
  return loadAreaRow(supabase, 'events', eventId, areaId, 'id');
}

async function memberInArea(supabase, memberId, areaId) {
  return loadAreaRow(supabase, 'members', memberId, areaId, 'id');
}

async function listParticipants(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const { data: events, error: eventError } = await supabase.from('events').select('id').eq('area_id', areaId);
  if (eventError) throw eventError;
  const eventIds = (events || []).map(item => item.id);
  if (!eventIds.length) return sendJson(res, 200, { ok: true, participants: [] });
  let query = supabase
    .from('event_participants')
    .select('id, event_id, member_id, mode_of_payment, payment_status, attended, registered_at, updated_at')
    .in('event_id', eventIds)
    .order('registered_at', { ascending: false });
  if (req.query?.eventId) query = query.eq('event_id', req.query.eventId);
  if (isChapterServantRole(profile.role)) {
    const { data: chapterMembers, error: memberError } = await supabase
      .from('members').select('id').eq('area_id', areaId).eq('chapter_id', profile.chapter_id || '00000000-0000-0000-0000-000000000000');
    if (memberError) throw memberError;
    const ids = (chapterMembers || []).map(item => item.id);
    query = ids.length ? query.in('member_id', ids) : query.eq('member_id', '00000000-0000-0000-0000-000000000000');
  } else if (!isAreaAdminRole(profile.role)) {
    query = query.eq('member_id', profile.member_id || '00000000-0000-0000-0000-000000000000');
  }
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, { ok: true, participants: data || [] });
}

async function createParticipant(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can register event participants.' });
  const areaId = requireArea(req, profile);
  const eventId = req.body?.eventId;
  const memberId = req.body?.memberId;
  if (!eventId || !memberId) return sendJson(res, 400, { ok: false, error: 'Event and member are required.' });
  if (!(await eventInArea(supabase, eventId, areaId)) || !(await memberInArea(supabase, memberId, areaId))) {
    return sendJson(res, 400, { ok: false, error: 'Event or member does not belong to your Area.' });
  }
  const { data: duplicate, error: duplicateError } = await supabase
    .from('event_participants').select('id').eq('event_id', eventId).eq('member_id', memberId).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'That member is already registered for this event.' });
  const { data, error } = await supabase.from('event_participants').insert({
    event_id: eventId,
    member_id: memberId,
    mode_of_payment: cleanText(req.body?.paymentMode, 80) || null,
    payment_status: cleanText(req.body?.paymentStatus, 80) || 'Unpaid',
    attended: Boolean(req.body?.attended),
    registered_by: user.id
  }).select('*').single();
  if (error) throw error;
  return sendJson(res, 201, { ok: true, participant: data });
}

async function updateParticipant(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can edit event participants.' });
  const areaId = requireArea(req, profile);
  const id = req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Participant ID is required.' });
  const { data: existing, error: existingError } = await supabase.from('event_participants').select('id, event_id').eq('id', id).maybeSingle();
  if (existingError) throw existingError;
  if (!existing || !(await eventInArea(supabase, existing.event_id, areaId))) return sendJson(res, 404, { ok: false, error: 'Participant record not found in your Area.' });
  const { data, error } = await supabase.from('event_participants').update({
    mode_of_payment: cleanText(req.body?.paymentMode, 80) || null,
    payment_status: cleanText(req.body?.paymentStatus, 80) || 'Unpaid',
    attended: Boolean(req.body?.attended)
  }).eq('id', id).select('*').single();
  if (error) throw error;
  return sendJson(res, 200, { ok: true, participant: data });
}

async function deleteParticipant(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can delete event participants.' });
  const areaId = requireArea(req, profile);
  const id = req.query?.id || req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Participant ID is required.' });
  const { data: existing, error: existingError } = await supabase.from('event_participants').select('id, event_id').eq('id', id).maybeSingle();
  if (existingError) throw existingError;
  if (!existing || !(await eventInArea(supabase, existing.event_id, areaId))) return sendJson(res, 404, { ok: false, error: 'Participant record not found in your Area.' });
  const { error } = await supabase.from('event_participants').delete().eq('id', id);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listParticipants(req, res);
    if (req.method === 'POST') return await createParticipant(req, res);
    if (req.method === 'PATCH') return await updateParticipant(req, res);
    if (req.method === 'DELETE') return await deleteParticipant(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
