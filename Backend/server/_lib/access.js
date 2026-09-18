import { createSupabaseAdmin } from './supabase.js';
import { readBearerToken } from './http.js';

export const AREA_ADMIN_ROLES = new Set([
  'national_coordinator',
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'mfc_high_servant',
  'area_kids_servant'
]);

/**
 * Checks if the given role is considered an Area Admin role.
 *
 * @param {string} role - The user's role string.
 * @returns {boolean} True if the role has Area Admin privileges.
 */
export function isAreaAdminRole(role) {
  return AREA_ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
}

/**
 * Checks if the given role is a Chapter Servant.
 *
 * @param {string} role - The user's role string.
 * @returns {boolean} True if the role is a chapter servant.
 */
export function isChapterServantRole(role) {
  return String(role || '').trim().toLowerCase() === 'chapter_servant';
}

/**
 * Authenticates a user based on the request's Bearer token.
 *
 * @param {import('http').IncomingMessage} req - The request object.
 * @returns {Promise<{ supabase: import('@supabase/supabase-js').SupabaseClient, user: import('@supabase/supabase-js').User, token: string }>} 
 * @throws {Error} 401 Unauthorized if the token is missing or invalid.
 */
export async function requireAuthenticatedUser(req) {
  const token = readBearerToken(req);
  if (!token) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const supabase = createSupabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    const error = new Error('Session is invalid or expired.');
    error.statusCode = 401;
    error.code = 'INVALID_SESSION';
    throw error;
  }

  return { supabase, user: userData.user, token };
}

/**
 * Authenticates a user and retrieves their active profile.
 *
 * @param {import('http').IncomingMessage} req - The request object.
 * @returns {Promise<{ supabase: import('@supabase/supabase-js').SupabaseClient, user: import('@supabase/supabase-js').User, profile: Object, token: string }>}
 * @throws {Error} 403 Forbidden if the profile is inactive.
 */
export async function requireAuthenticatedProfile(req) {
  const { supabase, user, token } = await requireAuthenticatedUser(req);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.is_active === false) {
    const error = new Error('This account is not active.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_INACTIVE';
    throw error;
  }

  return { supabase, user, profile, token };
}
