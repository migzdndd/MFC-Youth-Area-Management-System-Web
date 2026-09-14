function cleanEnv(value) {
  return String(value ?? '').trim();
}

function cleanBaseUrl(value) {
  return cleanEnv(value).replace(/\/+$/, '');
}

export function backendConfig() {
  return {
    supabaseUrl: cleanBaseUrl(process.env.SUPABASE_URL),
    supabaseAnonKey: cleanEnv(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY),
    adminRegistrationCode: cleanEnv(process.env.ADMIN_REGISTRATION_CODE)
  };
}

export function validateSupabaseUrl(value) {
  const raw = cleanBaseUrl(value);
  if (!raw) return { valid: false, url: '', host: '', reason: 'missing' };

  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { valid: false, url: raw, host: parsed.host || '', reason: 'invalid_protocol' };
    }
    if (!parsed.hostname) {
      return { valid: false, url: raw, host: '', reason: 'missing_host' };
    }
    return { valid: true, url: raw, host: parsed.host, reason: '' };
  } catch {
    return { valid: false, url: raw, host: '', reason: 'invalid_url' };
  }
}

export function assertBackendConfigured() {
  const config = backendConfig();
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length) {
    const error = new Error(`Backend is not configured. Missing: ${missing.join(', ')}`);
    error.statusCode = 503;
    error.code = 'BACKEND_NOT_CONFIGURED';
    throw error;
  }

  const urlCheck = validateSupabaseUrl(config.supabaseUrl);
  if (!urlCheck.valid) {
    const error = new Error('SUPABASE_URL is not a valid HTTP(S) project URL.');
    error.statusCode = 503;
    error.code = 'INVALID_SUPABASE_URL';
    throw error;
  }

  return config;
}

export function assertAdminRegistrationConfigured() {
  const { adminRegistrationCode } = backendConfig();
  if (!adminRegistrationCode) {
    const error = new Error('Administrator registration is not configured. Missing: ADMIN_REGISTRATION_CODE');
    error.statusCode = 503;
    error.code = 'ADMIN_REGISTRATION_NOT_CONFIGURED';
    throw error;
  }
  return { adminRegistrationCode };
}
