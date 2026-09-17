import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, isValidEmail, normalizeEmail } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { token } = await requireAuthenticatedProfile(req);

    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!isValidEmail(newEmail)) {
      return sendJson(res, 400, { ok: false, error: 'A valid email is required.' });
    }

    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: newEmail })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.msg || errorData.message || `Auth failed: ${response.status}`;
      return sendJson(res, response.status, { ok: false, error: errorMsg });
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Confirmation emails have been sent to both your old and new email addresses.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
