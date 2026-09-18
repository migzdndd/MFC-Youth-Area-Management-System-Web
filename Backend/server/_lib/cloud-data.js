import {
  isAreaAdminRole,
  isChapterServantRole
} from './access.js';

export function cleanText(value, max = 255) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

export function nullableText(value, max = 255) {
  return cleanText(value, max) || null;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function requireArea(req, profile) {
  if (profile?.role === 'national_coordinator') {
    const override = req.headers['x-mfc-area-id'] || req.headers['X-MFC-Area-ID'];
    if (override) return override;
  }
  if (!profile?.area_id) {
    const error = new Error('Your account is not assigned to an Area.');
    error.statusCode = 409;
    error.code = 'AREA_REQUIRED';
    throw error;
  }
  return profile.area_id;
}

export function requireAreaAdmin(profile, message = 'Only Area-level servant accounts can perform this action.') {
  if (!isAreaAdminRole(profile?.role)) {
    const error = new Error(message);
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

export function requireLeadership(profile) {
  if (!isAreaAdminRole(profile?.role) && !isChapterServantRole(profile?.role)) {
    const error = new Error('You do not have permission to manage this data.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

export function validateIsoDate(value, { required = false } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (required) {
      const error = new Error('A valid date is required.');
      error.statusCode = 400;
      throw error;
    }
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    const error = new Error('A valid date is required.');
    error.statusCode = 400;
    throw error;
  }
  return text;
}

export function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function asNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export async function loadAreaRow(supabase, table, id, areaId, columns = '*') {
  if (!id || !areaId) return null;
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('id', id)
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function ensureChapterInArea(supabase, chapterId, areaId) {
  if (!chapterId) return null;
  const chapter = await loadAreaRow(supabase, 'chapters', chapterId, areaId, 'id, area_id, name');
  if (!chapter) {
    const error = new Error('The selected chapter does not belong to your Area.');
    error.statusCode = 400;
    throw error;
  }
  return chapter;
}

export function scopedChapterId(profile) {
  return isChapterServantRole(profile?.role) ? profile?.chapter_id || null : null;
}
