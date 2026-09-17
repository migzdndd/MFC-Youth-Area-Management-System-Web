import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { requireArea, loadAreaRow } from '../_lib/cloud-data.js';

async function listServices(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(profile);
  const { data: services, error } = await supabase
    .from('services')
    .select('id, area_id, name, is_active, created_at, updated_at')
    .eq('area_id', areaId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return sendJson(res, 200, { ok: true, services: services || [] });
}

async function assignServices(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can assign services.' });
  const areaId = requireArea(profile);
  const memberId = req.body?.memberId;
  const serviceNames = [...new Set((Array.isArray(req.body?.serviceNames) ? req.body.serviceNames : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (serviceNames.length > 1) return sendJson(res, 400, { ok: false, error: 'A member can only be assigned to one service.' });
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });
  const member = await loadAreaRow(supabase, 'members', memberId, areaId, 'id');
  if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  const { data: services, error: serviceError } = await supabase
    .from('services')
    .select('id, name')
    .eq('area_id', areaId)
    .eq('is_active', true);
  if (serviceError) throw serviceError;
  const byName = new Map((services || []).map(item => [item.name, item.id]));
  const unknown = serviceNames.filter(name => !byName.has(name));
  if (unknown.length) return sendJson(res, 400, { ok: false, error: `Unknown service: ${unknown[0]}` });

  const targetIds = serviceNames.map(name => byName.get(name));
  const targetSet = new Set(targetIds.map(String));
  const { data: existingLinks, error: existingError } = await supabase
    .from('member_services')
    .select('service_id')
    .eq('member_id', memberId);
  if (existingError) throw existingError;

  const existingIds = (existingLinks || []).map(item => item.service_id);
  const existingSet = new Set(existingIds.map(String));
  const toAdd = targetIds.filter(id => !existingSet.has(String(id)));
  const toRemove = existingIds.filter(id => !targetSet.has(String(id)));

  if (toAdd.length) {
    const rows = toAdd.map(serviceId => ({ member_id: memberId, service_id: serviceId }));
    const { error: insertError } = await supabase.from('member_services').insert(rows);
    if (insertError) throw insertError;
  }
  if (toRemove.length) {
    const { error: deleteError } = await supabase
      .from('member_services')
      .delete()
      .eq('member_id', memberId)
      .in('service_id', toRemove);
    if (deleteError) throw deleteError;
  }

  return sendJson(res, 200, { ok: true, memberId, services: serviceNames });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listServices(req, res);
    if (req.method === 'PATCH') return await assignServices(req, res);
    return methodNotAllowed(res, ['GET', 'PATCH']);
  } catch (error) {
    return apiError(res, error);
  }
}
