import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdmin, createSupabaseAuthClient } from '../_lib/supabase.js';
import { assertAdminRegistrationConfigured } from '../_lib/env.js';
import { sendJson, methodNotAllowed, normalizeEmail, isValidEmail, apiError } from '../_lib/http.js';

const ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

function cleanText(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function passwordError(password) {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}

function registrationCodeMatches(input, expected) {
  const supplied = Buffer.from(String(input || ''), 'utf8');
  const target = Buffer.from(String(expected || ''), 'utf8');
  if (!supplied.length || supplied.length !== target.length) return false;
  return timingSafeEqual(supplied, target);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { adminRegistrationCode } = assertAdminRegistrationConfigured();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const confirmation = String(req.body?.confirmPassword || '');
    const verificationCode = String(req.body?.verificationCode || '');
    const displayName = cleanText(req.body?.displayName, 160);
    const role = String(req.body?.role || '').trim().toLowerCase();

    if (!displayName) {
      return sendJson(res, 400, { ok: false, error: 'Enter your full name.' });
    }
    if (!isValidEmail(email)) {
      return sendJson(res, 400, { ok: false, error: 'Enter a valid email address.' });
    }
    if (!ADMIN_ROLES.has(role)) {
      return sendJson(res, 400, { ok: false, error: 'Select a valid Servant Leader access level.' });
    }
    if (!registrationCodeMatches(verificationCode, adminRegistrationCode)) {
      return sendJson(res, 403, { ok: false, error: 'Administrator registration verification failed.' });
    }

    const pError = passwordError(password);
    if (pError) return sendJson(res, 400, { ok: false, error: pError });
    if (password !== confirmation) {
      return sendJson(res, 400, { ok: false, error: 'Passwords do not match.' });
    }

    const admin = createSupabaseAdmin();
    let createdUserId = null;

    try {
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          registration_type: 'servant_leader'
        }
      });

      if (authError || !authData?.user) {
        if (String(authError?.message || '').toLowerCase().includes('already')) {
          return sendJson(res, 409, { ok: false, error: 'An account with this email already exists.' });
        }
        throw authError || new Error('Unable to create the account.');
      }

      createdUserId = authData.user.id;

      const { error: profileError } = await admin
        .from('profiles')
        .insert({
          id: createdUserId,
          member_id: null,
          role,
          area_id: null,
          chapter_id: null,
          must_change_password: false,
          is_active: true
        });
      if (profileError) throw profileError;

      const authClient = createSupabaseAuthClient();
      const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
        email,
        password
      });
      if (signInError || !signInData?.session) {
        throw signInError || new Error('Account created, but automatic sign-in failed.');
      }

      return sendJson(res, 201, {
        ok: true,
        requiresAreaSelection: true,
        session: {
          accessToken: signInData.session.access_token,
          refreshToken: signInData.session.refresh_token,
          expiresAt: signInData.session.expires_at
        },
        user: {
          id: createdUserId,
          email,
          name: displayName,
          memberId: null,
          role,
          areaId: null,
          chapterId: null,
          mustChangePassword: false
        }
      });
    } catch (error) {
      if (createdUserId) {
        await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
      }
      throw error;
    }
  } catch (error) {
    return apiError(res, error);
  }
}
