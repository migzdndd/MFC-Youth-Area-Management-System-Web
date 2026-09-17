import {
  requireAuthenticatedProfile,
  isSuperAdminRole,
  isChapterServantRole
} from '../_lib/access.js';
import {
  sendJson,
  methodNotAllowed,
  normalizeEmail,
  isValidEmail,
  apiError
} from '../_lib/http.js';
import { ensureMemberAuthAccount, sendPasswordSetupEmail } from '../_lib/account-provision.js';

const ACCESS_LEVELS = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant',
  'member'
]);

function cleanText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

async function loadAreaMember(supabase, memberId, areaId) {
  if (!memberId || !areaId) return null;
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', memberId)
    .eq('area_id', areaId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function validateChapter(supabase, chapterId, areaId) {
  if (!chapterId) return null;
  const { data: chapter, error } = await supabase
    .from('chapters')
    .select('id, area_id')
    .eq('id', chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!chapter || String(chapter.area_id) !== String(areaId)) {
    const invalid = new Error('The selected chapter does not belong to your Area.');
    invalid.statusCode = 400;
    throw invalid;
  }
  return chapter;
}

async function listMembers(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);

  let query = supabase
    .from('members')
    .select('id, area_id, chapter_id, first_name, middle_name, last_name, birth_date, contact_number, email, address, status, first_attended_youth_camp, access_level, created_at, updated_at')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  if (isSuperAdminRole(profile.role)) {
    query = query.eq('area_id', profile.area_id);
  } else if (isChapterServantRole(profile.role)) {
    query = profile.chapter_id
      ? query.eq('chapter_id', profile.chapter_id)
      : query.eq('id', profile.member_id);
  } else {
    query = query.eq('id', profile.member_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  const members = data || [];
  const memberIds = members.map(member => member.id).filter(Boolean);
  const accountByMemberId = new Map();

  if (memberIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('member_id, role, is_active, must_change_password')
      .in('member_id', memberIds);
    if (profilesError) throw profilesError;

    (profiles || []).forEach(account => {
      if (account.member_id) accountByMemberId.set(String(account.member_id), account);
    });
  }

  const hydratedMembers = members.map(member => {
    const account = accountByMemberId.get(String(member.id)) || null;
    return {
      ...member,
      account_provisioned: Boolean(account),
      account_active: account ? account.is_active !== false : false,
      account_role: account?.role || null,
      account_setup_required: account?.must_change_password === true
    };
  });

  return sendJson(res, 200, { ok: true, members: hydratedMembers });
}

async function createMember(req, res) {
  const { supabase, profile, user } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role) && !isChapterServantRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'You do not have permission to add members.' });
  }

  const input = req.body || {};
  const firstName = cleanText(input.firstName, 100);
  const middleName = cleanText(input.middleName, 100) || null;
  const lastName = cleanText(input.lastName, 100);
  const email = normalizeEmail(input.email);
  const contactNumber = cleanText(input.contactNumber, 50) || null;
  const address = cleanText(input.address, 1000) || null;
  const birthDate = input.birthDate || null;
  const firstAttendedYouthCamp = input.firstAttendedYouthCamp || null;
  const status = String(input.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';

  if (!firstName || !lastName) {
    return sendJson(res, 400, { ok: false, error: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { ok: false, error: 'A valid email address is required.' });
  }

  const requestedRole = String(input.accessLevel || 'member').trim().toLowerCase();
  let accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  const areaId = profile.area_id;
  let chapterId = input.chapterId || null;

  if (isChapterServantRole(profile.role)) {
    accessLevel = 'member';
    chapterId = profile.chapter_id;
  }

  if (!areaId) {
    return sendJson(res, 409, { ok: false, error: 'Your account is not assigned to an Area.' });
  }
  if (isChapterServantRole(profile.role) && !chapterId) {
    return sendJson(res, 409, { ok: false, error: 'Your Chapter Servant account is not assigned to a chapter.' });
  }
  if (accessLevel === 'chapter_servant' && !chapterId) {
    return sendJson(res, 400, { ok: false, error: 'A Chapter Servant must be assigned to a chapter.' });
  }

  await validateChapter(supabase, chapterId, areaId);

  const { data: existingMember, error: existingError } = await supabase
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingMember) {
    return sendJson(res, 409, { ok: false, error: 'A member with that email already exists.' });
  }

  let createdMember = null;
  let createdAuthUserId = null;

  try {
    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({
        area_id: areaId,
        chapter_id: chapterId,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        birth_date: birthDate,
        contact_number: contactNumber,
        email,
        address,
        status,
        first_attended_youth_camp: firstAttendedYouthCamp,
        access_level: accessLevel,
        created_by: user.id
      })
      .select('*')
      .single();

    if (memberError) throw memberError;
    createdMember = member;

    // A normal Member record does not require a login account or password.
    // Leadership access is provisioned only when an elevated access level is
    // intentionally assigned by an authorized administrator.
    if (accessLevel === 'member') {
      return sendJson(res, 201, {
        ok: true,
        member: createdMember,
        account: {
          provisioned: false,
          email,
          role: 'member',
          passwordRequired: false,
          setupEmailSent: false,
          onboardingMethod: 'none'
        },
        message: 'Member added. No login account or password is required.'
      });
    }

    const provisioned = await ensureMemberAuthAccount({
      supabase,
      member: createdMember,
      role: accessLevel,
      requirePasswordSetup: true
    });
    createdAuthUserId = provisioned.createdAccount ? provisioned.authUserId : null;

    let setupEmailSent = false;
    let onboardingWarning = '';
    if (status !== 'Inactive') {
      try {
        await sendPasswordSetupEmail(req, email);
        setupEmailSent = true;
      } catch {
        onboardingWarning = 'Servant Leader account created, but the password setup email could not be sent. Use Members → Access to resend it.';
      }
    }

    return sendJson(res, 201, {
      ok: true,
      member: createdMember,
      account: {
        provisioned: true,
        email,
        setupEmailSent,
        mustChangePassword: true,
        passwordRequired: true,
        role: accessLevel,
        onboardingMethod: 'admin_password_setup'
      },
      message: setupEmailSent
        ? 'Member added and Servant Leader account created. A secure password setup link was sent to the Member email.'
        : (onboardingWarning || 'Member added and Servant Leader account created.')
    });
  } catch (error) {
    // If leadership account provisioning failed after creating the Member,
    // remove both parts so the UI does not report a partially-created account.
    if (createdAuthUserId) {
      try {
        await supabase.auth.admin.deleteUser(createdAuthUserId);
      } catch (cleanupError) {
        console.error('Auth cleanup after Member creation failure failed:', cleanupError);
      }
    }
    if (createdMember?.id) {
      try {
        await supabase.from('members').delete().eq('id', createdMember.id);
      } catch (cleanupError) {
        console.error('Member cleanup after creation failure failed:', cleanupError);
      }
    }
    throw error;
  }
}

