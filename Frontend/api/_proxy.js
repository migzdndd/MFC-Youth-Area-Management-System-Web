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
  return headers;
}

export async function proxyToBackend(req, res, path) {
  const base = backendBaseUrl();
  if (!base) {
    return res.status(503).json({
      ok: false,
      error: 'Backend is not configured. Set BACKEND_URL in the Frontend Vercel project.'
    });
  }

  const url = `${base}${path}`;
  const method = String(req.method || 'GET').toUpperCase();
  const options = {
    method,
    headers: copyRequestHeaders(req),
    redirect: 'manual'
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
    res.setHeader('Cache-Control', 'no-store');

    const body = await upstream.text();
    return res.status(upstream.status).send(body);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'Unable to reach the backend service.',
      ...(process.env.NODE_ENV !== 'production' ? { detail: error?.message || String(error) } : {})
    });
  }
}
