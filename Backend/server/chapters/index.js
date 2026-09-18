import {
  requireAuthenticatedProfile,
  isAreaAdminRole,
  isChapterServantRole
} from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { cleanText, requireArea, requireAreaAdmin, loadAreaRow } from '../_lib/cloud-data.js';

async function listChapters(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);

  let query = supabase
    .from('chapters')
    .select('id, area_id, name, is_active, created_at, updated_at')
    .eq('area_id', areaId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (isChapterServantRole(profile.role)) {
    if (!profile.chapter_id) return sendJson(res, 200, { ok: true, chapters: [] });
    query = query.eq('id', profile.chapter_id);
  } else if (!isAreaAdminRole(profile.role)) {
    query = profile.chapter_id
      ? query.eq('id', profile.chapter_id)
      : query.eq('id', '00000000-0000-0000-0000-000000000000');
  }

  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, { ok: true, chapters: data || [] });
}

async function createChapter(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile);
  const areaId = requireArea(req, profile);
  const name = cleanText(req.body?.name, 100);
  if (!name) return sendJson(res, 400, { ok: false, error: 'Chapter name is required.' });

  const { data: duplicate, error: duplicateError } = await supabase
    .from('chapters')
    .select('id')
    .eq('area_id', areaId)
    .ilike('name', name)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'That chapter already exists.' });

  const { data, error } = await supabase
    .from('chapters')
    .insert({ area_id: areaId, name, is_active: true })
    .select('*')
    .single();
  if (error) throw error;
  return sendJson(res, 201, { ok: true, chapter: data });
}

async function updateChapter(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile);
  const areaId = requireArea(req, profile);
  const id = req.body?.id;
  const name = cleanText(req.body?.name, 100);
  if (!id || !name) return sendJson(res, 400, { ok: false, error: 'Chapter ID and name are required.' });

  const existing = await loadAreaRow(supabase, 'chapters', id, areaId, 'id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Chapter not found in your Area.' });

  const { data: duplicate, error: duplicateError } = await supabase
    .from('chapters')
    .select('id')
    .eq('area_id', areaId)
    .ilike('name', name)
    .neq('id', id)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'That chapter already exists.' });

  const { data, error } = await supabase
    .from('chapters')
    .update({ name })
    .eq('id', id)
    .eq('area_id', areaId)
    .select('*')
    .single();
  if (error) throw error;
  return sendJson(res, 200, { ok: true, chapter: data });
}

async function deleteChapter(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  requireAreaAdmin(profile);
  const areaId = requireArea(req, profile);
  const id = req.query?.id || req.body?.id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'Chapter ID is required.' });

  const existing = await loadAreaRow(supabase, 'chapters', id, areaId, 'id');
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Chapter not found in your Area.' });

  const { count, error: countError } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('area_id', areaId)
    .eq('chapter_id', id);
  if (countError) throw countError;
  if ((count || 0) > 0) {
    return sendJson(res, 409, { ok: false, error: 'Move or remove members from this chapter before deleting it.' });
  }

  const { error } = await supabase.from('chapters').delete().eq('id', id).eq('area_id', areaId);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listChapters(req, res);
    if (req.method === 'POST') return await createChapter(req, res);
    if (req.method === 'PATCH') return await updateChapter(req, res);
    if (req.method === 'DELETE') return await deleteChapter(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
