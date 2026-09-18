import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';
import { STANDARD_SERVICES } from '../_lib/service-catalog.js';

const LEADERSHIP_ROLES = new Set([
  'national_coordinator',
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'mfc_high_servant',
  'area_kids_servant',
  'chapter_servant'
]);


function cleanAreaName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function areaCodeFromName(name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44);
  return base || `AREA-${Date.now().toString(36).toUpperCase()}`;
}

async function listAreas(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
    return sendJson(res, 403, { ok: false, error: 'Area setup is available only to Servant Leader accounts.' });
  }

  const { data, error } = await supabase
    .from('areas')
    .select('id, name, code, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;

  return sendJson(res, 200, { ok: true, areas: data || [] });
}

async function createArea(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
    return sendJson(res, 403, { ok: false, error: 'You do not have permission to create an Area.' });
  }
  if (profile.area_id) {
    return sendJson(res, 409, { ok: false, error: 'Your account is already assigned to an Area.' });
  }

  const name = cleanAreaName(req.body?.name);
  if (name.length < 3) {
    return sendJson(res, 400, { ok: false, error: 'Enter a valid Area name.' });
  }

  const { data: existingByName, error: nameError } = await supabase
    .from('areas')
    .select('id, name, code')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (nameError) throw nameError;
  if (existingByName) {
    return sendJson(res, 409, {
      ok: false,
      error: 'That Area already exists. Select it from the Area list instead.',
      existingArea: existingByName
    });
  }

  let code = areaCodeFromName(name);
  const { data: codeConflict, error: codeConflictError } = await supabase
    .from('areas')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (codeConflictError) throw codeConflictError;
  if (codeConflict) {
    code = `${code.slice(0, 38)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  let createdArea = null;
  try {
    const { data: area, error: areaError } = await supabase
      .from('areas')
      .insert({ name, code, is_active: true })
      .select('id, name, code, is_active')
      .single();
    if (areaError) throw areaError;
    createdArea = area;

    const { error: serviceError } = await supabase
      .from('services')
      .insert(STANDARD_SERVICES.map(serviceName => ({ area_id: area.id, name: serviceName, is_active: true })));
    if (serviceError) throw serviceError;

    const memberLink = await ensureLeadershipMemberRecord({
      supabase,
      user,
      profile,
      areaId: area.id
    });

    return sendJson(res, 201, {
      ok: true,
      area,
      profile: memberLink.profile,
      member: memberLink.member,
      memberCreated: memberLink.created,
      memberLinkedExisting: memberLink.linkedExisting,
      created: true
    });
  } catch (error) {
    if (createdArea?.id) {
      await supabase.from('areas').delete().eq('id', createdArea.id).catch(() => {});
    }
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listAreas(req, res);
    if (req.method === 'POST') return await createArea(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return apiError(res, error);
  }
}
