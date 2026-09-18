import { requireAuthenticatedProfile, isAreaAdminRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { requireArea, loadAreaRow } from '../_lib/cloud-data.js';
import { ensureStandardServices, normalizeServiceName } from '../_lib/service-catalog.js';

async function listServices(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  const areaId = requireArea(req, profile);
  const services = await ensureStandardServices(supabase, areaId);
  return sendJson(res, 200, { ok: true, services });
}

async function assignServices(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isAreaAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Area-level servant accounts can assign services.' });
  const areaId = requireArea(req, profile);
  const memberId = req.body?.memberId;
  const serviceNames = [...new Set((Array.isArray(req.body?.serviceNames) ? req.body.serviceNames : []).map(normalizeServiceName).filter(Boolean))];
  if (serviceNames.length > 1) return sendJson(res, 400, { ok: false, error: 'A member can only be assigned to one service.' });
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });
  const member = await loadAreaRow(supabase, 'members', memberId, areaId, 'id');
  if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  const services = await ensureStandardServices(supabase, areaId);
  const byName = new Map((services || []).map(item => [normalizeServiceName(item.name), item.id]));
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
