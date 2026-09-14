import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryOne } from './db.js';
import { backendConfig } from './env.js';
import { readBearerToken, readCookie } from './http.js';

const scryptAsync = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'mfc_session';

function base64url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n) || 16384,
      r: Number(r) || 8,
      p: Number(p) || 1,
      maxmem: 64 * 1024 * 1024
    });
    return expected.length === Buffer.from(derived).length && crypto.timingSafeEqual(expected, Buffer.from(derived));
  } catch {
    return false;
  }
}

function cookieForToken(token, expiresAt, remember) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ];
  if (remember) {
    parts.push(`Expires=${expiresAt.toUTCString()}`);
    parts.push(`Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`);
  }
  return parts.join('; ');
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function readSessionToken(req) {
  return readCookie(req, SESSION_COOKIE) || readBearerToken(req);
}

export async function createSession({ accountId, req, res, remember = false }) {
  const { sessionHours, rememberSessionDays } = backendConfig();
  const token = base64url(32);
  const hashed = tokenHash(token);
  const lifetimeMs = remember
    ? rememberSessionDays * 24 * 60 * 60 * 1000
    : sessionHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + lifetimeMs);
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 500) || null;
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ipAddress = forwarded.slice(0, 100) || null;

  await query(
    `INSERT INTO sessions (account_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [accountId, hashed, expiresAt.toISOString(), userAgent, ipAddress]
  );

  // Opportunistic cleanup keeps the free-tier database from accumulating dead sessions.
  query('DELETE FROM sessions WHERE expires_at <= NOW()').catch(() => {});

  // Avoid unlimited active sessions per account.
  await query(
    `DELETE FROM sessions
      WHERE account_id = $1
        AND id NOT IN (
          SELECT id FROM sessions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 8
        )`,
    [accountId]
  ).catch(() => {});

  if (res) res.setHeader('Set-Cookie', cookieForToken(token, expiresAt, remember));

  return {
    token,
    tokenHash: hashed,
    expiresAt,
    response: {
      expiresAt: Math.floor(expiresAt.getTime() / 1000)
    }
  };
}

export async function destroyCurrentSession(req, res) {
  const token = readSessionToken(req);
  if (token) {
    await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]).catch(() => {});
  }
  if (res) clearSessionCookie(res);
}

export async function loadSession(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const hashed = tokenHash(token);

  const row = await queryOne(
    `SELECT
       s.id AS session_id,
       s.token_hash,
       s.expires_at,
       a.id AS account_id,
       a.email,
       a.display_name,
       a.password_hash,
       a.is_active AS account_active,
       p.id AS profile_id,
       p.member_id,
       p.role,
       p.area_id,
       p.chapter_id,
       p.must_change_password,
       p.is_active AS profile_active
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     JOIN profiles p ON p.account_id = a.id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [hashed]
  );

  if (!row) return null;
  if (row.account_active === false || row.profile_active === false) return null;

  // Touching last_seen_at is best-effort and should never break a request.
  query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});

  return {
    tokenHash: hashed,
    sessionId: row.session_id,
    account: {
      id: row.account_id,
      email: row.email,
      display_name: row.display_name,
      password_hash: row.password_hash,
      is_active: row.account_active
    },
    profile: {
      id: row.profile_id,
      account_id: row.account_id,
      member_id: row.member_id,
      role: row.role,
      area_id: row.area_id,
      chapter_id: row.chapter_id,
      must_change_password: row.must_change_password,
      is_active: row.profile_active
    }
  };
}

export async function invalidateOtherSessions(accountId, currentTokenHash) {
  await query(
    'DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2',
    [accountId, currentTokenHash]
  );
}

export function passwordPolicyError(password) {
  const text = String(password || '');
  if (text.length < 10) return 'Password must be at least 10 characters long.';
  if (!/[A-Z]/.test(text)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(text)) return 'Password must include at least one lowercase letter.';
  if (!/\d/.test(text)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(text)) return 'Password must include at least one symbol.';
  return '';
}
