import { backendConfig } from './_lib/env.js';
import { sendJson, methodNotAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const config = backendConfig();
  const configured = Boolean(
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.supabaseServiceRoleKey
  );

  return sendJson(res, 200, {
    ok: true,
    service: 'mfc-youth-web-api',
    backendPhase: '6.1-foundation',
    configured,
    database: configured ? 'supabase-postgres' : 'awaiting-environment-variables',
    timestamp: new Date().toISOString()
  });
}
