function cleanEnv(value) {
  return String(value ?? '').trim();
}

export function backendConfig() {
  return {
    databaseUrl: cleanEnv(process.env.DATABASE_URL),
    adminRegistrationCode: cleanEnv(process.env.ADMIN_REGISTRATION_CODE),
    frontendOrigin: cleanEnv(process.env.FRONTEND_ORIGIN).replace(/\/+$/, ''),
    sessionHours: Math.max(1, Math.min(Number(process.env.SESSION_HOURS) || 12, 168)),
    rememberSessionDays: Math.max(1, Math.min(Number(process.env.REMEMBER_SESSION_DAYS) || 30, 90))
  };
}

export function validateDatabaseUrl(value) {
  const raw = cleanEnv(value);
  if (!raw) return { valid: false, host: '', reason: 'missing' };
  try {
    const parsed = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      return { valid: false, host: parsed.host || '', reason: 'invalid_protocol' };
    }
    if (!parsed.hostname) return { valid: false, host: '', reason: 'missing_host' };
    return { valid: true, host: parsed.host, reason: '' };
  } catch {
    return { valid: false, host: '', reason: 'invalid_url' };
  }
}

export function assertBackendConfigured() {
  const config = backendConfig();
  const check = validateDatabaseUrl(config.databaseUrl);
  if (!check.valid) {
    const error = new Error(check.reason === 'missing'
      ? 'Backend is not configured. Missing DATABASE_URL.'
      : 'DATABASE_URL is not a valid PostgreSQL connection URL.');
    error.statusCode = 503;
    error.code = 'BACKEND_NOT_CONFIGURED';
    throw error;
  }
  return config;
}

export function assertAdminRegistrationConfigured() {
  const { adminRegistrationCode } = backendConfig();
  if (!adminRegistrationCode) {
    const error = new Error('Administrator registration is not configured. Missing ADMIN_REGISTRATION_CODE.');
    error.statusCode = 503;
    error.code = 'ADMIN_REGISTRATION_NOT_CONFIGURED';
    throw error;
  }
  return { adminRegistrationCode };
}
