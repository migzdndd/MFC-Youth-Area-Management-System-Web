import { createSupabaseAdmin } from './supabase.js';
import { readBearerToken } from './http.js';

export const AREA_ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'mfc_high_servant',
  'area_kids_servant'
]);

export function isAreaAdminRole(role) {
  return AREA_ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
}

// Backward-compatible aliases for older modules while the product terminology
// is migrated away from the nonexistent `super_admin` role name.
export const SUPER_ADMIN_ROLES = AREA_ADMIN_ROLES;
export const isSuperAdminRole = isAreaAdminRole;

export function isChapterServantRole(role) {
  return String(role || '').trim().toLowerCase() === 'chapter_servant';
}

async function syncLinkedMemberEmail(supabase, user, profile) {
  const authEmail = String(user?.email || '').trim().toLowerCase();
  if (!authEmail || !profile?.member_id) return;

  try {
    const { data: member, error: lookupError } = await supabase
      .from('members')
      .select('id, email')
      .eq('id', profile.member_id)
      .maybeSingle();

    if (lookupError || !member) {
      if (lookupError) throw lookupError;
      return;
    }

    if (String(member.email || '').trim().toLowerCase() === authEmail) return;

    const { error: updateError } = await supabase
      .from('members')
      .update({ email: authEmail, updated_at: new Date().toISOString() })
      .eq('id', profile.member_id);

    if (updateError) throw updateError;

    console.info(JSON.stringify({
      event: 'AUTH_EMAIL_SYNC',
      actor_id: user.id,
      target_member_id: profile.member_id,
      timestamp: new Date().toISOString(),
      status: 'SUCCESS'
    }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'AUTH_EMAIL_SYNC',
      actor_id: user?.id || null,
      target_member_id: profile?.member_id || null,
      timestamp: new Date().toISOString(),
      status: 'FAILURE',
      error_code: 'MEMBER_EMAIL_SYNC_FAILED'
    }));
  }
}

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

  // Supabase Auth is authoritative for account email. Secure Email Change does
  // not update public.members until confirmation, so repair any confirmed drift
  // on the next authenticated backend request without trusting client input.
  await syncLinkedMemberEmail(supabase, user, profile);

  return { supabase, user, profile, token };
}
