function cleanEnv(value) {
  return String(value ?? '').trim();
}

function cleanBaseUrl(value) {
  return cleanEnv(value).replace(/\/+$/, '');
}

export function backendConfig() {
  const publishableKey = cleanEnv(
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const secretKey = cleanEnv(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return {
    supabaseUrl: cleanBaseUrl(process.env.SUPABASE_URL),
    supabaseAnonKey: publishableKey,
    supabaseServiceRoleKey: secretKey,
    supabasePublishableKey: publishableKey,
    supabaseSecretKey: secretKey,
    usingLegacyPublishableEnv: !cleanEnv(process.env.SUPABASE_PUBLISHABLE_KEY) && Boolean(cleanEnv(process.env.SUPABASE_ANON_KEY)),
    usingLegacySecretEnv: !cleanEnv(process.env.SUPABASE_SECRET_KEY) && Boolean(cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    adminRegistrationCode: cleanEnv(process.env.ADMIN_REGISTRATION_CODE)
  };
}

export function validateSupabaseUrl(value) {
  const raw = cleanBaseUrl(value);
  if (!raw) return { valid: false, url: '', host: '', reason: 'missing' };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') {
      return { valid: false, url: raw, host: parsed.host || '', reason: 'invalid_protocol' };
    }
    if (!parsed.hostname || !parsed.hostname.endsWith('.supabase.co')) {
      return { valid: false, url: raw, host: parsed.host || '', reason: 'invalid_host' };
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
  if (!config.supabasePublishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (!config.supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY');

  if (missing.length) {
    const error = new Error(`Backend is not configured. Missing: ${missing.join(', ')}`);
    error.statusCode = 503;
    error.code = 'BACKEND_NOT_CONFIGURED';
    throw error;
  }

  const urlCheck = validateSupabaseUrl(config.supabaseUrl);
  if (!urlCheck.valid) {
    const error = new Error('SUPABASE_URL must be the HTTPS Project URL from Supabase.');
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
