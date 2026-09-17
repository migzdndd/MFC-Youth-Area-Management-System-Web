import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';

function validatePassword(password) {
  if (String(password).length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  
  try {
    const { token_hash, newPassword } = req.body || {};
    if (!token_hash) return sendJson(res, 400, { ok: false, error: 'Recovery token is missing.' });
    
    const validationError = validatePassword(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    // This creates a non-persistent client (persistSession: false, autoRefreshToken: false)
    const authClient = createSupabaseAuthClient(); 

    const { data: verifyData, error: verifyError } = await authClient.auth.verifyOtp({
      token_hash: String(token_hash),
      type: 'recovery'
    });

    if (verifyError || !verifyData?.session) {
      return sendJson(res, 401, { ok: false, error: 'The recovery link is invalid or has expired.' });
    }

    // Set the returned recovery session explicitly
    await authClient.auth.setSession({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token
    });

    // Update the password using the authenticated user context
    const { error: updateError } = await authClient.auth.updateUser({ password: newPassword });
    
    // Explicitly sign out/revoke the recovery session regardless of update success
    await authClient.auth.signOut();
    
    if (updateError) throw updateError;

    return sendJson(res, 200, {
      ok: true,
      message: 'Password has been successfully reset. Please log in with your new password.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
