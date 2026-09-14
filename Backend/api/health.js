import { backendConfig, validateDatabaseUrl } from './_lib/env.js';
import { pingDatabase, queryOne } from './_lib/db.js';
import { sendJson, methodNotAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const config = backendConfig();
  const urlCheck = validateDatabaseUrl(config.databaseUrl);
  const configured = urlCheck.valid;
  let databaseConnected = false;
  let schemaReady = false;
  let databaseError = null;

  if (configured) {
    try {
      databaseConnected = await pingDatabase();
      if (databaseConnected) {
        const schema = await queryOne(
          `SELECT
             to_regclass('public.accounts') IS NOT NULL AS accounts,
             to_regclass('public.sessions') IS NOT NULL AS sessions,
             to_regclass('public.rate_limits') IS NOT NULL AS rate_limits,
             to_regclass('public.members') IS NOT NULL AS members,
             to_regclass('public.profiles') IS NOT NULL AS profiles`
        );
        schemaReady = Boolean(schema?.accounts && schema?.sessions && schema?.rate_limits && schema?.members && schema?.profiles);
      }
    } catch (error) {
      databaseError = error?.message || 'Unable to connect to Neon PostgreSQL.';
    }
  } else {
    databaseError = urlCheck.reason === 'missing' ? 'DATABASE_URL is missing.' : 'DATABASE_URL is invalid.';
  }

  const healthy = databaseConnected && schemaReady;
  return sendJson(res, healthy ? 200 : 503, {
    ok: healthy,
    service: 'mfc-youth-web-api',
    backendPhase: '0.7-neon-auth-migration',
    configured,
    adminRegistrationConfigured: Boolean(config.adminRegistrationCode),
    databaseUrlConfigured: Boolean(config.databaseUrl),
    databaseUrlValid: urlCheck.valid,
    ...(urlCheck.host ? { databaseHost: urlCheck.host } : {}),
    database: databaseConnected ? 'neon-postgresql' : 'unavailable',
    databaseConnected,
    schemaReady,
    ...(databaseError ? { databaseError } : {}),
    timestamp: new Date().toISOString()
  });
}
