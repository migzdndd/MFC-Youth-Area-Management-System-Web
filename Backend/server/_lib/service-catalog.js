export const STANDARD_SERVICES = Object.freeze([
  'Unit Servant',
  'Household Servant',
  'Chapter Servant',
  'Area Servant',
  'Area LIT Servant',
  'Campus Servant',
  'Area Kids Servant',
  'MFC High Servant'
]);

const SERVICE_ALIASES = new Map([
  ['unit servant', 'Unit Servant'],
  ['household servant', 'Household Servant'],
  ['chapter servant', 'Chapter Servant'],
  ['area servant', 'Area Servant'],
  ['lit servant', 'Area LIT Servant'],
  ['area lit servant', 'Area LIT Servant'],
  ['lit_servant', 'Area LIT Servant'],
  ['campus servant', 'Campus Servant'],
  ['campus_servant', 'Campus Servant'],
  ['kids servant', 'Area Kids Servant'],
  ['area kids servant', 'Area Kids Servant'],
  ['area_kids_servant', 'Area Kids Servant'],
  ['mfc high servant', 'MFC High Servant'],
  ['mfc_high_servant', 'MFC High Servant']
]);

const ROLE_SERVICE_MAP = Object.freeze({
  area_servant: 'Area Servant',
  lit_servant: 'Area LIT Servant',
  campus_servant: 'Campus Servant',
  mfc_high_servant: 'MFC High Servant',
  area_kids_servant: 'Area Kids Servant',
  chapter_servant: 'Chapter Servant'
});

export function normalizeServiceName(value) {
  const service = String(value || '').trim().replace(/\s+/g, ' ');
  if (!service) return '';
  return SERVICE_ALIASES.get(service.toLowerCase()) || service;
}

export function serviceForAccessRole(role) {
  return ROLE_SERVICE_MAP[String(role || '').trim().toLowerCase()] || '';
}

/**
 * Keeps every Area on the canonical built-in service catalog. This is a
 * runtime safety net for Areas created before newer service roles were added.
 * SQL migrations remain the preferred permanent database upgrade path.
 */
export async function ensureStandardServices(supabase, areaId) {
  const targetAreaId = String(areaId || '').trim();
  if (!targetAreaId) return [];

  const { data: existing, error: existingError } = await supabase
    .from('services')
    .select('id, area_id, name, is_active')
    .eq('area_id', targetAreaId);
  if (existingError) throw existingError;

  const normalizedExisting = new Set(
    (existing || []).map(item => normalizeServiceName(item.name)).filter(Boolean)
  );
  const missing = STANDARD_SERVICES.filter(name => !normalizedExisting.has(name));

  if (missing.length) {
    const { error: insertError } = await supabase
      .from('services')
      .upsert(
        missing.map(name => ({ area_id: targetAreaId, name, is_active: true })),
        { onConflict: 'area_id,name', ignoreDuplicates: true }
      );
    if (insertError) throw insertError;
  }

  const inactiveIds = (existing || [])
    .filter(item => item.is_active === false && STANDARD_SERVICES.includes(normalizeServiceName(item.name)))
    .map(item => item.id);

  if (inactiveIds.length) {
    const { error: activeError } = await supabase
      .from('services')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in('id', inactiveIds);
    if (activeError) throw activeError;
  }

  const { data: services, error: finalError } = await supabase
    .from('services')
    .select('id, area_id, name, is_active, created_at, updated_at')
    .eq('area_id', targetAreaId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (finalError) throw finalError;

  return services || [];
}

/**
 * Servant Leader access levels that directly correspond to a service are
 * automatically represented in member_services when the Member has no
 * explicit service yet. Existing manual assignments are preserved.
 */
export async function ensureRoleServiceAssignment(supabase, { memberId, areaId, role }) {
  const targetMemberId = String(memberId || '').trim();
  const targetAreaId = String(areaId || '').trim();
  const serviceName = serviceForAccessRole(role);
  if (!targetMemberId || !targetAreaId || !serviceName) return false;

  const { data: existingLinks, error: linkError } = await supabase
    .from('member_services')
    .select('service_id')
    .eq('member_id', targetMemberId)
    .limit(1);
  if (linkError) throw linkError;
  if ((existingLinks || []).length) return false;

  const services = await ensureStandardServices(supabase, targetAreaId);
  const targetService = services.find(item => normalizeServiceName(item.name) === serviceName);
  if (!targetService?.id) return false;

  const { error: insertError } = await supabase
    .from('member_services')
    .insert({ member_id: targetMemberId, service_id: targetService.id });
  if (insertError) throw insertError;
  return true;
}
