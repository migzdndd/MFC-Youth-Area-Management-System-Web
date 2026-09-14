import crypto from 'node:crypto';
import { query, queryOne } from './db.js';

function clientFingerprint(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req?.headers?.['x-real-ip'] || '').trim();
  const ip = forwarded || realIp || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

export async function enforceRateLimit(req, action, limit = 20, windowSeconds = 900) {
  const keyHash = clientFingerprint(req);
  const safeAction = String(action || 'generic').slice(0, 80);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 10000));
  const safeWindow = Math.max(10, Math.min(Number(windowSeconds) || 900, 86400));

  const row = await queryOne(
    `INSERT INTO rate_limits (key_hash, action, window_started_at, attempts)
     VALUES ($1, $2, NOW(), 1)
     ON CONFLICT (key_hash, action)
     DO UPDATE SET
       attempts = CASE
         WHEN rate_limits.window_started_at < NOW() - ($3::int * INTERVAL '1 second') THEN 1
         ELSE rate_limits.attempts + 1
       END,
       window_started_at = CASE
         WHEN rate_limits.window_started_at < NOW() - ($3::int * INTERVAL '1 second') THEN NOW()
         ELSE rate_limits.window_started_at
       END
     RETURNING attempts, window_started_at`,
    [keyHash, safeAction, safeWindow]
  );

  if (Number(row?.attempts || 0) > safeLimit) {
    const error = new Error('Too many requests. Please wait and try again.');
    error.statusCode = 429;
    error.code = 'RATE_LIMITED';
    throw error;
  }

  // Best-effort cleanup of stale buckets.
  if (Math.random() < 0.02) {
    query("DELETE FROM rate_limits WHERE window_started_at < NOW() - INTERVAL '2 days'").catch(() => {});
  }
}
