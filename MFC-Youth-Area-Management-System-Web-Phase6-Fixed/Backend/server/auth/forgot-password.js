import { sendJson, methodNotAllowed, isValidEmail, normalizeEmail } from '../_lib/http.js';
import { createSupabaseAuthClient } from '../_lib/supabase.js';

const GENERIC_MESSAGE = 'If an account exists, a reset link was sent.';
const MIN_RESPONSE_MS = 350;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const startedAt = Date.now();
  const genericResponse = async () => {
    const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
    return sendJson(res, 200, { ok: true, message: GENERIC_MESSAGE });
  };

  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) return await genericResponse();

    const supabase = createSupabaseAuthClient();

    // Do not derive redirect destinations from Origin/Host headers. The custom
    // Supabase recovery template uses the project's configured Site URL and the
    // canonical /reset-password route.
    await supabase.auth.resetPasswordForEmail(email);

    return await genericResponse();
  } catch {
    // Always return the same response to avoid account enumeration.
    return await genericResponse();
  }
}
