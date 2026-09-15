function cleanUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validFrontendUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveFrontendUrl(req) {
  const configured = cleanUrl(process.env.FRONTEND_URL);
  if (configured) {
    if (!validFrontendUrl(configured)) {
      const error = new Error('FRONTEND_URL must be an HTTPS URL, or localhost for development.');
      error.statusCode = 503;
      error.code = 'INVALID_FRONTEND_URL';
      throw error;
    }
    return configured;
  }

  const origin = cleanUrl(req?.headers?.origin);
  if (validFrontendUrl(origin)) return origin;

  const fallback = 'https://mfc-youth-area-management-system.vercel.app';
  return fallback;
}

export function passwordSetupRedirectUrl(req) {
  return `${resolveFrontendUrl(req)}/change-password?setup=1`;
}
