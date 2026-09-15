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
    if (!isValidEmail(email) || !isGmailEmail(email)) {
      return sendJson(res, 400, { ok: false, error: 'Enter the registered Gmail address for this account.' });
    }

    const admin = createSupabaseAdmin();
    const { data: member, error: memberError } = await admin
      .from('members')
      .select('id, email, status, access_level')
      .ilike('email', email)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) {
      return sendJson(res, 404, { ok: false, error: 'No provisioned MFC Youth account is linked to that Gmail address.' });
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, member_id, role, area_id, chapter_id, must_change_password, is_active')
      .eq('member_id', member.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return sendJson(res, 409, { ok: false, error: 'This account has not been provisioned yet. Ask an authorized Servant Leader to resend access.' });
    }
    if (profile.is_active === false || String(member.status || 'Active') === 'Inactive') {
      return sendJson(res, 403, { ok: false, error: 'This account is currently inactive.' });
    }

    const role = String(profile.role || '').toLowerCase();
    const isMember = role === 'member';
    const isPendingLeader = !isMember && profile.must_change_password === true;
    if (!isMember && !isPendingLeader) {
      return sendJson(res, 400, {
        ok: false,
        error: 'This Servant Leader account is already activated. Sign in with your account password.'
      });
    }

    const authClient = createSupabaseAuthClient();
    const { error: otpError } = await authClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });
    if (otpError) {
      const message = String(otpError.message || '').toLowerCase();
      if (message.includes('rate') || message.includes('seconds')) {
        return sendJson(res, 429, {
          ok: false,
          error: 'A verification code was requested recently. Wait a moment before requesting another code.'
        });
      }
      throw otpError;
    }

    return sendJson(res, 200, {
      ok: true,
      email,
      codeSent: true,
      firstTimeLeaderSetup: isPendingLeader,
      message: isMember
        ? 'A one-time sign-in code was sent to your Gmail account.'
        : 'A verification code was sent to your Gmail account. After verification, you will create your Servant Leader password.'
    });
  } catch (error) {
    return apiError(res, error);
  }
}
