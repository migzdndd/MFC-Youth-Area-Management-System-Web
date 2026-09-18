import { createSupabaseAuthClient, createSupabaseAdmin } from '../_lib/supabase.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError } from '../_lib/http.js';
import { claimMemberRecord } from '../_lib/member-claim.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!isValidEmail(email) || !password) {
      return sendJson(res, 400, { ok: false, error: 'A valid email and password are required.' });
    }

    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });

    if (error || !data?.session || !data?.user) {
      return sendJson(res, 401, { ok: false, error: 'Invalid email or password.' });
    }

    const admin = createSupabaseAdmin();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, member_id, role, area_id, chapter_id, must_change_password, is_active')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    let linkedProfile = profile;
    if (!linkedProfile) {
      if (!data.user.email_confirmed_at) {
        return sendJson(res, 403, { ok: false, error: 'Verify your email address before accessing the Member Portal.' });
      }
      linkedProfile = (await claimMemberRecord({ supabase: admin, user: data.user })).profile;
    }
    if (linkedProfile.is_active === false) {
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
        memberId: linkedProfile.member_id,
        role: linkedProfile.role,
        areaId: linkedProfile.area_id,
        chapterId: linkedProfile.chapter_id,
        mustChangePassword: linkedProfile.must_change_password
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
