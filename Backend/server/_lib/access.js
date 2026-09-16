import { createSupabaseAdmin, createSupabaseAuthClient } from './supabase.js';
import { readBearerToken } from './http.js';

export const SUPER_ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant'
]);

export function isSuperAdminRole(role) {
  return SUPER_ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
}

export function isChapterServantRole(role) {
  return String(role || '').trim().toLowerCase() === 'chapter_servant';
}

/**
 * Validates a user's access token with the normal Supabase Auth client, then
 * uses the privileged backend client only for database/profile operations.
 *
 * Keeping token verification on the publishable/anon Auth client avoids
 * mixing the backend secret/service-role authorization header with an end-user
 * bearer token. This is especially important when using Supabase's newer
 * publishable + secret API key format.
 */
export async function requireAuthenticatedProfile(req) {
  const token = readBearerToken(req);
  if (!token) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const authClient = createSupabaseAuthClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) {
    const error = new Error('Session is invalid or expired.');
    error.statusCode = 401;
    error.code = 'INVALID_SESSION';
    throw error;
  }

  const supabase = createSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.is_active === false) {
    const error = new Error('This account is not active.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_INACTIVE';
    throw error;
  }

  return { supabase, user: userData.user, profile, token };
}
