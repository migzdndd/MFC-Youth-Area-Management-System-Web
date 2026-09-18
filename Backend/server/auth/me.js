import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { ensureLeadershipMemberRecord } from '../_lib/member-link.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const { user, profile: authenticatedProfile, supabase } = await requireAuthenticatedProfile(req);
    let profile = authenticatedProfile;
    let member = null;

    // Repair older leadership accounts that were created before admin
    // registration was linked to public.members.
    if (!profile.member_id && profile.area_id) {
      const memberLink = await ensureLeadershipMemberRecord({
        supabase,
        user,
        profile,
        areaId: profile.area_id,
        chapterId: profile.chapter_id
      });
      profile = memberLink.profile;
      member = memberLink.member;
    }

    if (!member && profile.member_id) {
      const { data, error } = await supabase
        .from('members')
        .select('id, first_name, middle_name, last_name, email, status, area_id, chapter_id, first_attended_youth_camp, access_level')
        .eq('id', profile.member_id)
        .maybeSingle();
      if (error) throw error;
      member = data;
    }

    // Supabase Auth is authoritative for the signed-in email address. After a
    // secure email-change confirmation completes, repair public.members on the
    // next authenticated account fetch. A sync failure must not roll Auth back.
    const authEmail = String(user.email || '').trim().toLowerCase();
    const memberEmail = String(member?.email || '').trim().toLowerCase();
    if (member?.id && authEmail && authEmail !== memberEmail) {
      const { error: emailSyncError } = await supabase
        .from('members')
        .update({ email: authEmail, updated_at: new Date().toISOString() })
        .eq('id', member.id);

      if (emailSyncError) {
        console.error(JSON.stringify({
          event: 'AUTH_EMAIL_MEMBER_SYNC',
          auth_user_id: user.id,
          target_member_id: member.id,
          timestamp: new Date().toISOString(),
          status: 'FAILURE',
          error_code: 'MEMBER_EMAIL_SYNC_FAILED'
        }));
      } else {
        member = { ...member, email: authEmail };
      }
    }

    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        memberId: profile.member_id,
        role: profile.role,
        areaId: profile.area_id,
        chapterId: profile.chapter_id,
        mustChangePassword: profile.must_change_password
      },
      member
    });
  } catch (error) {
    return apiError(res, error);
  }
}
