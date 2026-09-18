import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, isValidEmail, normalizeEmail } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { token, user } = await requireAuthenticatedProfile(req);

    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!isValidEmail(newEmail)) {
      return sendJson(res, 400, { ok: false, error: 'A valid email is required.' });
    }
    if (normalizeEmail(user?.email) === newEmail) {
      return sendJson(res, 200, { ok: true, unchanged: true, message: 'That email address is already linked to your account.' });
    }

    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: newEmail })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData?.msg || errorData?.message || 'Unable to start the email change.');
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      error.code = 'EMAIL_CHANGE_FAILED';
      throw error;
    }

    return sendJson(res, 200, {
      ok: true,
      pendingConfirmation: true,
      message: 'Email change requested. Complete the confirmation steps sent by Supabase before the new email becomes active.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
