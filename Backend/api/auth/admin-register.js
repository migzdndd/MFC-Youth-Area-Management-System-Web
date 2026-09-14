import { timingSafeEqual } from 'node:crypto';
import { query, queryOne } from '../_lib/db.js';
import { hashPassword, createSession, passwordPolicyError } from '../_lib/auth-session.js';
import { assertAdminRegistrationConfigured } from '../_lib/env.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError, assertReasonableBody, assertTrustedOrigin } from '../_lib/http.js';

const ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

function cleanText(value, max = 160) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function registrationCodeMatches(input, expected) {
  const supplied = Buffer.from(String(input || ''), 'utf8');
  const target = Buffer.from(String(expected || ''), 'utf8');
  if (!supplied.length || supplied.length !== target.length) return false;
  return timingSafeEqual(supplied, target);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    assertReasonableBody(req, 16 * 1024);
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'admin-register', 8, 900);

    const { adminRegistrationCode } = assertAdminRegistrationConfigured();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const confirmation = String(req.body?.confirmPassword || '');
    const verificationCode = String(req.body?.verificationCode || '');
    const displayName = cleanText(req.body?.displayName, 160);
    const role = String(req.body?.role || '').trim().toLowerCase();

    if (!displayName) return sendJson(res, 400, { ok: false, error: 'Enter your full name.' });
    if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email address.' });
    if (!ADMIN_ROLES.has(role)) return sendJson(res, 400, { ok: false, error: 'Select a valid Servant Leader access level.' });
    if (!registrationCodeMatches(verificationCode, adminRegistrationCode)) {
      return sendJson(res, 403, { ok: false, error: 'Administrator registration verification failed.' });
    }

    const pError = passwordPolicyError(password);
    if (pError) return sendJson(res, 400, { ok: false, error: pError });
    if (password !== confirmation) return sendJson(res, 400, { ok: false, error: 'Passwords do not match.' });

    const duplicate = await queryOne(
      'SELECT id FROM accounts WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    if (duplicate) return sendJson(res, 409, { ok: false, error: 'An account with this email already exists.' });

    const passwordHash = await hashPassword(password);
    let account = null;
    let profile = null;
    try {
      account = await queryOne(
        `INSERT INTO accounts (email, display_name, password_hash, is_active)
         VALUES ($1,$2,$3,TRUE)
         RETURNING id, email, display_name`,
        [email, displayName, passwordHash]
      );

      profile = await queryOne(
        `INSERT INTO profiles
          (account_id, auth_user_id, member_id, role, area_id, chapter_id, must_change_password, is_active)
         VALUES ($1,$2,NULL,$3,NULL,NULL,FALSE,TRUE)
         RETURNING *`,
        [account.id, String(account.id), role]
      );

      const session = await createSession({ accountId: account.id, req, res, remember: true });

      return sendJson(res, 201, {
        ok: true,
        requiresAreaSelection: true,
        session: session.response,
        user: {
          id: account.id,
          email,
          name: displayName,
          memberId: null,
          role,
          areaId: null,
          chapterId: null,
          mustChangePassword: false
        }
      });
    } catch (error) {
      if (profile?.id) await query('DELETE FROM profiles WHERE id = $1', [profile.id]).catch(() => {});
      if (account?.id) await query('DELETE FROM accounts WHERE id = $1', [account.id]).catch(() => {});
      if (error?.code === '23505') return sendJson(res, 409, { ok: false, error: 'An account with this email already exists.' });
      throw error;
    }
  } catch (error) {
    return apiError(res, error);
  }
}
