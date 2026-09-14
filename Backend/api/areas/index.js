import { query, queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const LEADERSHIP_ROLES = new Set(['couple_coordinator','area_servant','lit_servant','chapter_servant']);
const DEFAULT_SERVICES = [
  'Unit Servant','Household Servant','Chapter Servant','Area Servant',
  'LIT Servant','Campus Servant','MFC High Servant'
];

function cleanAreaName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function areaCodeFromName(name) {
  const base = String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44);
  return base || `AREA-${Date.now().toString(36).toUpperCase()}`;
}

async function listAreas(req, res) {
  const { profile } = await requireAuthenticatedProfile(req);
  if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
    return sendJson(res, 403, { ok: false, error: 'Area setup is available only to Servant Leader accounts.' });
  }
  const rows = await query(
    'SELECT id, name, code, is_active FROM areas WHERE is_active = TRUE ORDER BY name ASC LIMIT 500'
  );
  return sendJson(res, 200, { ok: true, areas: rows || [] });
}

async function createArea(req, res) {
  assertReasonableBody(req, 16 * 1024);
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'area-create', 10, 3600);
  const { profile, account } = await requireAuthenticatedProfile(req);
  if (!LEADERSHIP_ROLES.has(String(profile.role || '').toLowerCase())) {
    return sendJson(res, 403, { ok: false, error: 'You do not have permission to create an Area.' });
  }
  if (profile.area_id) return sendJson(res, 409, { ok: false, error: 'Your account is already assigned to an Area.' });

  const name = cleanAreaName(req.body?.name);
  if (name.length < 3) return sendJson(res, 400, { ok: false, error: 'Enter a valid Area name.' });

  const existing = await queryOne(
    'SELECT id, name, code FROM areas WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [name]
  );
  if (existing) {
    return sendJson(res, 409, {
      ok: false,
      error: 'That Area already exists. Select it from the Area list instead.',
      existingArea: existing
    });
  }

  let code = areaCodeFromName(name);
  const codeConflict = await queryOne('SELECT id FROM areas WHERE code = $1 LIMIT 1', [code]);
  if (codeConflict) code = `${code.slice(0, 38)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  let area = null;
  try {
    area = await queryOne(
      'INSERT INTO areas (name, code, is_active) VALUES ($1,$2,TRUE) RETURNING id,name,code,is_active',
      [name, code]
    );
    for (const serviceName of DEFAULT_SERVICES) {
      await query(
        `INSERT INTO services (area_id, name, is_active)
         VALUES ($1,$2,TRUE)
         ON CONFLICT (area_id, name) DO NOTHING`,
        [area.id, serviceName]
      );
    }

    const memberLink = await ensureLeadershipMemberRecord({ account, profile, areaId: area.id });
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
    if (area?.id) await query('DELETE FROM areas WHERE id = $1', [area.id]).catch(() => {});
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listAreas(req, res);
    if (req.method === 'POST') return await createArea(req, res);
    return methodNotAllowed(res, ['GET','POST']);
  } catch (error) {
    return apiError(res, error);
  }
}
