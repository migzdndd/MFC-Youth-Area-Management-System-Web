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
  let failureCode = 'BACKEND_NOT_CONFIGURED';

  if (configured) {
    try {
      const admin = createSupabaseAdmin();
      const { error } = await admin
        .from('areas')
        .select('id')
        .limit(1);

      if (error) {
        failureCode = 'DATABASE_UNAVAILABLE';
        console.error('Health database check failed:', error.message || error);
      } else {
        databaseConnected = true;
        const [eventSchema, reportSchema, rateLimitSchema] = await Promise.all([
          admin.from('events').select('id, fee, manual_attendance').limit(1),
          admin.from('activity_reports').select('id, prepared_by_name, chapter_name_snapshot, activity, participant_count, location, event_id').limit(1),
          admin.from('auth_rate_limits').select('rate_key').limit(1)
        ]);

        schemaReady = !eventSchema.error && !reportSchema.error && !rateLimitSchema.error;
        if (!schemaReady) {
          failureCode = 'SCHEMA_NOT_READY';
          console.error(
            'Health schema check failed:',
            eventSchema.error?.message ||
              reportSchema.error?.message ||
              rateLimitSchema.error?.message ||
              'A required cloud migration is incomplete.'
          );
        }
      }
    } catch (error) {
      failureCode = 'DATABASE_UNAVAILABLE';
      console.error('Health check exception:', error?.cause?.message || error?.message || error);
    }
  } else if (!urlCheck.valid) {
    failureCode = 'BACKEND_NOT_CONFIGURED';
  }

  const healthy = databaseConnected && schemaReady;

  return sendJson(res, healthy ? 200 : 503, {
    ok: healthy,
    service: 'mfc-youth-web-api',
    databaseConnected,
    schemaReady,
    ...(healthy ? {} : { code: failureCode }),
    timestamp: new Date().toISOString()
  });
}
