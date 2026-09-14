import { query } from '../_lib/db.js';
import { requireAuthenticatedProfile } from '../_lib/access.js';
import { hashPassword, verifyPassword, passwordPolicyError, invalidateOtherSessions } from '../_lib/auth-session.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, apiError, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    assertReasonableBody(req, 16 * 1024);
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'change-password', 10, 3600);
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const validationError = passwordPolicyError(newPassword);
    if (!currentPassword) return sendJson(res, 400, { ok: false, error: 'Enter your current password.' });
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });
    if (currentPassword === newPassword) {
      return sendJson(res, 400, { ok: false, error: 'Choose a new password that is different from your current password.' });
    }

    const { account, profile, tokenHash } = await requireAuthenticatedProfile(req);
    const validCurrent = await verifyPassword(currentPassword, account.password_hash);
    if (!validCurrent) return sendJson(res, 401, { ok: false, error: 'Your current password is incorrect.' });

    const passwordHash = await hashPassword(newPassword);
    await query(
      `UPDATE accounts
          SET password_hash = $2, password_changed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [account.id, passwordHash]
    );
    await query(
      'UPDATE profiles SET must_change_password = FALSE, updated_at = NOW() WHERE id = $1',
      [profile.id]
    );
    await invalidateOtherSessions(account.id, tokenHash);

    return sendJson(res, 200, {
      ok: true,
      message: 'Password updated successfully.',
      mustChangePassword: false
    });
  } catch (error) {
    return apiError(res, error);
  }
}
