import { query, queryOne } from '../_lib/db.js';
import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { hashPassword } from '../_lib/auth-session.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { sendJson, methodNotAllowed, apiError, isUuid, assertTrustedOrigin } from '../_lib/http.js';
import { generateTemporaryPassword } from '../_lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    assertTrustedOrigin(req);
    await enforceRateLimit(req, 'member-login-reset', 30, 3600);
    const { profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can reset member logins.' });
    }

    const memberId = String(req.body?.memberId || '');
    if (!isUuid(memberId)) return sendJson(res, 400, { ok: false, error: 'A valid Member ID is required.' });

    const member = await queryOne('SELECT * FROM members WHERE id=$1 AND area_id=$2 LIMIT 1', [memberId, profile.area_id]);
    if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

    const linked = await queryOne('SELECT id, account_id FROM profiles WHERE member_id=$1 LIMIT 1', [memberId]);
    const temporaryPassword = generateTemporaryPassword(14);
    const passwordHash = await hashPassword(temporaryPassword);
    const displayName = [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' ');
    let accountId = linked?.account_id || null;

    if (accountId) {
      await query(
        `UPDATE accounts SET password_hash=$2, email=$3, display_name=$4,
                is_active=$5, password_changed_at=NOW(), updated_at=NOW()
          WHERE id=$1`,
        [accountId, passwordHash, member.email, displayName, member.status !== 'Inactive']
      );
      await query(
        'UPDATE profiles SET must_change_password=TRUE, is_active=$2, updated_at=NOW() WHERE id=$1',
        [linked.id, member.status !== 'Inactive']
      );
      await query('DELETE FROM sessions WHERE account_id=$1', [accountId]);
    } else {
      let account = null;
      try {
        account = await queryOne(
          `INSERT INTO accounts (email,display_name,password_hash,is_active)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [member.email, displayName, passwordHash, member.status !== 'Inactive']
        );
        accountId = account.id;
        await query(
          `INSERT INTO profiles
            (account_id,auth_user_id,member_id,role,area_id,chapter_id,must_change_password,is_active)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
          [accountId, String(accountId), member.id, member.access_level || 'member', member.area_id,
           member.chapter_id, member.status !== 'Inactive']
        );
      } catch (error) {
        if (account?.id) await query('DELETE FROM accounts WHERE id=$1', [account.id]).catch(() => {});
        throw error;
      }
    }

    return sendJson(res, 200, {
      ok: true,
      account: {
        email: member.email,
        temporaryPassword,
        mustChangePassword: true,
        role: member.access_level || 'member'
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
