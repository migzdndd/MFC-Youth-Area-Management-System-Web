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

const MAX_BODY_BYTES = 64 * 1024;
const ROUTE_LIMITS = new Map([
  ['auth/login', { limit: 10, windowMs: 15 * 60 * 1000 }],
  ['auth/admin-register', { limit: 12, windowMs: 15 * 60 * 1000 }],
  ['auth/change-password', { limit: 10, windowMs: 15 * 60 * 1000 }],
  ['auth/refresh', { limit: 60, windowMs: 15 * 60 * 1000 }],
  ['members/login', { limit: 20, windowMs: 15 * 60 * 1000 }],
  ['sync', { limit: 90, windowMs: 15 * 60 * 1000 }]
]);

function clientAddress(req) {
  const raw = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim().slice(0, 128) || 'unknown';
}

function requestBodyTooLarge(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return true;
  if (req.body == null) return false;
  try {
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  applySecurityHeaders(res);

  try {
    if (requestBodyTooLarge(req)) {
      return res.status(413).json({ ok: false, error: 'Request payload is too large.' });
    }

    const route = normalizeRoute(req.query?.route);
    const routeHandler = ROUTES.get(route);

    if (!routeHandler) {
      return res.status(404).json({ ok: false, error: 'API route not found.' });
    }

    const ip = clientAddress(req);
    if (isRateLimited(`global:${ip}`, 180, 15 * 60 * 1000)) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    }

    const routeLimit = ROUTE_LIMITS.get(route);
    if (routeLimit && isRateLimited(`${route}:${ip}`, routeLimit.limit, routeLimit.windowMs)) {
      res.setHeader('Retry-After', String(Math.ceil(routeLimit.windowMs / 1000)));
      return res.status(429).json({ ok: false, error: 'Too many requests to this endpoint. Please try again later.' });
    }

    return await routeHandler(req, res);
  } catch (error) {
    console.error('API router error:', {
      name: error?.name || 'Error',
      code: error?.code || null,
      stage: error?.stage || null
    });
    if (res.headersSent) return;
    return apiError(res, error);
  }
}
