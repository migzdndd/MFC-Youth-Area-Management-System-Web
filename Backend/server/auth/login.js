import { createSupabaseAuthClient, createSupabaseAdmin } from '../_lib/supabase.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError } from '../_lib/http.js';
import { assertBackendConfigured } from '../_lib/env.js';
import { loginRateKeys, checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from '../_lib/auth-rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!isValidEmail(email) || !password) {
      return sendJson(res, 400, { ok: false, error: 'A valid email and password are required.' });
    }

    const admin = createSupabaseAdmin();
    const { supabaseSecretKey } = assertBackendConfigured();
    const rateKeys = loginRateKeys(req, email, supabaseSecretKey);
    const currentLimit = await checkLoginRateLimit(admin, rateKeys);
    if (currentLimit.blocked) {
      res.setHeader('Retry-After', String(currentLimit.retryAfterSeconds));
      return sendJson(res, 429, { ok: false, error: 'Too many failed sign-in attempts. Try again later.', code: 'LOGIN_RATE_LIMITED' });
    }

    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });

    if (error || !data?.session || !data?.user) {
      const failure = await recordLoginFailure(admin, rateKeys);
      if (failure.blocked) res.setHeader('Retry-After', String(failure.retryAfterSeconds));
      return sendJson(res, failure.blocked ? 429 : 401, {
        ok: false,
        error: failure.blocked ? 'Too many failed sign-in attempts. Try again later.' : 'Invalid email or password.',
        ...(failure.blocked ? { code: 'LOGIN_RATE_LIMITED' } : {})
      });
    }

    await resetLoginRateLimit(admin, rateKeys);
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, member_id, role, area_id, chapter_id, must_change_password, is_active')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || profile.is_active === false) {
      return sendJson(res, 403, { ok: false, error: 'This account is not active.' });
    }

    return sendJson(res, 200, {
      ok: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.display_name || data.user.email,
        memberId: profile.member_id,
        role: profile.role,
        areaId: profile.area_id,
        chapterId: profile.chapter_id,
        mustChangePassword: profile.must_change_password
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
