import { createSupabaseAuthClient } from './supabase.js';
import { passwordSetupRedirectUrl } from './frontend-url.js';
import { normalizeEmail } from './http.js';

async function findAuthUserByEmail(supabase, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  // Account provisioning is an infrequent administrative action. Paging through
  // Auth users keeps the flow compatible with Supabase Admin without exposing
  // any privileged lookup to the browser.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find(user => normalizeEmail(user.email) === normalized);
    if (match) return match;
    if (users.length < 200) break;
  }

  return null;
}

function profileRollbackValues(profile) {
  if (!profile?.id) return null;
  return {
    member_id: profile.member_id || null,
    role: profile.role || 'member',
    area_id: profile.area_id || null,
    chapter_id: profile.chapter_id || null,
    must_change_password: profile.must_change_password === true,
    is_active: profile.is_active !== false,
    updated_at: new Date().toISOString()
  };
}

export async function ensureMemberAuthAccount({
  supabase,
  member,
  role = 'member',
  requirePasswordSetup = false
}) {
  if (!member?.id || !member?.email) {
    const error = new Error('A Member record with an email address is required to create account access.');
    error.statusCode = 400;
    throw error;
  }

  const email = normalizeEmail(member.email);
  const normalizedRole = String(role || member.access_level || 'member').trim().toLowerCase();

  const { data: memberProfile, error: memberProfileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('member_id', member.id)
    .maybeSingle();
  if (memberProfileError) throw memberProfileError;

  let authUserId = memberProfile?.id || null;
  let createdAccount = false;
  let linkedExistingAuth = false;
  let createdProfile = false;
  let previousProfile = memberProfile ? { ...memberProfile } : null;

  try {
    if (!authUserId) {
      const existingAuthUser = await findAuthUserByEmail(supabase, email);

      if (existingAuthUser) {
        authUserId = existingAuthUser.id;
        linkedExistingAuth = true;

        const { data: authProfile, error: authProfileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUserId)
          .maybeSingle();
        if (authProfileError) throw authProfileError;

        if (
          authProfile?.member_id &&
          String(authProfile.member_id) !== String(member.id)
        ) {
          const error = new Error('That email address is already linked to a different MFC Youth Member account.');
          error.statusCode = 409;
          throw error;
        }

        if (
          authProfile?.area_id &&
          member.area_id &&
          String(authProfile.area_id) !== String(member.area_id)
        ) {
          const error = new Error('That email address already belongs to an account in another MFC Youth Area.');
          error.statusCode = 409;
          error.code = 'ACCOUNT_AREA_CONFLICT';
          throw error;
        }

        if (authProfile) {
          previousProfile = { ...authProfile };
          const { error: profileLinkError } = await supabase
            .from('profiles')
            .update({
              member_id: member.id,
              role: normalizedRole,
              area_id: member.area_id,
              chapter_id: member.chapter_id || null,
              must_change_password: requirePasswordSetup ? true : Boolean(authProfile.must_change_password),
              is_active: String(member.status || 'Active') !== 'Inactive',
              updated_at: new Date().toISOString()
            })
            .eq('id', authUserId);
          if (profileLinkError) throw profileLinkError;
        } else {
          const { error: profileInsertError } = await supabase
            .from('profiles')
            .insert({
              id: authUserId,
              member_id: member.id,
              role: normalizedRole,
              area_id: member.area_id,
              chapter_id: member.chapter_id || null,
              must_change_password: requirePasswordSetup,
              is_active: String(member.status || 'Active') !== 'Inactive'
            });
          if (profileInsertError) throw profileInsertError;
          createdProfile = true;
        }
      } else {
        const { data: authData, error: authCreateError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
            registration_type: normalizedRole === 'member'
              ? 'admin_provisioned_member'
              : 'admin_provisioned_leader',
            onboarding_method: 'admin_password_setup',
            requested_role: normalizedRole
          }
        });

        if (authCreateError || !authData?.user) {
          throw authCreateError || new Error('Unable to create account access.');
        }

        authUserId = authData.user.id;
        createdAccount = true;

        const { error: profileInsertError } = await supabase
          .from('profiles')
          .insert({
            id: authUserId,
            member_id: member.id,
            role: normalizedRole,
            area_id: member.area_id,
            chapter_id: member.chapter_id || null,
            must_change_password: requirePasswordSetup,
            is_active: String(member.status || 'Active') !== 'Inactive'
          });

        if (profileInsertError) throw profileInsertError;
        createdProfile = true;
      }
    } else {
      const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update({
          role: normalizedRole,
          area_id: member.area_id,
          chapter_id: member.chapter_id || null,
          // Members -> Access is an explicit account setup/reset action. When
          // requirePasswordSetup is requested, keep the account in Setup Pending
          // until /api/auth/change-password completes successfully.
          must_change_password: requirePasswordSetup
            ? true
            : Boolean(memberProfile?.must_change_password),
          is_active: String(member.status || 'Active') !== 'Inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', authUserId);
      if (profileUpdateError) throw profileUpdateError;
    }

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(authUserId, {
      email,
      email_confirm: true,
      user_metadata: {
        display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
        registration_type: normalizedRole === 'member'
          ? 'admin_provisioned_member'
          : 'admin_provisioned_leader',
        onboarding_method: 'admin_password_setup',
        requested_role: normalizedRole
      }
    });
    if (authUpdateError) throw authUpdateError;

    // The account/profile mutation is already complete at this point. A read
    // failure should not make callers roll back a successfully provisioned
    // account, so return a deterministic fallback profile if the final hydrate
    // query is temporarily unavailable.
    const { data: profile, error: finalProfileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle();

    return {
      authUserId,
      profile: finalProfileError || !profile
        ? {
            id: authUserId,
            member_id: member.id,
            role: normalizedRole,
            area_id: member.area_id,
            chapter_id: member.chapter_id || null,
            must_change_password: requirePasswordSetup
              ? true
              : Boolean(previousProfile?.must_change_password),
            is_active: String(member.status || 'Active') !== 'Inactive'
          }
        : profile,
      createdAccount,
      linkedExistingAuth
    };
  } catch (error) {
    // Keep account provisioning atomic from the caller's perspective. New Auth
    // users are removed, newly inserted profiles are removed, and existing
    // profiles are restored when a later provisioning step fails.
    if (createdAccount && authUserId) {
      try {
        await supabase.auth.admin.deleteUser(authUserId);
      } catch (rollbackError) {
        console.error('Auth cleanup after provisioning failure failed:', rollbackError);
      }
    } else if (authUserId) {
      if (createdProfile) {
        try {
          await supabase.from('profiles').delete().eq('id', authUserId);
        } catch (rollbackError) {
          console.error('Profile cleanup after provisioning failure failed:', rollbackError);
        }
      } else if (previousProfile?.id) {
        const rollback = profileRollbackValues(previousProfile);
        try {
          await supabase.from('profiles').update(rollback).eq('id', previousProfile.id);
        } catch (rollbackError) {
          console.error('Profile rollback after provisioning failure failed:', rollbackError);
        }
      }
    }
    throw error;
  }
}

export async function sendPasswordSetupEmail(req, email) {
  const authClient = createSupabaseAuthClient();
  const redirectTo = passwordSetupRedirectUrl(req);
  const { error } = await authClient.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo });
  if (error) throw error;
  return { setupEmailSent: true, redirectTo };
}
