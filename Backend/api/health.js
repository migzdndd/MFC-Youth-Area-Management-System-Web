import { backendConfig } from './_lib/env.js';
import { createSupabaseAdmin } from './_lib/supabase.js';
import { sendJson, methodNotAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const config = backendConfig();
  const configured = Boolean(
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.supabaseServiceRoleKey
  );

  let databaseConnected = false;
  let databaseError = null;

  if (configured) {
    try {
      const admin = createSupabaseAdmin();
      const { error } = await admin
        .from('areas')
        .select('id')
        .limit(1);

      if (error) {
        databaseError = error.message || 'Supabase database check failed.';
      } else {
        databaseConnected = true;
      }
    } catch (error) {
      databaseError = error?.message || 'Unable to connect to Supabase.';
    }
  }

  return sendJson(res, databaseConnected ? 200 : 503, {
    ok: databaseConnected,
    service: 'mfc-youth-web-api',
    backendPhase: '6.2-admin-registration-area-onboarding',
    configured,
    adminRegistrationConfigured: Boolean(config.adminRegistrationCode),
    database: databaseConnected ? 'supabase-postgres' : 'unavailable',
    databaseConnected,
    ...(databaseError ? { databaseError } : {}),
    timestamp: new Date().toISOString()
  });
}
