import { requireAuthenticatedUser } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const scope = String(req.body?.scope || 'local').trim().toLowerCase();
    if (!['local', 'global'].includes(scope)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid logout scope.', code: 'INVALID_LOGOUT_SCOPE' });
    }

    const { token } = await requireAuthenticatedUser(req);
    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();

    const response = await fetch(`${supabaseUrl}/auth/v1/logout?scope=${encodeURIComponent(scope)}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = new Error('The server could not revoke this session.');
      error.statusCode = response.status === 401 ? 401 : 502;
      error.code = 'SESSION_REVOKE_FAILED';
      throw error;
    }

    return sendJson(res, 200, {
      ok: true,
      scope,
      message: scope === 'global'
        ? 'All refresh sessions have been revoked.'
        : 'This refresh session has been revoked.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
