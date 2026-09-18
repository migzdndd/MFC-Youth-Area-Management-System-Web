import { sendJson, methodNotAllowed, isValidEmail, normalizeEmail } from '../_lib/http.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const genericResponse = () => sendJson(res, 200, { ok: true, message: 'If an account exists, a reset link was sent.' });

  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) return genericResponse();

    const supabase = createSupabaseAuthClient();

    // Attempt to infer base URL from origin or host for the RedirectTo param
    let baseUrl = '';
    if (req.headers.origin) {
      baseUrl = req.headers.origin;
    } else if (req.headers.host) {
      const protocol = req.headers['x-forwarded-proto'] || (req.headers.host.includes('localhost') ? 'http' : 'https');
      baseUrl = `${protocol}://${req.headers.host}`;
    }

    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: baseUrl ? `${baseUrl}/reset-password` : undefined
    });
    if (recoveryError) throw recoveryError;

    return genericResponse();
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'PASSWORD_RECOVERY_REQUEST',
      timestamp: new Date().toISOString(),
      status: 'UPSTREAM_FAILURE',
      error_code: 'RECOVERY_REQUEST_FAILED'
    }));
    // Keep the client response identical so account existence is never exposed.
    return genericResponse();
  }
}
