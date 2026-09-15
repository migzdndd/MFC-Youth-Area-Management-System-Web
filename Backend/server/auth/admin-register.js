import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdmin, createSupabaseAuthClient } from '../_lib/supabase.js';
import { assertAdminRegistrationConfigured } from '../_lib/env.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
  isGmailEmail,
  apiError
} from '../_lib/http.js';

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

function stageError(error, stage, code) {
  const wrapped = error instanceof Error ? error : new Error(String(error || 'Unknown backend error.'));
  wrapped.stage = stage;
  wrapped.code = wrapped.code || code;
  return wrapped;
}

function validateRegistrationInput(body, adminRegistrationCode) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const confirmation = String(body?.confirmPassword || '');
  const verificationCode = String(body?.verificationCode || '');
  const displayName = cleanText(body?.displayName, 160);
  const role = String(body?.role || '').trim().toLowerCase();

  if (!displayName) return { error: 'Enter your full name.' };
  if (!isValidEmail(email) || !isGmailEmail(email)) {
    return { error: 'Use a valid Gmail address ending in @gmail.com.' };
  }
  if (!ADMIN_ROLES.has(role)) {
    return { error: 'Select a valid Servant Leader access level.' };
  }
  if (!registrationCodeMatches(verificationCode, adminRegistrationCode)) {
    return { status: 403, error: 'Administrator registration verification failed.' };
  }

  const pError = passwordError(password);
  if (pError) return { error: pError };
  if (password !== confirmation) return { error: 'Passwords do not match.' };

  return {
    email,
    password,
    displayName,
    role,
    verificationCode
  };
}

async function requestOtp(req, res, input) {
  const authClient = createSupabaseAuthClient();
  const { error } = await authClient.auth.signInWithOtp({
    email: input.email,
    options: {
      shouldCreateUser: true,
      data: {
        display_name: input.displayName,
        registration_type: 'servant_leader_pending_otp',
        onboarding_method: 'registration_email_otp',
        requested_role: input.role
      }
    }
  });

  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('rate') || message.includes('seconds')) {
      return sendJson(res, 429, {
        ok: false,
        error: 'A verification code was requested recently. Wait a moment before requesting another code.'
      });
    }
    throw stageError(error, 'registration_otp_request', 'REGISTRATION_OTP_REQUEST_FAILED');
  }

  return sendJson(res, 202, {
    ok: true,
    verificationRequired: true,
    email: input.email,
    message: `A verification code was sent to ${input.email}. Enter it to finish creating the Servant Leader account.`
  });
}

async function verifyOtpAndRegister(req, res, input) {
  const token = String(req.body?.otpCode || req.body?.code || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) {
    return sendJson(res, 400, { ok: false, error: 'Enter the verification code sent to your Gmail account.' });
  }

  const authClient = createSupabaseAuthClient();
  const { data: otpData, error: otpError } = await authClient.auth.verifyOtp({
    email: input.email,
    token,
    type: 'email'
  });

  if (otpError || !otpData?.session || !otpData?.user) {
    return sendJson(res, 401, {
      ok: false,
      error: 'The verification code is invalid or expired. Request a new code and try again.'
    });
  }

  if (normalizeEmail(otpData.user.email) !== input.email) {
    return sendJson(res, 403, { ok: false, error: 'The verification code does not match this registration email.' });
  }

  const admin = createSupabaseAdmin();
  const { data: existingProfile, error: existingProfileError } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', otpData.user.id)
    .maybeSingle();
  if (existingProfileError) throw existingProfileError;
  if (existingProfile) {
    return sendJson(res, 409, {
      ok: false,
      error: 'This Gmail address is already linked to an MFC Youth account. Sign in instead of registering again.'
    });
  }

  const { error: authUpdateError } = await admin.auth.admin.updateUserById(otpData.user.id, {
    password: input.password,
    user_metadata: {
      ...(otpData.user.user_metadata || {}),
      display_name: input.displayName,
      registration_type: 'servant_leader',
      onboarding_method: 'registration_email_otp_verified',
      requested_role: input.role
    }
  });
  if (authUpdateError) {
    throw stageError(authUpdateError, 'auth_user_finalization', 'AUTH_USER_FINALIZATION_FAILED');
  }

  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      id: otpData.user.id,
      member_id: null,
      role: input.role,
      area_id: null,
      chapter_id: null,
      must_change_password: false,
      is_active: true
    });
  if (profileError) {
    throw stageError(profileError, 'profile_creation', 'PROFILE_CREATION_FAILED');
  }

  return sendJson(res, 201, {
    ok: true,
    requiresAreaSelection: true,
    emailVerified: true,
    session: {
      accessToken: otpData.session.access_token,
      refreshToken: otpData.session.refresh_token,
      expiresAt: otpData.session.expires_at
    },
    user: {
      id: otpData.user.id,
      email: input.email,
      name: input.displayName,
      memberId: null,
      role: input.role,
      areaId: null,
      chapterId: null,
      mustChangePassword: false,
      passwordMode: 'self_chosen',
      emailVerification: 'otp'
    },
    message: 'Gmail verification completed. Your Servant Leader account has been created.'
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { adminRegistrationCode } = assertAdminRegistrationConfigured();
    const input = validateRegistrationInput(req.body, adminRegistrationCode);
    if (input.error) {
      return sendJson(res, input.status || 400, { ok: false, error: input.error });
    }

    const stage = String(req.body?.stage || 'request_otp').trim().toLowerCase();
    if (stage === 'request_otp') return await requestOtp(req, res, input);
    if (stage === 'verify_otp') return await verifyOtpAndRegister(req, res, input);

    return sendJson(res, 400, { ok: false, error: 'Invalid registration stage.' });
  } catch (error) {
    return apiError(res, error);
  }
}
