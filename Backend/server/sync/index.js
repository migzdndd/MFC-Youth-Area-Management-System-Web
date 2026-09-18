import { requireAuthenticatedProfile, isAreaAdminRole, isChapterServantRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { requireArea } from '../_lib/cloud-data.js';
import { ensureStandardServices } from '../_lib/service-catalog.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { supabase, profile } = await requireAuthenticatedProfile(req);
    const areaId = requireArea(req, profile);
    await ensureStandardServices(supabase, areaId);

    let chaptersQuery = supabase.from('chapters').select('id, area_id, name, is_active, created_at, updated_at').eq('area_id', areaId).eq('is_active', true).order('name');
    let reportsQuery = supabase.from('activity_reports').select('id, area_id, chapter_id, prepared_by_member_id, prepared_by_name, chapter_name_snapshot, report_type, activity_date, title, activity, participant_count, location, event_id, notes, created_at, updated_at').eq('area_id', areaId).order('activity_date', { ascending: false });
    let gigQuery = supabase.from('gig_contributions').select('id, area_id, chapter_id, member_id, amount, contribution_date, notes, created_at').eq('area_id', areaId).order('contribution_date', { ascending: false });

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
    } else if (!isAreaAdminRole(profile.role)) {
      chaptersQuery = profile.chapter_id
        ? chaptersQuery.eq('id', profile.chapter_id)
        : chaptersQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      reportsQuery = reportsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      gigQuery = profile.member_id
        ? gigQuery.eq('member_id', profile.member_id)
        : gigQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
    }

    let membersQuery = supabase.from('members').select('id, area_id, chapter_id, status').eq('area_id', areaId);
    if (isChapterServantRole(profile.role)) {
      membersQuery = profile.chapter_id
        ? membersQuery.eq('chapter_id', profile.chapter_id)
        : membersQuery.eq('id', profile.member_id || '00000000-0000-0000-0000-000000000000');
    } else if (!isAreaAdminRole(profile.role)) {
      membersQuery = membersQuery.eq('id', profile.member_id || '00000000-0000-0000-0000-000000000000');
    }

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

    const scopedMemberIds = (membersResult.data || []).map(item => item.id);
    const scopedMemberIdSet = new Set(scopedMemberIds.map(String));
    const serviceIds = (servicesResult.data || []).map(item => item.id);
    let serviceLinks = [];
    if (serviceIds.length && scopedMemberIds.length) {
      const serviceLinksResult = await supabase
        .from('member_services')
        .select('member_id, service_id')
        .in('service_id', serviceIds);
      if (serviceLinksResult.error) throw serviceLinksResult.error;
      serviceLinks = (serviceLinksResult.data || []).filter(link => scopedMemberIdSet.has(String(link.member_id)));
    }

    const eventIds = (eventsResult.data || []).map(item => item.id);
    let participants = [];
    if (eventIds.length) {
      let participantQuery = supabase
        .from('event_participants')
        .select('id, event_id, member_id, mode_of_payment, payment_status, attended, registered_at, updated_at')
        .in('event_id', eventIds)
        .order('registered_at', { ascending: false });
      if (!isAreaAdminRole(profile.role)) {
        if (!scopedMemberIds.length) {
          participantQuery = participantQuery.eq('member_id', '00000000-0000-0000-0000-000000000000');
        } else {
          participantQuery = participantQuery.in('member_id', scopedMemberIds);
        }
      }
      const participantResult = await participantQuery;
      if (participantResult.error) throw participantResult.error;
      participants = participantResult.data || [];
    }

    const dashboard = {
      members: membersResult.data?.length || 0,
      activeMembers: (membersResult.data || []).filter(item => item.status === 'Active').length,
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
      chapters: chaptersResult.data || [],
      services: servicesResult.data || [],
      memberServices: serviceLinks,
      events: eventsResult.data || [],
      participants,
      reports: reportsResult.data || [],
      gig: gigResult.data || [],
      dashboard
    });
  } catch (error) {
    return apiError(res, error);
  }
}
