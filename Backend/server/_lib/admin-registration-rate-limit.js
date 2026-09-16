import { createHmac } from 'node:crypto';

export const ADMIN_REGISTRATION_RATE_LIMIT = Object.freeze({
  maxFailures: 5,
  windowSeconds: 15 * 60,
  blockSeconds: 15 * 60
});

function cleanHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').trim();
}

function requestAddress(req) {
  const forwarded = cleanHeader(req?.headers?.['x-forwarded-for']);
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = cleanHeader(req?.headers?.['x-real-ip']);
  if (realIp) return realIp;

  const vercelForwarded = cleanHeader(req?.headers?.['x-vercel-forwarded-for']);
  if (vercelForwarded) {
    const first = vercelForwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return cleanHeader(req?.socket?.remoteAddress) || 'unknown-client';
}

function fingerprint(secret, scope, value) {
  return createHmac('sha256', String(secret || ''))
    .update(`${scope}:${String(value || '')}`)
    .digest('hex');
}

export function adminRegistrationRateKeys(req, email, secret) {
  const keys = [
    `admin-register:ip:${fingerprint(secret, 'ip', requestAddress(req))}`
  ];

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail) {
    keys.push(`admin-register:email:${fingerprint(secret, 'email', normalizedEmail)}`);
  }

  return keys;
}

function rateLimitStorageError(error) {
  const message = String(error?.message || '').toLowerCase();
  const missingRpc = message.includes('function') && (
    message.includes('check_auth_rate_limit') ||
    message.includes('record_auth_rate_limit_failure') ||
    message.includes('reset_auth_rate_limit')
  );
  const missingTable = message.includes('auth_rate_limits') && message.includes('does not exist');

  if (!missingRpc && !missingTable) return error;

  const wrapped = new Error('Administrator registration protection is not initialized. Run Backend/supabase/006_admin_registration_rate_limit.sql.');
  wrapped.statusCode = 503;
  wrapped.code = 'RATE_LIMIT_STORAGE_NOT_CONFIGURED';
  return wrapped;
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function rpc(admin, name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw rateLimitStorageError(error);
  return firstRow(data);
}

export async function checkAdminRegistrationRateLimit(admin, keys) {
  let retryAfterSeconds = 0;

  for (const rateKey of keys) {
    const row = await rpc(admin, 'check_auth_rate_limit', {
      p_rate_key: rateKey
    });

    retryAfterSeconds = Math.max(
      retryAfterSeconds,
      Number(row?.retry_after_seconds || 0)
    );
  }

  return {
    blocked: retryAfterSeconds > 0,
    retryAfterSeconds
  };
}

export async function recordAdminRegistrationFailure(admin, keys) {
  let retryAfterSeconds = 0;
  let attemptCount = 0;

  for (const rateKey of keys) {
    const row = await rpc(admin, 'record_auth_rate_limit_failure', {
      p_rate_key: rateKey,
      p_max_attempts: ADMIN_REGISTRATION_RATE_LIMIT.maxFailures,
      p_window_seconds: ADMIN_REGISTRATION_RATE_LIMIT.windowSeconds,
      p_block_seconds: ADMIN_REGISTRATION_RATE_LIMIT.blockSeconds
    });

    retryAfterSeconds = Math.max(
      retryAfterSeconds,
      Number(row?.retry_after_seconds || 0)
    );
    attemptCount = Math.max(attemptCount, Number(row?.attempt_count || 0));
  }

  return {
    blocked: retryAfterSeconds > 0,
    retryAfterSeconds,
    attemptCount
  };
}

export async function resetAdminRegistrationRateLimit(admin, keys) {
  for (const rateKey of keys) {
    await rpc(admin, 'reset_auth_rate_limit', {
      p_rate_key: rateKey
    });
  }
}
