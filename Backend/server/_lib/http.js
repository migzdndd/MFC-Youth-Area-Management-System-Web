/**
 * Sends a JSON response with the given status code.
 *
 * @param {import('http').ServerResponse} res - The response object.
 * @param {number} status - HTTP status code.
 * @param {Object} body - The JSON payload to send.
 * @returns {void}
 */
export function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.json(body);
}
/**
 * Sends a 405 Method Not Allowed response.
 *
 * @param {import('http').ServerResponse} res - The response object.
 * @param {string[]} [allowed=[]] - List of allowed HTTP methods.
 * @returns {void}
 */
export function methodNotAllowed(res, allowed = []) {
  if (allowed.length) res.setHeader('Allow', allowed.join(', '));
  return sendJson(res, 405, {
    ok: false,
    error: 'Method not allowed.'
  });
}

/**
 * Extracts a Bearer token from the request Authorization header.
 *
 * @param {import('http').IncomingMessage} req - The request object.
 * @returns {string} The extracted token or an empty string.
 */
export function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : '';
}

/**
 * Normalizes an email address string.
 *
 * @param {string} [value=''] - The email address to normalize.
 * @returns {string} The normalized email address.
 */
export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

/**
 * Validates whether the given string is a basic valid email address.
 *
 * @param {string} [value=''] - The email address to check.
 * @returns {boolean} True if valid, false otherwise.
 */
export function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

/**
 * Converts a raw backend error into a safe message to return to the client.
 *
 * @param {Error|any} error - The caught error object.
 * @returns {string} Safe error message.
 */
function safeBackendMessage(error) {
  const message = String(error?.message || '').trim();
  const lower = message.toLowerCase();

  if (!message) return 'Backend request failed.';
  if (lower.includes('invalid api key') || lower.includes('api key')) {
    return 'Supabase API credentials are invalid. Check the Backend Vercel environment variables.';
  }
  if (lower.includes('failed to fetch') || lower.includes('fetch failed') || lower.includes('enotfound')) {
    return 'The backend could not reach Supabase. Check SUPABASE_URL.';
  }
  if (lower.includes('password')) {
    return message;
  }
  if (lower.includes('email') && (lower.includes('already') || lower.includes('registered'))) {
    return 'An account with this email already exists.';
  }
  if (lower.includes('relation') && lower.includes('does not exist')) {
    return 'The Supabase database schema is incomplete. Run the backend SQL migrations.';
  }
  if (lower.includes('permission denied') || lower.includes('row-level security')) {
    return 'Supabase rejected a database operation. Check the backend secret key and database permissions.';
  }

  return 'Backend request failed.';
}

/**
 * Sends a standardized API error response.
 *
 * @param {import('http').ServerResponse} res - The response object.
 * @param {Error|any} error - The caught error object.
 * @returns {void}
 */
export function apiError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const body = {
    ok: false,
    error: status >= 500 ? safeBackendMessage(error) : (error?.message || 'Request failed.')
  };

  if (error?.code) body.code = error.code;
  if (error?.stage) body.stage = error.stage;

  if (process.env.NODE_ENV !== 'production' && status >= 500) {
    body.detail = error?.message || String(error);
  }

  return sendJson(res, status, body);
}
