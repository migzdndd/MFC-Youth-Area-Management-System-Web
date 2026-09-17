import { requireAuthenticatedProfile, isSuperAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { requireArea } from '../_lib/cloud-data.js';

const EMPTY_RESULT = Object.freeze({ data: [], error: null });

function normalizedName(user) {
  return String(
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    ''
  ).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const { supabase, profile, user } = await requireAuthenticatedProfile(req);
    const areaId = requireArea(profile);

    let chaptersQuery = supabase
      .from('chapters')
      .select('id, area_id, name, is_active, created_at, updated_at')
      .eq('area_id', areaId)
      .eq('is_active', true)
      .order('name');

    let reportsQuery = supabase
      .from('activity_reports')
      .select('id, area_id, chapter_id, prepared_by_member_id, prepared_by_name, chapter_name_snapshot, report_type, activity_date, title, activity, participant_count, location, event_id, notes, created_at, updated_at')
      .eq('area_id', areaId)
      .order('activity_date', { ascending: false });

    let gigQuery = supabase
      .from('gig_contributions')
      .select('id, area_id, chapter_id, member_id, amount, contribution_date, notes, created_at')
      .eq('area_id', areaId)
      .order('contribution_date', { ascending: false });

    if (isChapterServantRole(profile.role)) {
      if (profile.chapter_id) {
        chaptersQuery = chaptersQuery.eq('id', profile.chapter_id);
        reportsQuery = reportsQuery.eq('chapter_id', profile.chapter_id);
        gigQuery = gigQuery.eq('chapter_id', profile.chapter_id);
      } else {
        chaptersQuery = chaptersQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        reportsQuery = reportsQuery.eq('chapter_id', '00000000-0000-0000-0000-000000000000');
        gigQuery = gigQuery.eq('chapter_id', '00000000-0000-0000-0000-000000000000');
      }
    } else if (!isSuperAdminRole(profile.role)) {
      chaptersQuery = profile.chapter_id
        ? chaptersQuery.eq('id', profile.chapter_id)
        : chaptersQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      reportsQuery = reportsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      gigQuery = profile.member_id
        ? gigQuery.eq('member_id', profile.member_id)
        : gigQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
    }

    // One unified sync request now includes complete Member records. This removes
    // the old extra /api/members round trip during every page bootstrap.
    let membersQuery = supabase
      .from('members')
      .select('id, area_id, chapter_id, first_name, middle_name, last_name, birth_date, contact_number, email, address, status, first_attended_youth_camp, access_level, created_at, updated_at')
      .eq('area_id', areaId)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (isChapterServantRole(profile.role)) {
      membersQuery = profile.chapter_id
        ? membersQuery.eq('chapter_id', profile.chapter_id)
        : membersQuery.eq('id', profile.member_id || '00000000-0000-0000-0000-000000000000');
    } else if (!isSuperAdminRole(profile.role)) {
      membersQuery = membersQuery.eq('id', profile.member_id || '00000000-0000-0000-0000-000000000000');
    }

    // Independent top-level reads run concurrently.
    const [chaptersResult, servicesResult, membersResult, eventsResult, reportsResult, gigResult] = await Promise.all([
      chaptersQuery,
      supabase.from('services').select('id, area_id, name, is_active').eq('area_id', areaId).eq('is_active', true).order('name'),
      membersQuery,
      supabase.from('events').select('id, area_id, name, description, venue, starts_at, ends_at, fee, manual_attendance, created_at, updated_at').eq('area_id', areaId).order('starts_at', { ascending: false }),
      reportsQuery,
      gigQuery
    ]);

    for (const result of [chaptersResult, servicesResult, membersResult, eventsResult, reportsResult, gigResult]) {
      if (result.error) throw result.error;
    }

    const rawMembers = membersResult.data || [];
    const scopedMemberIds = rawMembers.map(item => item.id).filter(Boolean);
    const eventIds = (eventsResult.data || []).map(item => item.id).filter(Boolean);

    let participantQueryPromise = Promise.resolve(EMPTY_RESULT);
    if (eventIds.length) {
      let participantQuery = supabase
        .from('event_participants')
        .select('id, event_id, member_id, mode_of_payment, payment_status, attended, registered_at, updated_at')
        .in('event_id', eventIds)
        .order('registered_at', { ascending: false });

      if (!isSuperAdminRole(profile.role)) {
        participantQuery = scopedMemberIds.length
          ? participantQuery.in('member_id', scopedMemberIds)
          : participantQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
      }
      participantQueryPromise = participantQuery;
    }

    // Dependent reads are also concurrent instead of being performed one by one.
    const [profilesResult, serviceLinksResult, participantResult] = await Promise.all([
      scopedMemberIds.length
        ? supabase.from('profiles').select('member_id, role, is_active, must_change_password').in('member_id', scopedMemberIds)
        : Promise.resolve(EMPTY_RESULT),
      scopedMemberIds.length
        ? supabase.from('member_services').select('member_id, service_id').in('member_id', scopedMemberIds)
        : Promise.resolve(EMPTY_RESULT),
      participantQueryPromise
    ]);

    for (const result of [profilesResult, serviceLinksResult, participantResult]) {
      if (result.error) throw result.error;
    }

    const accountByMemberId = new Map();
    for (const account of profilesResult.data || []) {
      if (account.member_id) accountByMemberId.set(String(account.member_id), account);
    }

    const members = rawMembers.map(member => {
      const account = accountByMemberId.get(String(member.id)) || null;
      return {
        ...member,
        account_provisioned: Boolean(account),
        account_active: account ? account.is_active !== false : false,
        account_role: account?.role || null,
        account_setup_required: account?.must_change_password === true
      };
    });

    const participants = participantResult.data || [];
    const dashboard = {
      members: members.length,
      activeMembers: members.filter(item => item.status === 'Active').length,
      chapters: chaptersResult.data?.length || 0,
      services: servicesResult.data?.length || 0,
      events: eventsResult.data?.length || 0,
      reports: reportsResult.data?.length || 0,
      registrations: participants.length,
      attended: participants.filter(item => item.attended).length,
      gigTotal: (gigResult.data || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    };

    return sendJson(res, 200, {
      ok: true,
      areaId,
      user: {
        id: user.id,
        memberId: profile.member_id || null,
        email: user.email || '',
        name: normalizedName(user),
        role: profile.role,
        areaId: profile.area_id || null,
        chapterId: profile.chapter_id || null,
        mustChangePassword: profile.must_change_password === true
      },
      members,
      chapters: chaptersResult.data || [],
      services: servicesResult.data || [],
      memberServices: serviceLinksResult.data || [],
      events: eventsResult.data || [],
      participants,
      reports: reportsResult.data || [],
      gig: gigResult.data || [],
      dashboard,
      syncedAt: Date.now()
    });
  } catch (error) {
    return apiError(res, error);
  }
}