async function updateMember(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can edit member records.' });
  }

  const input = req.body || {};
  const memberId = input.id;
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

  const existing = await loadAreaMember(supabase, memberId, profile.area_id);
  if (!existing) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  const firstName = cleanText(input.firstName ?? existing.first_name, 100);
  const middleName = cleanText(input.middleName ?? existing.middle_name, 100) || null;
  const lastName = cleanText(input.lastName ?? existing.last_name, 100);
  const email = normalizeEmail(input.email ?? existing.email);
  const contactNumber = cleanText(input.contactNumber ?? existing.contact_number, 50) || null;
  const address = cleanText(input.address ?? existing.address, 1000) || null;
  const birthDate = input.birthDate ?? existing.birth_date ?? null;
  const firstAttendedYouthCamp = input.firstAttendedYouthCamp ?? existing.first_attended_youth_camp ?? null;
  const status = String(input.status ?? existing.status) === 'Inactive' ? 'Inactive' : 'Active';
  const requestedRole = String(input.accessLevel ?? existing.access_level ?? 'member').trim().toLowerCase();
  const accessLevel = ACCESS_LEVELS.has(requestedRole) ? requestedRole : 'member';
  const chapterId = input.chapterId || null;

  if (!firstName || !lastName) {
    return sendJson(res, 400, { ok: false, error: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { ok: false, error: 'A valid email address is required.' });
  }
  if (accessLevel === 'chapter_servant' && !chapterId) {
    return sendJson(res, 400, { ok: false, error: 'A Chapter Servant must be assigned to a chapter.' });
  }

  await validateChapter(supabase, chapterId, profile.area_id);

  const { data: duplicate, error: duplicateError } = await supabase
    .from('members')
    .select('id')
    .eq('email', email)
    .neq('id', memberId)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return sendJson(res, 409, { ok: false, error: 'Another member already uses that email address.' });

  const { data: linkedProfile, error: linkedProfileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle();
  if (linkedProfileError) throw linkedProfileError;

  if (
    linkedProfile?.area_id &&
    String(linkedProfile.area_id) !== String(profile.area_id)
  ) {
    return sendJson(res, 409, {
      ok: false,
      error: 'The linked login account belongs to another Area. No changes were made.'
    });
  }

  const memberUpdate = {
    chapter_id: chapterId,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    birth_date: birthDate,
    contact_number: contactNumber,
    email,
    address,
    status,
    first_attended_youth_camp: firstAttendedYouthCamp,
    access_level: accessLevel
  };

  let updated = null;
  let account = null;

  if (linkedProfile?.id) {
    // Keep the Auth user, profile and Member row consistent. Auth is updated
    // first so duplicate-email errors happen before any database mutation.
    const { data: authSnapshotData, error: authSnapshotError } = await supabase.auth.admin.getUserById(linkedProfile.id);
    if (authSnapshotError || !authSnapshotData?.user) {
      throw authSnapshotError || new Error('Unable to load the linked login account before updating this Member.');
    }

    const authSnapshot = authSnapshotData.user;
    let authUpdated = false;
    let profileUpdated = false;
    let memberUpdated = false;

    try {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(linkedProfile.id, {
        email,
        email_confirm: true,
        user_metadata: {
          ...(authSnapshot.user_metadata || {}),
          display_name: [firstName, middleName, lastName].filter(Boolean).join(' '),
          requested_role: accessLevel
        }
      });
      if (authUpdateError) throw authUpdateError;
      authUpdated = true;

      const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update({
          role: accessLevel,
          area_id: profile.area_id,
          chapter_id: chapterId,
          is_active: status !== 'Inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', linkedProfile.id);
      if (profileUpdateError) throw profileUpdateError;
      profileUpdated = true;

      const { data: memberRow, error: updateError } = await supabase
        .from('members')
        .update(memberUpdate)
        .eq('id', memberId)
        .eq('area_id', profile.area_id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      memberUpdated = true;
      updated = memberRow;

      account = {
        provisioned: true,
        email,
        role: accessLevel,
        existingAccount: true,
        setupEmailSent: false,
        mustChangePassword: linkedProfile.must_change_password === true,
        passwordRequired: true
      };
    } catch (error) {
      // Best-effort compensation. Preserve the original failure while restoring
      // any earlier mutation in reverse order.
      if (memberUpdated) {
        try {
          await supabase
            .from('members')
            .update({
              chapter_id: existing.chapter_id || null,
              first_name: existing.first_name,
              middle_name: existing.middle_name || null,
              last_name: existing.last_name,
              birth_date: existing.birth_date || null,
              contact_number: existing.contact_number || null,
              email: existing.email,
              address: existing.address || null,
              status: existing.status,
              first_attended_youth_camp: existing.first_attended_youth_camp || null,
              access_level: existing.access_level
            })
            .eq('id', memberId)
            .eq('area_id', profile.area_id);
        } catch (rollbackError) {
          console.error('Member rollback failed:', rollbackError);
        }
      }

      if (profileUpdated) {
        try {
          await supabase
            .from('profiles')
            .update({
              member_id: linkedProfile.member_id || null,
              role: linkedProfile.role,
              area_id: linkedProfile.area_id || null,
              chapter_id: linkedProfile.chapter_id || null,
              must_change_password: linkedProfile.must_change_password === true,
              is_active: linkedProfile.is_active !== false,
              updated_at: new Date().toISOString()
            })
            .eq('id', linkedProfile.id);
        } catch (rollbackError) {
          console.error('Profile rollback failed:', rollbackError);
        }
      }

      if (authUpdated) {
        try {
          await supabase.auth.admin.updateUserById(linkedProfile.id, {
            email: authSnapshot.email,
            email_confirm: true,
            user_metadata: authSnapshot.user_metadata || {}
          });
        } catch (rollbackError) {
          console.error('Auth rollback failed:', rollbackError);
        }
      }

      throw error;
    }
  } else {
    // No login account exists yet. Update the Member first, then provision only
    // if an elevated role was requested. If provisioning fails, restore the
    // original Member row so role/account state does not diverge.
    const { data: memberRow, error: updateError } = await supabase
      .from('members')
      .update(memberUpdate)
      .eq('id', memberId)
      .eq('area_id', profile.area_id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    updated = memberRow;

    if (accessLevel !== 'member') {
      try {
        const provisioned = await ensureMemberAuthAccount({
          supabase,
          member: updated,
          role: accessLevel,
          requirePasswordSetup: true
        });

        let setupEmailSent = false;
        try {
          if (status !== 'Inactive') {
            await sendPasswordSetupEmail(req, email);
            setupEmailSent = true;
          }
        } catch {
          // The account itself remains valid; Members → Access can resend the link.
        }

        account = {
          provisioned: true,
          email,
          role: accessLevel,
          existingAccount: !provisioned.createdAccount,
          setupEmailSent,
          mustChangePassword: true,
          passwordRequired: true,
          onboardingMethod: 'admin_password_setup'
        };
      } catch (error) {
        try {
          await supabase
            .from('members')
            .update({
              chapter_id: existing.chapter_id || null,
              first_name: existing.first_name,
              middle_name: existing.middle_name || null,
              last_name: existing.last_name,
              birth_date: existing.birth_date || null,
              contact_number: existing.contact_number || null,
              email: existing.email,
              address: existing.address || null,
              status: existing.status,
              first_attended_youth_camp: existing.first_attended_youth_camp || null,
              access_level: existing.access_level
            })
            .eq('id', memberId)
            .eq('area_id', profile.area_id);
        } catch (rollbackError) {
          console.error('Member rollback after provisioning failure failed:', rollbackError);
        }
        throw error;
      }
    } else {
      account = {
        provisioned: false,
        email,
        role: 'member',
        setupEmailSent: false,
        passwordRequired: false,
        onboardingMethod: 'none'
      };
    }
  }

  return sendJson(res, 200, {
    ok: true,
    member: updated,
    account,
    message: account?.setupEmailSent
      ? 'Member updated and Servant Leader account setup email sent.'
      : 'Member updated.'
  });
}

async function deleteMember(req, res) {
  const { supabase, profile } = await requireAuthenticatedProfile(req);
  if (!isSuperAdminRole(profile.role)) {
    return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can delete member records.' });
  }

  const memberId = req.query?.id || req.body?.id;
  if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

  const member = await loadAreaMember(supabase, memberId, profile.area_id);
  if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

  // A signed-in leader must never be able to remove their own member record
  // through the Members management endpoint. Full self-deletion is handled
  // separately by /api/auth/account so it is an explicit account action.
  if (String(profile.member_id || '') === String(memberId)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'You cannot delete your own member record from the Members tab. Use Delete Account if you intend to permanently remove your account.'
    });
  }

  const { data: linkedProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('member_id', memberId)
    .maybeSingle();
  if (profileError) throw profileError;

  // Defense in depth for legacy profiles whose member_id may not have been
  // hydrated yet: never delete the profile/auth user making this request.
  if (linkedProfile?.id && String(linkedProfile.id) === String(profile.id)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'You cannot delete your own member record from the Members tab. Use Delete Account if you intend to permanently remove your account.'
    });
  }

  // Delete the Member first. This transactionally cascades profile/member
  // dependent rows in Postgres. If the database delete fails, the login account
  // remains untouched. The Auth user is removed only after the data delete has
  // succeeded, avoiding an inaccessible orphaned Member record.
  const { error: memberDeleteError } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
    .eq('area_id', profile.area_id);
  if (memberDeleteError) throw memberDeleteError;

  let deletedAuthUser = !linkedProfile?.id;
  let authCleanupPending = false;

  if (linkedProfile?.id) {
    // Retry once for a transient Auth Admin failure. If both attempts fail, the
    // remaining Auth user has no profile and therefore cannot enter the app;
    // a later account provision with the same email can safely reclaim it.
    let authDeleteError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await supabase.auth.admin.deleteUser(linkedProfile.id);
      authDeleteError = result?.error || null;
      if (!authDeleteError) {
        deletedAuthUser = true;
        break;
      }
    }

    if (!deletedAuthUser) {
      authCleanupPending = true;
      console.error('Member deleted but Auth user cleanup failed:', authDeleteError);
    }
  }

  return sendJson(res, 200, {
    ok: true,
    deleted: true,
    deletedAuthUser,
    authCleanupPending,
    memberId,
    ...(authCleanupPending
      ? { warning: 'Member data was deleted, but final login-account cleanup is pending. The leftover Auth user cannot access protected app data because its profile was removed.' }
      : {})
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await listMembers(req, res);
    if (req.method === 'POST') return await createMember(req, res);
    if (req.method === 'PATCH') return await updateMember(req, res);
    if (req.method === 'DELETE') return await deleteMember(req, res);
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (error) {
    return apiError(res, error);
  }
}
