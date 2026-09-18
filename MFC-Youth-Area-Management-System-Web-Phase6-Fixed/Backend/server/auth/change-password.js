import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';

function passwordError(password) {
  if (String(password).length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword) {
      return sendJson(res, 400, { ok: false, error: 'Current password is required.' });
    }
    if (currentPassword === newPassword) {
      return sendJson(res, 400, { ok: false, error: 'Choose a new password that is different from your current password.' });
    }

    const validationError = passwordError(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    const { user, supabase, token } = await requireAuthenticatedProfile(req);
    const authoritativeEmail = String(user?.email || '').trim().toLowerCase();
    if (!authoritativeEmail) {
      return sendJson(res, 409, { ok: false, error: 'Your Auth account does not have an email address.' });
    }

    // Verify the current password with a temporary non-persistent session.
    const tempClient = createSupabaseAuthClient();
    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: authoritativeEmail,
      password: currentPassword
    });

    if (signInError || !signInData?.session) {
      return sendJson(res, 401, { ok: false, error: 'Incorrect current password.', code: 'INVALID_CURRENT_PASSWORD' });
    }

    // IMPORTANT: signInWithPassword created a real session. Revoke only this
    // temporary session; a default/global sign-out could revoke the user's
    // unrelated sessions.
    const { error: tempLogoutError } = await tempClient.auth.signOut({ scope: 'local' });
    if (tempLogoutError) {
      const cleanupError = new Error('Current password was verified, but the temporary verification session could not be revoked.');
      cleanupError.statusCode = 502;
      cleanupError.code = 'TEMP_SESSION_REVOKE_FAILED';
      throw cleanupError;
    }

    // Apply the password update in the context of the ORIGINAL caller JWT.
    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData?.msg || errorData?.message || 'Unable to update your password.');
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      error.code = 'PASSWORD_UPDATE_FAILED';
      throw error;
    }

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (profileUpdateError) {
      profileUpdateError.code = profileUpdateError.code || 'PROFILE_PASSWORD_STATE_SYNC_FAILED';
      throw profileUpdateError;
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Password updated successfully.',
      mustChangePassword: false
    });
  } catch (error) {
    return apiError(res, error);
  }
}
