import { query, queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile, isSuperAdminRole, isChapterServantRole } from '../_lib/access.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, apiError, isUuid, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

async function listChapters(req, res) {
  const { profile } = await requireAuthenticatedProfile(req);
  if (!profile.area_id) return sendJson(res, 200, { ok: true, chapters: [] });

  let rows;
  if (isChapterServantRole(profile.role)) {
    rows = profile.chapter_id
      ? await query(
          `SELECT id, area_id, name, is_active, created_at, updated_at
             FROM chapters WHERE id=$1 AND area_id=$2 AND is_active=TRUE LIMIT 1`,
          [profile.chapter_id, profile.area_id]
        )
      : [];
  } else {
    rows = await query(
      `SELECT id, area_id, name, is_active, created_at, updated_at
         FROM chapters WHERE area_id=$1 AND is_active=TRUE ORDER BY name ASC LIMIT 1000`,
      [profile.area_id]
    );
  }
  return sendJson(res, 200, { ok: true, chapters: rows || [] });
}

async function createChapter(req, res) {
  assertReasonableBody(req, 8 * 1024);
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'chapter-create', 50, 3600);
  const { profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can create chapters.' });
  if (!profile.area_id) return sendJson(res, 409, { ok: false, error: 'Your account is not assigned to an Area.' });

  const name = cleanName(req.body?.name);
  if (!name) return sendJson(res, 400, { ok: false, error: 'Chapter name is required.' });
  const duplicate = await queryOne(
    'SELECT id FROM chapters WHERE area_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1',
    [profile.area_id, name]
  );
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'That chapter already exists.' });

  const chapter = await queryOne(
    `INSERT INTO chapters (area_id,name,is_active) VALUES ($1,$2,TRUE)
     RETURNING id,area_id,name,is_active,created_at,updated_at`,
    [profile.area_id, name]
  );
  return sendJson(res, 201, { ok: true, chapter });
}

async function updateChapter(req, res) {
  assertReasonableBody(req, 8 * 1024);
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'chapter-update', 100, 3600);
  const { profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can rename chapters.' });

  const id = String(req.body?.id || '');
  const name = cleanName(req.body?.name);
  if (!isUuid(id)) return sendJson(res, 400, { ok: false, error: 'A valid Chapter ID is required.' });
  if (!name) return sendJson(res, 400, { ok: false, error: 'Chapter name is required.' });

  const duplicate = await queryOne(
    'SELECT id FROM chapters WHERE area_id=$1 AND LOWER(name)=LOWER($2) AND id<>$3 LIMIT 1',
    [profile.area_id, name, id]
  );
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'That chapter already exists.' });

  const chapter = await queryOne(
    `UPDATE chapters SET name=$1, updated_at=NOW()
      WHERE id=$2 AND area_id=$3
      RETURNING id,area_id,name,is_active,created_at,updated_at`,
    [name, id, profile.area_id]
  );
  if (!chapter) return sendJson(res, 404, { ok: false, error: 'Chapter not found in your Area.' });
  return sendJson(res, 200, { ok: true, chapter });
}

async function deleteChapter(req, res) {
  assertTrustedOrigin(req);
  await enforceRateLimit(req, 'chapter-delete', 30, 3600);
  const { profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can delete chapters.' });

  const id = String(req.query?.id || req.body?.id || '');
  if (!isUuid(id)) return sendJson(res, 400, { ok: false, error: 'A valid Chapter ID is required.' });
  const memberCount = await queryOne(
    'SELECT COUNT(*)::int AS count FROM members WHERE area_id=$1 AND chapter_id=$2',
    [profile.area_id, id]
  );
  if (Number(memberCount?.count || 0) > 0) {
    return sendJson(res, 409, { ok: false, error: 'Move or remove members from this chapter before deleting it.' });
  }
  const deleted = await queryOne(
    'DELETE FROM chapters WHERE id=$1 AND area_id=$2 RETURNING id',
    [id, profile.area_id]
  );
  if (!deleted) return sendJson(res, 404, { ok: false, error: 'Chapter not found in your Area.' });
  return sendJson(res, 200, { ok: true, deleted: true, id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listChapters(req, res);
    if (req.method === 'POST') return await createChapter(req, res);
    if (req.method === 'PATCH') return await updateChapter(req, res);
    if (req.method === 'DELETE') return await deleteChapter(req, res);
    return methodNotAllowed(res, ['GET','POST','PATCH','DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
