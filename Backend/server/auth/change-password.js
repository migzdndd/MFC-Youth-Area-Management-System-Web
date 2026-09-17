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

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    
    if (!currentPassword) return sendJson(res, 400, { ok: false, error: 'Current password is required.' });

    const validationError = passwordError(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    const { user, supabase } = await requireAuthenticatedProfile(req);

    // 1. Create a temporary non-persistent Auth client to verify current password
    const tempClient = createSupabaseAuthClient();
    
    // 2. Verify current password
    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError || !signInData?.session) {
      return sendJson(res, 401, { ok: false, error: 'Incorrect current password.' });
    }

    // 3. Current password is correct. Explicitly sign out to destroy the temporary session.
    await tempClient.auth.signOut();

    // 4. Update the password using the original caller JWT (via REST or setSession on a fresh client)
    // Wait, we need to update the password with the user's token, not tempClient's.
    // However, updateUser() needs a session. Since supabase was created as Admin in requireAuthenticatedProfile, we should use REST API to updateUser as the user, OR setSession on a non-persistent client with the user's token.
    // wait, we can just use tempClient and setSession to the original caller's JWT, but we only have `token` from `req`.
    const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
    const token = readBearerToken(req);

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.message || `Password update failed with status ${response.status}`);
    }

    // 5. Update profiles.must_change_password
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
