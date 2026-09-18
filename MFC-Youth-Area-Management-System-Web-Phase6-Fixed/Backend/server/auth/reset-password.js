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

  const tokenHash = String(req.body?.token_hash || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  if (!tokenHash) return sendJson(res, 400, { ok: false, error: 'Recovery token is missing.' });

  const validationError = validatePassword(newPassword);
  if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

  const authClient = createSupabaseAuthClient();
  let recoverySessionEstablished = false;

  try {
    const { data: verifyData, error: verifyError } = await authClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery'
    });

    if (verifyError || !verifyData?.session || !verifyData?.user) {
      return sendJson(res, 401, { ok: false, error: 'The recovery link is invalid or has expired.' });
    }

    const { error: sessionError } = await authClient.auth.setSession({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token
    });
    if (sessionError) throw sessionError;
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
        // Never replace the primary reset result with cleanup diagnostics and
        // never log the recovery tokens.
      }
    }
  }
}
