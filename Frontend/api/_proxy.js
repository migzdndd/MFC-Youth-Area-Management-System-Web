function backendBaseUrl() {
  const raw = String(process.env.BACKEND_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function copyRequestHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (['host', 'content-length', 'connection'].includes(lower)) continue;
    if (Array.isArray(value)) headers[key] = value.join(', ');
    else if (value != null) headers[key] = String(value);
  }
  headers['x-mfc-proxy'] = 'vercel-frontend';
  return headers;
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
}

export async function proxyToBackend(req, res, path) {
  applySecurityHeaders(res);
  const base = backendBaseUrl();
  if (!base) {
    return res.status(503).json({
      ok: false,
      error: 'Backend is not configured. Set BACKEND_URL in the Frontend Vercel project.'
    });
  }

  let search = '';
  try { search = new URL(req.url || '', 'http://frontend.local').search || ''; } catch { search = ''; }
  const url = `${base}${path}${path.includes('?') ? '' : search}`;
  const method = String(req.method || 'GET').toUpperCase();
  const options = {
    method,
    headers: copyRequestHeaders(req),
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  };

  if (!['GET', 'HEAD'].includes(method) && req.body !== undefined) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      options.body = req.body;
    } else {
      options.body = JSON.stringify(req.body);
      if (!options.headers['content-type'] && !options.headers['Content-Type']) {
        options.headers['content-type'] = 'application/json';
      }
    }
  }

  try {
    const upstream = await fetch(url, options);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    // Preserve the backend's HttpOnly session cookie on the Frontend origin.
    const setCookies = typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : [];
    if (setCookies.length) {
      res.setHeader('Set-Cookie', setCookies);
    } else {
      const singleCookie = upstream.headers.get('set-cookie');
      if (singleCookie) res.setHeader('Set-Cookie', singleCookie);
    }

    const body = await upstream.text();
    return res.status(upstream.status).send(body);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? 'The backend took too long to respond.' : 'Unable to reach the backend service.',
      ...(process.env.NODE_ENV !== 'production' ? { detail: error?.message || String(error) } : {})
    });
  }
}
