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

  const authClient = createSupabaseAuthClient();
  let recoverySessionEstablished = false;

  try {
    const { token_hash, newPassword } = req.body || {};
    if (!token_hash) {
      return sendJson(res, 400, { ok: false, error: 'Recovery token is missing.' });
    }

    const validationError = validatePassword(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    const { data: verifyData, error: verifyError } = await authClient.auth.verifyOtp({
      token_hash: String(token_hash),
      type: 'recovery'
    });

    if (verifyError || !verifyData?.session) {
      return sendJson(res, 401, { ok: false, error: 'The recovery link is invalid or has expired.' });
    }

    const { error: setSessionError } = await authClient.auth.setSession({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token
    });
    if (setSessionError) throw setSessionError;
    recoverySessionEstablished = true;

    const { error: updateError } = await authClient.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;

    return sendJson(res, 200, {
      ok: true,
      message: 'Password has been successfully reset. Please sign in with your new password.'
    });
  } catch (error) {
    return apiError(res, error);
  } finally {
    if (recoverySessionEstablished) {
      try {
        await authClient.auth.signOut({ scope: 'local' });
      } catch {
        // The recovery client is non-persistent and discarded after this request.
      }
    }
  }
}
