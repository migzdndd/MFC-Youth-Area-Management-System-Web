import { normalizeEmail } from './http.js';

const LEADERSHIP_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

// Couple Coordinators keep management access but are intentionally not
// represented in the Area Members roster. All other Servant Leader accounts
// are linked to public.members after Area onboarding.
const MEMBER_BACKED_ADMIN_ROLES = new Set([
  'area_servant',
  'lit_servant',
  'chapter_servant'
]);

function cleanText(value, max = 160) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function splitDisplayName(displayName, email) {
  const safeName = cleanText(displayName, 240) || cleanText(String(email || '').split('@')[0], 120) || 'Member';
  const parts = safeName.split(' ').filter(Boolean);

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleName: null,
      lastName: parts[0]
    };
  }

  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    lastName: parts[parts.length - 1]
  };
}

function leadershipRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return LEADERSHIP_ROLES.has(normalized) ? normalized : null;
}

function shouldCreateMemberRecord(role) {
  return MEMBER_BACKED_ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
}

function memberLinkError(message, statusCode = 409, code = 'MEMBER_LINK_FAILED') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/**
 * Ensures that an authenticated leadership profile is also represented in
 * public.members and that profiles.member_id points to that member.
 *
 * Area assignment is required by public.members, so this is intentionally
 * completed during Area onboarding rather than before the user chooses an Area.
 */
export async function ensureLeadershipMemberRecord({
  supabase,
  user,
  profile,
  areaId,
  chapterId
}) {
  const role = leadershipRole(profile?.role);
  if (!role) {
    return { profile, member: null, created: false, linkedExisting: false };
  }

  const targetAreaId = String(areaId || profile?.area_id || '').trim();
  const targetChapterId = chapterId !== undefined
    ? (chapterId || null)
    : (profile?.chapter_id || null);

  if (!targetAreaId) {
    return { profile, member: null, created: false, linkedExisting: false };
  }

  // Couple Coordinators are management-only accounts. Persist their Area
  // selection in profiles, but do not create a Members-roster entry for them.
  if (!shouldCreateMemberRecord(role)) {
    const profileUpdates = { area_id: targetAreaId };
    if (targetChapterId) profileUpdates.chapter_id = targetChapterId;

    const { data: updatedProfile, error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', profile.id)
      .select('*')
      .single();
    if (profileUpdateError) throw profileUpdateError;

    return {
      profile: updatedProfile,
      member: null,
      created: false,
      linkedExisting: false
    };
  }

  // If the profile is already linked, keep both the member row and profile
  // synchronized. Roll the member back if the profile update unexpectedly fails.
  if (profile?.member_id) {
    const { data: existingLinkedMember, error: linkedError } = await supabase
      .from('members')
      .select('*')
      .eq('id', profile.member_id)
      .maybeSingle();
    if (linkedError) throw linkedError;

    if (existingLinkedMember) {
      const updates = {
        area_id: targetAreaId,
        chapter_id: targetChapterId,
        access_level: role,
        status: profile.is_active === false ? 'Inactive' : 'Active'
      };

      const { data: updatedMember, error: memberUpdateError } = await supabase
        .from('members')
        .update(updates)
        .eq('id', existingLinkedMember.id)
        .select('*')
        .single();
      if (memberUpdateError) throw memberUpdateError;

      try {
        const { data: updatedProfile, error: profileUpdateError } = await supabase
          .from('profiles')
          .update({
            area_id: targetAreaId,
            chapter_id: targetChapterId,
            member_id: updatedMember.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', profile.id)
          .select('*')
          .single();
        if (profileUpdateError) throw profileUpdateError;

        return {
          profile: updatedProfile,
          member: updatedMember,
          created: false,
          linkedExisting: false
        };
      } catch (error) {
        try {
          await supabase
            .from('members')
            .update({
              area_id: existingLinkedMember.area_id,
              chapter_id: existingLinkedMember.chapter_id || null,
              access_level: existingLinkedMember.access_level,
              status: existingLinkedMember.status
            })
            .eq('id', existingLinkedMember.id);
        } catch (rollbackError) {
          console.error('Linked Member rollback failed:', rollbackError);
        }
        throw error;
      }
    }
  }

  const email = normalizeEmail(user?.email);
  if (!email) {
    throw memberLinkError('This account does not have a valid email address.', 400, 'MEMBER_EMAIL_REQUIRED');
  }

  // Reuse an existing member row when the same person was already encoded
  // manually by leadership before their account was created.
  const { data: existingMember, error: existingMemberError } = await supabase
    .from('members')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (existingMemberError) throw existingMemberError;

  if (existingMember) {
    if (String(existingMember.area_id) !== targetAreaId) {
      throw memberLinkError(
        'A member with this email already belongs to another Area. Ask a system administrator to review the account.',
        409,
        'MEMBER_AREA_CONFLICT'
      );
    }

    const { data: otherProfile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('id')
      .eq('member_id', existingMember.id)
      .neq('id', profile.id)
      .maybeSingle();
    if (profileLookupError) throw profileLookupError;
    if (otherProfile) {
      throw memberLinkError(
        'This member record is already linked to another account.',
        409,
        'MEMBER_ALREADY_LINKED'
      );
    }

    const memberUpdates = {
      chapter_id: targetChapterId,
      access_level: role,
      status: profile.is_active === false ? 'Inactive' : 'Active'
    };

    const { data: updatedMember, error: memberUpdateError } = await supabase
      .from('members')
      .update(memberUpdates)
      .eq('id', existingMember.id)
      .select('*')
      .single();
    if (memberUpdateError) throw memberUpdateError;

    try {
      const { data: updatedProfile, error: profileUpdateError } = await supabase
        .from('profiles')
        .update({
          member_id: updatedMember.id,
          area_id: targetAreaId,
          chapter_id: targetChapterId,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id)
        .select('*')
        .single();
      if (profileUpdateError) throw profileUpdateError;

      return {
        profile: updatedProfile,
        member: updatedMember,
        created: false,
        linkedExisting: true
      };
    } catch (error) {
      try {
        await supabase
          .from('members')
          .update({
            chapter_id: existingMember.chapter_id || null,
            access_level: existingMember.access_level,
            status: existingMember.status
          })
          .eq('id', existingMember.id);
      } catch (rollbackError) {
        console.error('Existing Member rollback failed:', rollbackError);
      }
      throw error;
    }
  }

  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
  const { firstName, middleName, lastName } = splitDisplayName(displayName, email);

  let createdMember = null;
  try {
    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({
        area_id: targetAreaId,
        chapter_id: targetChapterId,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        email,
        status: profile.is_active === false ? 'Inactive' : 'Active',
        access_level: role,
        created_by: user.id
      })
      .select('*')
      .single();

    if (memberError) throw memberError;
    createdMember = member;

    const profileUpdates = {
      member_id: member.id,
      area_id: targetAreaId
    };
    if (targetChapterId) profileUpdates.chapter_id = targetChapterId;

    const { data: updatedProfile, error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', profile.id)
      .select('*')
      .single();

    if (profileUpdateError) throw profileUpdateError;

    return {
      profile: updatedProfile,
      member,
      created: true,
      linkedExisting: false
    };
  } catch (error) {
    if (createdMember?.id) {
      try {
        await supabase.from('members').delete().eq('id', createdMember.id);
      } catch {
        // Preserve the original error.
      }
    }
    throw error;
  }
}
