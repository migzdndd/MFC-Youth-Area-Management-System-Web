import health from '../server/health.js';
import areas from '../server/areas/index.js';
import areaSelect from '../server/areas/select.js';
import authAccount from '../server/auth/account.js';
import authAdminRegister from '../server/auth/admin-register.js';
import authChangePassword from '../server/auth/change-password.js';
import authLogin from '../server/auth/login.js';
import authMe from '../server/auth/me.js';
import authRefresh from '../server/auth/refresh.js';
import chapters from '../server/chapters/index.js';
import chapterAssignMembers from '../server/chapters/assign-members.js';
import events from '../server/events/index.js';
import gig from '../server/gig/index.js';
import members from '../server/members/index.js';
import memberLogin from '../server/members/login.js';
import participants from '../server/participants/index.js';
import reports from '../server/reports/index.js';
import services from '../server/services/index.js';
import sync from '../server/sync/index.js';
import { apiError } from '../server/_lib/http.js';
import { isRateLimited } from '../server/_lib/rate-limit.js';

const ROUTES = new Map([
  ['health', health],
  ['areas', areas],
  ['areas/select', areaSelect],
  ['auth/account', authAccount],
  ['auth/admin-register', authAdminRegister],
  ['auth/change-password', authChangePassword],
  ['auth/login', authLogin],
  ['auth/me', authMe],
  ['auth/refresh', authRefresh],
  ['chapters', chapters],
  ['chapters/assign-members', chapterAssignMembers],
  ['events', events],
  ['gig', gig],
  ['members', members],
  ['members/login', memberLogin],
  ['participants', participants],
  ['reports', reports],
  ['services', services],
  ['sync', sync]
]);

function normalizeRoute(value) {
  const route = Array.isArray(value) ? value[0] : value;
  return String(route || '').replace(/^\/+|\/+$/g, '');
}

export default async function handler(req, res) {
  // 1. Set Defensive HTTP Security Headers globally
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 2. Extract Client IP for Rate Limiting (handles Vercel/Proxy headers)
  const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  
  // 3. Apply Rate Limiting (e.g. 150 requests per 15 minutes globally per IP)
  if (isRateLimited(clientIp, 150)) {
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. Please try again later.'
    });
  }

  try {
    const route = normalizeRoute(req.query?.route);
    const routeHandler = ROUTES.get(route);

    if (!routeHandler) {
      return res.status(404).json({
        ok: false,
        error: 'API route not found.'
      });
    }

    return await routeHandler(req, res);
  } catch (error) {
    console.error('API router error:', error);
    if (res.headersSent) return;
    // Fall back to robust apiError handler for safe client messages
    return apiError(res, error);
  }
}
