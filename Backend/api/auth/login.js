import { query, queryOne } from '../_lib/db.js';
import { createSession, verifyPassword } from '../_lib/auth-session.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$00112233445566778899aabbccddeeff$46064ad829879d99f2606f344d907677fb2f52a2c92c1f952693efdb9967fa2e2e8f0d47483b39fee21680f043d21509913157a3a8f68956e5d496a41a60229b';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    assertReasonableBody(req, 16 * 1024);
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'auth-login', 120, 900);

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const remember = req.body?.remember === true;

    if (!isValidEmail(email) || !password) {
      return sendJson(res, 400, { ok: false, error: 'A valid email and password are required.' });
    }

    const account = await queryOne(
      `SELECT id, email, display_name, password_hash, is_active,
              failed_login_attempts, locked_until
         FROM accounts
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );

    // Keep the same outward error for unknown users and incorrect passwords.
    if (!account) {
      // Perform the same expensive password verification work for unknown
      // addresses to reduce account-enumeration timing differences.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return sendJson(res, 401, { ok: false, error: 'Invalid email or password.' });
    }

    if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
      return sendJson(res, 429, {
        ok: false,
        error: 'Too many failed sign-in attempts. Try again later.'
      });
    }

    const validPassword = await verifyPassword(password, account.password_hash);
    if (!validPassword) {
      const nextAttempts = Number(account.failed_login_attempts || 0) + 1;
      if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
        await query(
          `UPDATE accounts
              SET failed_login_attempts = 0,
                  locked_until = NOW() + ($2::int * INTERVAL '1 minute'),
                  updated_at = NOW()
            WHERE id = $1`,
          [account.id, LOCK_MINUTES]
        );
      } else {
        await query(
          'UPDATE accounts SET failed_login_attempts = $2, updated_at = NOW() WHERE id = $1',
          [account.id, nextAttempts]
        );
      }
      return sendJson(res, 401, { ok: false, error: 'Invalid email or password.' });
    }

    const profile = await queryOne(
      `SELECT id, member_id, role, area_id, chapter_id, must_change_password, is_active
         FROM profiles WHERE account_id = $1 LIMIT 1`,
      [account.id]
    );

    if (!profile || profile.is_active === false || account.is_active === false) {
      return sendJson(res, 403, { ok: false, error: 'This account is not active.' });
    }

    await query(
      `UPDATE accounts
          SET failed_login_attempts = 0, locked_until = NULL,
              last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [account.id]
    );

    const session = await createSession({ accountId: account.id, req, res, remember });

    return sendJson(res, 200, {
      ok: true,
      session: session.response,
      user: {
        id: account.id,
        email: account.email,
        name: account.display_name || account.email,
        memberId: profile.member_id,
        role: profile.role,
        areaId: profile.area_id,
        chapterId: profile.chapter_id,
        mustChangePassword: profile.must_change_password
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
