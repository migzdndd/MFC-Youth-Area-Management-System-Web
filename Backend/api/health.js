import { backendConfig, validateSupabaseUrl } from './_lib/env.js';
import { createSupabaseAdmin } from './_lib/supabase.js';
import { sendJson, methodNotAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const config = backendConfig();
  const urlCheck = validateSupabaseUrl(config.supabaseUrl);
  const configured = Boolean(
    urlCheck.valid &&
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
      databaseError = error?.cause?.message || error?.message || 'Unable to connect to Supabase.';
    }
  } else if (!urlCheck.valid) {
    databaseError = urlCheck.reason === 'missing'
      ? 'SUPABASE_URL is missing.'
      : 'SUPABASE_URL is invalid. Copy the Project URL directly from Supabase Connect.';
  }

  return sendJson(res, databaseConnected ? 200 : 503, {
    ok: databaseConnected,
    service: 'mfc-youth-web-api',
    backendPhase: '6.2-admin-registration-area-onboarding',
    configured,
    adminRegistrationConfigured: Boolean(config.adminRegistrationCode),
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    supabaseUrlValid: urlCheck.valid,
    ...(urlCheck.host ? { supabaseHost: urlCheck.host } : {}),
    database: databaseConnected ? 'supabase-postgres' : 'unavailable',
    databaseConnected,
    ...(databaseError ? { databaseError } : {}),
    timestamp: new Date().toISOString()
  });
}
