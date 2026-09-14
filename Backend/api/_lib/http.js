export function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.json(body);
}

export function methodNotAllowed(res, allowed = []) {
  if (allowed.length) res.setHeader('Allow', allowed.join(', '));
  return sendJson(res, 405, {
    ok: false,
    error: 'Method not allowed.'
  });
}

export function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : '';
}

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function apiError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const body = {
    ok: false,
    error: status >= 500 ? 'Backend request failed.' : (error?.message || 'Request failed.')
  };

  if (error?.code) body.code = error.code;

  if (process.env.NODE_ENV !== 'production' && status >= 500) {
    body.detail = error?.message || String(error);
  }

  return sendJson(res, status, body);
}
