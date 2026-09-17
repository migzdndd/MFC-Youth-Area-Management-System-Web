import { createHmac } from 'node:crypto';

export const LOGIN_RATE_LIMIT = Object.freeze({
  maxFailures: 8,
  windowSeconds: 15 * 60,
  blockSeconds: 15 * 60
});

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').trim();
}

function requestAddress(req) {
  const raw = firstHeader(req?.headers?.['x-vercel-forwarded-for']) ||
    firstHeader(req?.headers?.['x-forwarded-for']) ||
    firstHeader(req?.headers?.['x-real-ip']) ||
    firstHeader(req?.socket?.remoteAddress) ||
    'unknown-client';
  return raw.split(',')[0].trim().slice(0, 128) || 'unknown-client';
}

function fingerprint(secret, scope, value) {
  return createHmac('sha256', String(secret || ''))
    .update(`${scope}:${String(value || '')}`)
    .digest('hex');
}

export function loginRateKeys(req, email, secret) {
  const keys = [`login:ip:${fingerprint(secret, 'ip', requestAddress(req))}`];
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail) keys.push(`login:email:${fingerprint(secret, 'email', normalizedEmail)}`);
  return keys;
}

function wrapStorageError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message.includes('auth_rate_limits') && !message.includes('auth_rate_limit')) return error;
  const wrapped = new Error('Authentication rate-limit storage is not initialized. Run Backend/supabase/006_admin_registration_rate_limit.sql.');
  wrapped.statusCode = 503;
  wrapped.code = 'RATE_LIMIT_STORAGE_NOT_CONFIGURED';
  return wrapped;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function rpc(admin, name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw wrapStorageError(error);
  return firstRow(data);
}

export async function checkLoginRateLimit(admin, keys) {
  let retryAfterSeconds = 0;
  for (const rateKey of keys) {
    const row = await rpc(admin, 'check_auth_rate_limit', { p_rate_key: rateKey });
    retryAfterSeconds = Math.max(retryAfterSeconds, Number(row?.retry_after_seconds || 0));
  }
  return { blocked: retryAfterSeconds > 0, retryAfterSeconds };
}

export async function recordLoginFailure(admin, keys) {
  let retryAfterSeconds = 0;
  for (const rateKey of keys) {
    const row = await rpc(admin, 'record_auth_rate_limit_failure', {
      p_rate_key: rateKey,
      p_max_attempts: LOGIN_RATE_LIMIT.maxFailures,
      p_window_seconds: LOGIN_RATE_LIMIT.windowSeconds,
      p_block_seconds: LOGIN_RATE_LIMIT.blockSeconds
    });
    retryAfterSeconds = Math.max(retryAfterSeconds, Number(row?.retry_after_seconds || 0));
  }
  return { blocked: retryAfterSeconds > 0, retryAfterSeconds };
}

export async function resetLoginRateLimit(admin, keys) {
  for (const rateKey of keys) {
    await rpc(admin, 'reset_auth_rate_limit', { p_rate_key: rateKey });
  }
}
