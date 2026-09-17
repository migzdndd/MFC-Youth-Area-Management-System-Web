import { sendJson, methodNotAllowed, apiError, readBearerToken } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const token = readBearerToken(req);
    if (!token) {
      return sendJson(res, 401, { ok: false, error: 'Authentication required.' });
    }

    const scope = String(req.body?.scope || 'local').toLowerCase();
    if (scope !== 'local' && scope !== 'global') {
      return sendJson(res, 400, { ok: false, error: 'Invalid scope. Must be local or global.' });
    }

    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();

    const response = await fetch(`${supabaseUrl}/auth/v1/logout?scope=${scope}`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Logout failed: ${response.status} ${errorText}`);
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Successfully logged out.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
