import { backendConfig } from './env.js';

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res, status, body) {
  securityHeaders(res);
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(body);
}

export function methodNotAllowed(res, allowed = []) {
  if (allowed.length) res.setHeader('Allow', allowed.join(', '));
  return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
}

export function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : '';
}

export function readCookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

export function optionalIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

export function assertReasonableBody(req, maxBytes = 32768) {
  const rawLength = Number(req.headers?.['content-length'] || 0);
  if (rawLength > maxBytes) {
    const error = new Error('Request body is too large.');
    error.statusCode = 413;
    error.code = 'REQUEST_TOO_LARGE';
    throw error;
  }
}

export function assertTrustedOrigin(req) {
  const { frontendOrigin } = backendConfig();
  if (!frontendOrigin) return;
  const method = String(req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  const origin = String(req.headers?.origin || '').replace(/\/+$/, '');
  if (!origin) return; // server-to-server proxy calls may not provide Origin
  if (origin !== frontendOrigin) {
    const error = new Error('Request origin is not allowed.');
    error.statusCode = 403;
    error.code = 'ORIGIN_NOT_ALLOWED';
    throw error;
  }
}

function safeBackendMessage(error) {
  const message = String(error?.message || '').trim();
  const lower = message.toLowerCase();
  if (!message) return 'Backend request failed.';
  if (error?.code === 'DATABASE_TIMEOUT') return 'The database took too long to respond. Please try again.';
  if (lower.includes('connect') || lower.includes('enotfound') || lower.includes('fetch failed')) {
    return 'The backend could not reach the database.';
  }
  if (lower.includes('relation') && lower.includes('does not exist')) {
    return 'The Neon database schema is incomplete. Run the included database migration.';
  }
  if (lower.includes('duplicate key') || error?.code === '23505') return 'That record already exists.';
  if (lower.includes('foreign key') || error?.code === '23503') return 'This change conflicts with related records.';
  return 'Backend request failed.';
}

export function apiError(res, error) {
  let status = Number(error?.statusCode) || 500;
  if (!error?.statusCode && error?.code === '23505') status = 409;
  if (!error?.statusCode && error?.code === '23503') status = 409;
  if (!error?.statusCode && error?.code === '22P02') status = 400;
  const body = {
    ok: false,
    error: status >= 500 ? safeBackendMessage(error) : (error?.message || 'Request failed.')
  };
  if (error?.code && status < 500) body.code = error.code;
  if (error?.stage) body.stage = error.stage;
  if (process.env.NODE_ENV !== 'production' && status >= 500) {
    body.detail = error?.message || String(error);
  }
  return sendJson(res, status, body);
}
