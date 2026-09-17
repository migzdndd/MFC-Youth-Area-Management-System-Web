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
  let schemaReady = false;
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
        const [eventSchema, reportSchema] = await Promise.all([
          admin.from('events').select('id, fee, manual_attendance').limit(1),
          admin.from('activity_reports').select('id, prepared_by_name, chapter_name_snapshot, activity, participant_count, location, event_id').limit(1)
        ]);
        schemaReady = !eventSchema.error && !reportSchema.error;
        if (!schemaReady) {
          databaseError = eventSchema.error?.message || reportSchema.error?.message || 'Cloud module migration is incomplete.';
        }
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
    backendPhase: '6.6-cloud-data-modules',
    configured,
    adminRegistrationConfigured: Boolean(config.adminRegistrationCode),
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    supabaseUrlValid: urlCheck.valid,
    ...(urlCheck.host ? { supabaseHost: urlCheck.host } : {}),
    database: databaseConnected ? 'supabase-postgres' : 'unavailable',
    databaseConnected,
    schemaReady,
    ...(databaseError ? { databaseError } : {}),
    timestamp: new Date().toISOString()
  });
}
