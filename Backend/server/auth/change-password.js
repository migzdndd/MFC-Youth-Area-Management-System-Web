import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError, readBearerToken } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';

function passwordError(password) {
  if (String(password).length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}

async function revokeTemporarySession({ client, session, supabaseUrl, supabaseAnonKey }) {
  const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
  if (!signOutError) return true;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword) {
      return sendJson(res, 400, { ok: false, error: 'Current password is required.' });
    }

    const validationError = passwordError(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });
    if (newPassword === currentPassword) {
      return sendJson(res, 400, { ok: false, error: 'Choose a new password that is different from your current password.' });
    }

    const { user, supabase } = await requireAuthenticatedProfile(req);
    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
    const originalToken = readBearerToken(req);

    // Supabase JS 2.57 does not provide native current-password verification.
    // Verify the password in an isolated, non-persistent session, then revoke it
    // before updating the caller's real authenticated session.
    const tempClient = createSupabaseAuthClient();
    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError || !signInData?.session) {
      return sendJson(res, 401, { ok: false, error: 'Incorrect current password.' });
    }

    const tempRevoked = await revokeTemporarySession({
      client: tempClient,
      session: signInData.session,
      supabaseUrl,
      supabaseAnonKey
    });

    if (!tempRevoked) {
      const error = new Error('Unable to safely complete current-password verification. Please try again.');
      error.statusCode = 503;
      error.code = 'TEMP_SESSION_REVOKE_FAILED';
      throw error;
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${originalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const error = new Error(errJson.message || 'Unable to update the password.');
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 500;
      throw error;
    }

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (profileUpdateError) throw profileUpdateError;

    return sendJson(res, 200, {
      ok: true,
      message: 'Password updated successfully.',
      mustChangePassword: false
    });
  } catch (error) {
    return apiError(res, error);
  }
}
