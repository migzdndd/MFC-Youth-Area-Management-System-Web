import { createSupabaseAdmin, createSupabaseAuthClient } from '../_lib/supabase.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
  isGmailEmail,
  apiError
} from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.code || req.body?.token || '').replace(/\s+/g, '');

    if (!isValidEmail(email) || !isGmailEmail(email)) {
      return sendJson(res, 400, { ok: false, error: 'Enter the registered Gmail address for this account.' });
    }
    if (!/^\d{6,10}$/.test(token)) {
      return sendJson(res, 400, { ok: false, error: 'Enter the verification code sent to your Gmail account.' });
    }

    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });

    if (error || !data?.session || !data?.user) {
      return sendJson(res, 401, { ok: false, error: 'The verification code is invalid or expired. Request a new code and try again.' });
    }

    const admin = createSupabaseAdmin();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, member_id, role, area_id, chapter_id, must_change_password, is_active')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.is_active === false) {
      return sendJson(res, 403, { ok: false, error: 'This account is not active.' });
    }

    const role = String(profile.role || '').toLowerCase();
    const isMember = role === 'member';
    const isPendingLeader = !isMember && profile.must_change_password === true;
    if (!isMember && !isPendingLeader) {
      return sendJson(res, 403, {
        ok: false,
        error: 'This Servant Leader account is already activated. Sign in with your password.'
      });
    }

    let displayName = data.user.user_metadata?.display_name || data.user.email;
    if (profile.member_id) {
      const { data: member, error: memberError } = await admin
        .from('members')
        .select('first_name, middle_name, last_name, status')
        .eq('id', profile.member_id)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member || String(member.status || 'Active') === 'Inactive') {
        return sendJson(res, 403, { ok: false, error: 'This account is currently inactive.' });
      }
      displayName = [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' ') || displayName;
    }

    return sendJson(res, 200, {
      ok: true,
      emailVerified: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        name: displayName,
        memberId: profile.member_id,
        role: profile.role,
        areaId: profile.area_id,
        chapterId: profile.chapter_id,
        mustChangePassword: isPendingLeader
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
