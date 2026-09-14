export function backendConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
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

  return config;
}
