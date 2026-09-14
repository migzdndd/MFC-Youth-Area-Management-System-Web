import { destroyCurrentSession } from '../_lib/auth-session.js';
import { sendJson, methodNotAllowed, apiError, assertTrustedOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    assertTrustedOrigin(req);
    await destroyCurrentSession(req, res);
    return sendJson(res, 200, { ok: true, loggedOut: true });
  } catch (error) {
    return apiError(res, error);
  }
}
