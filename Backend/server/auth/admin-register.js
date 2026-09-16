import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdmin, createSupabaseAuthClient } from '../_lib/supabase.js';
import { assertAdminRegistrationConfigured } from '../_lib/env.js';
import {
  adminRegistrationRateKeys,
  checkAdminRegistrationRateLimit,
  recordAdminRegistrationFailure,
  resetAdminRegistrationRateLimit
} from '../_lib/admin-registration-rate-limit.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
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

function validateRegistrationInput(body) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const confirmation = String(body?.confirmPassword || '');
  const displayName = cleanText(body?.displayName, 160);
  const role = String(body?.role || '').trim().toLowerCase();

  if (!displayName) return { error: 'Enter your full name.' };
  if (!isValidEmail(email)) return { error: 'Enter a valid email address.' };
  if (!ADMIN_ROLES.has(role)) return { error: 'Select a valid Servant Leader access level.' };

  const pError = passwordError(password);
  if (pError) return { error: pError };
  if (password !== confirmation) return { error: 'Passwords do not match.' };

  return {
    email,
    password,
    displayName,
    role
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { adminRegistrationCode } = assertAdminRegistrationConfigured();
    const admin = createSupabaseAdmin();
    const email = normalizeEmail(req.body?.email);
    const rateKeys = adminRegistrationRateKeys(req, email, adminRegistrationCode);
    const currentLimit = await checkAdminRegistrationRateLimit(admin, rateKeys);

    if (currentLimit.blocked) {
      res.setHeader('Retry-After', String(currentLimit.retryAfterSeconds));
      return sendJson(res, 429, {
        ok: false,
        code: 'ADMIN_REGISTRATION_RATE_LIMITED',
        error: 'Too many failed Administrator Registration Code attempts. Try again later.',
        retryAfterSeconds: currentLimit.retryAfterSeconds
      });
    }

    const suppliedRegistrationCode = String(req.body?.verificationCode || '');
    if (!registrationCodeMatches(suppliedRegistrationCode, adminRegistrationCode)) {
      const failure = await recordAdminRegistrationFailure(admin, rateKeys);

      if (failure.blocked) {
        res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        return sendJson(res, 429, {
          ok: false,
          code: 'ADMIN_REGISTRATION_RATE_LIMITED',
          error: 'Too many failed Administrator Registration Code attempts. Try again later.',
          retryAfterSeconds: failure.retryAfterSeconds
        });
      }

      return sendJson(res, 403, {
        ok: false,
        code: 'INVALID_ADMIN_REGISTRATION_CODE',
        error: 'Administrator registration verification failed.'
      });
    }

    // A correct private registration code proves authorization for this rate-limit scope.
    // Clear prior failures before continuing with normal form validation.
    await resetAdminRegistrationRateLimit(admin, rateKeys);

    const input = validateRegistrationInput(req.body);
    if (input.error) {
      return sendJson(res, input.status || 400, { ok: false, error: input.error });
    }

    const { data: existingMember, error: memberLookupError } = await admin
      .from('members')
      .select('id, area_id, chapter_id, status, access_level')
      .eq('email', input.email)
      .maybeSingle();
    if (memberLookupError) throw memberLookupError;

    if (existingMember?.status === 'Inactive') {
      return sendJson(res, 409, {
        ok: false,
        error: 'The Member record linked to this email is inactive. Activate the Member before creating account access.'
      });
    }

    if (input.role === 'chapter_servant' && (!existingMember || !existingMember.chapter_id)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Chapter Servant accounts must be created from an existing Member who is already assigned to a Chapter.'
      });
    }

    const { data: authData, error: authCreateError } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        display_name: input.displayName,
        registration_type: existingMember ? 'member_linked_servant_leader' : 'servant_leader_bootstrap',
        onboarding_method: 'password',
        requested_role: input.role
      }
    });

    if (authCreateError || !authData?.user) {
      const message = String(authCreateError?.message || '').toLowerCase();
      if (message.includes('already') || message.includes('registered')) {
        return sendJson(res, 409, {
          ok: false,
          error: 'This email address already has an MFC Youth login account. Sign in or manage it from Members → Access.'
        });
      }
      throw authCreateError || new Error('Unable to create the Servant Leader account.');
    }

    const userId = authData.user.id;
    let profileCreated = false;
    let memberAccessUpdated = false;
    const previousMemberAccessLevel = existingMember?.access_level || 'member';

    try {
      const { error: profileError } = await admin
        .from('profiles')
        .insert({
          id: userId,
          member_id: existingMember?.id || null,
          role: input.role,
          area_id: existingMember?.area_id || null,
          chapter_id: existingMember?.chapter_id || null,
          must_change_password: false,
          is_active: true
        });
      if (profileError) throw profileError;
      profileCreated = true;

      if (existingMember) {
        const { error: memberUpdateError } = await admin
          .from('members')
          .update({
            access_level: input.role,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingMember.id);
        if (memberUpdateError) throw memberUpdateError;
        memberAccessUpdated = true;
      }

      const authClient = createSupabaseAuthClient();
      const { data: loginData, error: loginError } = await authClient.auth.signInWithPassword({
        email: input.email,
        password: input.password
      });

      if (loginError || !loginData?.session || !loginData?.user) {
        throw loginError || new Error('Account created, but automatic sign-in failed.');
      }

      return sendJson(res, 201, {
        ok: true,
        requiresAreaSelection: !existingMember?.area_id,
        linkedMember: Boolean(existingMember),
        session: {
          accessToken: loginData.session.access_token,
          refreshToken: loginData.session.refresh_token,
          expiresAt: loginData.session.expires_at
        },
        user: {
          id: loginData.user.id,
          email: input.email,
          name: input.displayName,
          memberId: existingMember?.id || null,
          role: input.role,
          areaId: existingMember?.area_id || null,
          chapterId: existingMember?.chapter_id || null,
          mustChangePassword: false,
          passwordMode: 'self_chosen'
        },
        message: existingMember
          ? 'Servant Leader account created and linked to the existing Member record.'
          : 'Initial Servant Leader account created. Continue to Area setup.'
      });
    } catch (error) {
      // Keep linked Member access consistent if account creation fails after
      // temporarily elevating the Member record.
      if (memberAccessUpdated && existingMember?.id) {
        try {
          await admin
            .from('members')
            .update({
              access_level: previousMemberAccessLevel,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingMember.id);
        } catch (rollbackError) {
          console.error('Member access rollback after registration failure failed:', rollbackError);
        }
      }

      // Deleting the Auth user also removes its linked profile through the
      // database foreign-key/cascade relationship.
      if (profileCreated || userId) {
        try {
          await admin.auth.admin.deleteUser(userId);
        } catch (cleanupError) {
          console.error('Auth cleanup after registration failure failed:', cleanupError);
        }
      }
      throw error;
    }
  } catch (error) {
    return apiError(res, error);
  }
}
