/**
 * ============================================================================
 * MFC Youth Member Portal Client Application
 * ============================================================================
 * Purpose:
 * Provides the member-facing portal for MFC Youth members.
 * Displays member profile details, assigned chapter, and ministries/services.
 * Lists upcoming and recent events with personal registration/attendance status.
 * Synchronizes cloud data (Supabase backend) with localStorage for offline/fast UI.
 * Supports administrative "Preview Mode" allowing area leaders to view the portal.
 * ============================================================================
 */

// 1. Storage Keys & Standard Services
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';
const USER_KEY = 'mfc_demo_users';

const STANDARD_SERVICES = [
  'Unit Servant',
  'Household Servant',
  'Chapter Servant',
  'Area Servant',
  'Area LIT Servant',
  'Campus Servant',
  'Area Kids Servant',
  'MFC High Servant'
];

/** Mapping of access level roles to default community services */
const ACCESS_ROLE_SERVICE_MAP = Object.freeze({
  area_servant: 'Area Servant',
  lit_servant: 'Area LIT Servant',
  campus_servant: 'Campus Servant',
  mfc_high_servant: 'MFC High Servant',
  area_kids_servant: 'Area Kids Servant',
  chapter_servant: 'Chapter Servant'
});

// 2. Service Normalization & Role Inference

/** Normalizes service title strings to canonical display names */
function normalizePortalServiceName(value) {
  const service = String(value || '').trim().replace(/\s+/g, ' ');
  if (!service) return '';
  const key = service.toLowerCase();
  if (key === 'lit servant' || key === 'lit_servant') return 'Area LIT Servant';
  if (key === 'kids servant' || key === 'area_kids_servant') return 'Area Kids Servant';
  return service;
}

/** Resolves explicit services assigned to a member, or infers one from access level */
function detectedPortalServices(member) {
  const explicit = Array.isArray(member?.services)
    ? [...new Set(member.services.map(normalizePortalServiceName).filter(Boolean))]
    : [];
  if (explicit.length) return [explicit[0]];
  const role = String(member?.accessLevel || 'member').trim().toLowerCase();
  const inferred = ACCESS_ROLE_SERVICE_MAP[role];
  return inferred ? [inferred] : [];
}

// 3. General Utilities: Safe JSON, Session, Sanitization & Date Formatting

/** Safely parses JSON strings with a fallback return value */
function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Retrieves the active user session from localStorage or sessionStorage */
function getSession() {
  return (
    safeParse(localStorage.getItem(SESSION_KEY), null) ||
    safeParse(sessionStorage.getItem(SESSION_KEY), null)
  );
}

/** Escapes special HTML characters to prevent XSS injection */
function esc(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );
}

/** Formats ISO dates or YYYY-MM-DD strings into localized Philippine dates */
function fmtDate(value) {
  if (!value) return '—';

  const d = new Date(
    String(value).length === 10
      ? `${value}T00:00:00`
      : value
  );

  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
}

/** Formats dates with both date and time components */
function fmtDateTime(value) {
  if (!value) return '—';

  const d = new Date(value);

  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
}

/** Combines first, middle, and last names into a clean full name */
function fullName(member) {
  return [
    member?.firstName,
    member?.middleName,
    member?.lastName
  ].filter(Boolean).join(' ');
}

// 4. Event Card & Registration UI Helpers

/** Looks up registration status for a given member and event */
function eventRegistration(participants, memberId, eventId) {
  return participants.find(
    participant =>
      String(participant.memberId) === String(memberId) &&
      String(participant.eventId) === String(eventId)
  ) || null;
}

/** Generates HTML markup for an event card (Upcoming or Past) */
function eventCard(event, registration, timing) {
  const status = registration
    ? (
        registration.attended
          ? 'Attended'
          : 'Registered'
      )
    : 'Not Registered';

  const badgeClass = registration?.attended
    ? 'active'
    : registration
      ? 'pending'
      : 'inactive';

  return `
    <article class="member-event-card">
      <div class="member-event-date">
        <span>${esc(new Date(event.date).toLocaleDateString('en-PH', { month: 'short' }).toUpperCase())}</span>
        <strong>${esc(new Date(event.date).toLocaleDateString('en-PH', { day: '2-digit' }))}</strong>
      </div>

      <div class="member-event-copy">
        <div class="member-event-copy-head">
          <div>
            <span class="member-eyebrow">${timing === 'past' ? 'RECENT EVENT' : 'UPCOMING EVENT'}</span>
            <h3>${esc(event.name || 'MFC Youth Event')}</h3>
          </div>

          <span class="badge ${badgeClass}">${esc(status)}</span>
        </div>

        <p>
          ${esc(fmtDateTime(event.date))}
          ${event.venue ? ` · ${esc(event.venue)}` : ''}
        </p>

        ${event.description
          ? `<div class="member-event-description">${esc(event.description)}</div>`
          : ''
        }
      </div>
    </article>
  `;
}

// Global session initialization & admin preview check
const session = getSession();
const previewMode = Boolean(
  session &&
  session.role !== 'member' &&
  new URLSearchParams(window.location.search).get('preview') === '1'
);

// 5. Cloud Data Synchronization (Backend API → Local Cache)

/** Makes an authenticated GET request to the backend with timeout */
async function portalBackendApi(path) {
  const token = session?.accessToken || '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const body = await response.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));
    if (!response.ok) throw new Error(body?.error || 'Request failed.');
    return body;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Maps a backend member database record to client schema format */
function portalCloudMember(member, previous = {}) {
  return {
    ...previous,
    id: member.id,
    areaId: member.area_id || null,
    chapterId: member.chapter_id || null,
    firstName: member.first_name || '',
    middleName: member.middle_name || '',
    lastName: member.last_name || '',
    birthDate: member.birth_date || '',
    contact: member.contact_number || '',
    email: String(member.email || '').trim().toLowerCase(),
    address: member.address || '',
    status: member.status || 'Active',
    firstAttendedYouthCamp: member.first_attended_youth_camp || '',
    accessLevel: member.access_level || 'member',
    services: Array.isArray(previous.services) ? previous.services : [],
    chapterName: previous.chapterName || '',
    cloudBacked: true
  };
}

/** Synchronizes the current area's cloud state (members, events, services) to local cache */
async function syncMemberPortalCloudCache() {
  if (!session?.backendAuth || session?.demo || !session?.areaId) return;

  const [membersPayload, syncPayload] = await Promise.all([
    portalBackendApi('/api/members'),
    portalBackendApi('/api/sync')
  ]);

  const data = safeParse(localStorage.getItem(DB_KEY) || '{}', {});
  const previousMembers = Array.isArray(data.members) ? data.members : [];
  const cloudMembers = Array.isArray(membersPayload?.members) ? membersPayload.members : [];
  const chapters = Array.isArray(syncPayload?.chapters) ? syncPayload.chapters : [];
  const services = Array.isArray(syncPayload?.services) ? syncPayload.services : [];
  const serviceLinks = Array.isArray(syncPayload?.memberServices) ? syncPayload.memberServices : [];
  const chapterNameById = new Map(chapters.map(row => [String(row.id), row.name]));
  const serviceNameById = new Map(services.map(row => [String(row.id), normalizePortalServiceName(row.name)]));
  const servicesByMember = new Map();

  // Group services per member
  serviceLinks.forEach(link => {
    const memberId = String(link.member_id || '');
    const name = serviceNameById.get(String(link.service_id || ''));
    if (!memberId || !name) return;
    if (!servicesByMember.has(memberId)) servicesByMember.set(memberId, []);
    servicesByMember.get(memberId).push(name);
  });

  // Reconcile member list with chapter and service relations
  data.members = cloudMembers.map(row => {
    const previous = previousMembers.find(item => String(item.id) === String(row.id)) || {};
    const member = portalCloudMember(row, previous);
    member.chapterName = member.chapterId ? (chapterNameById.get(String(member.chapterId)) || '') : '';
    member.services = servicesByMember.get(String(member.id)) || [];
    member.services = detectedPortalServices(member);
    return member;
  });

  data.chapters = chapters.map(row => ({ id: row.id, name: row.name, areaId: row.area_id, cloudBacked: true }));
  data.services = [...new Set([
    ...STANDARD_SERVICES,
    ...services.map(row => normalizePortalServiceName(row.name)).filter(Boolean)
  ])];
  data.events = (Array.isArray(syncPayload?.events) ? syncPayload.events : []).map(row => {
    let localDateTime = '';
    if (row.starts_at) {
      const date = new Date(row.starts_at);
      if (!Number.isNaN(date.getTime())) {
        localDateTime = new Date(date.getTime() + (8 * 60 * 60 * 1000)).toISOString().slice(0, 16);
      }
    }
    return {
      id: row.id,
      name: row.name || '',
      date: localDateTime,
      venue: row.venue || '',
      fee: Number(row.fee || 0),
      peopleAttended: Number(row.manual_attendance || 0),
      description: row.description || '',
      cloudBacked: true
    };
  });
  data.participants = (Array.isArray(syncPayload?.participants) ? syncPayload.participants : []).map(row => ({
    id: row.id,
    eventId: row.event_id,
    memberId: row.member_id,
    paymentMode: row.mode_of_payment || 'Cash',
    paymentStatus: row.payment_status || 'Unpaid',
    attended: Boolean(row.attended),
    cloudBacked: true
  }));

  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

// 6. Preview Mode Mock Generator
// Creates a temporary synthetic member object when an admin previews this page.
function previewMemberFromSession(currentSession) {
  const name = String(currentSession?.name || currentSession?.email || 'Area Servant').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    id: currentSession?.memberId || `preview-${currentSession?.userId || 'admin'}`,
    firstName: parts[0] || 'Area',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : 'Servant',
    email: currentSession?.email || 'preview@mfcyouth.local',
    chapterName: 'Member View Preview',
    contact: '',
    firstAttendedYouthCamp: '',
    services: []
  };
}

// 7. Member Portal Initialization & Rendering Flow
async function bootstrapMemberPortal() {
  try {
    await syncMemberPortalCloudCache();
  } catch (error) {
    console.warn('Member Portal cloud sync skipped:', error?.message || error);
  }

  // Auth & role check: redirect if not logged in or if user must change password
  if (!session) {
    navigateWithLoader('/', true);
  } else if (session.mustChangePassword) {
    navigateWithLoader('/change-password', true);
  } else if (session.role !== 'member' && !previewMode) {
    navigateWithLoader(
      session.role === 'chapter_servant'
        ? '/chapters'
        : '/dashboard',
      true
    );
  } else {
    const data = safeParse(localStorage.getItem(DB_KEY) || '{}', {});
    const members = Array.isArray(data.members) ? data.members : [];
    const linkedMember = members.find(
      item => String(item.id) === String(session.memberId)
    ) || members.find(
      item => String(item.email || '').trim().toLowerCase() === String(session.email || '').trim().toLowerCase()
    );
    const member = linkedMember || (previewMode ? previewMemberFromSession(session) : null);

    const users = safeParse(localStorage.getItem(USER_KEY) || '[]', []);
    const account = Array.isArray(users)
      ? users.find(item => String(item.id) === String(session.userId))
      : null;

    // Validate account status
    if (
      !previewMode &&
      (
        !member ||
        (!session.backendAuth && !account) ||
        account?.isActive === false ||
        String(member?.status || 'Active') === 'Inactive'
      )
    ) {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      navigateWithLoader('/', true);
    } else if (member) {
      // In preview mode, add exit button to return to administration dashboard
      if (previewMode) {
        document.body.classList.add('member-preview-mode');
        const actions = document.querySelector('.member-portal-actions');
        if (actions) {
          actions.innerHTML = `
            <button class="btn" id="exitMemberPreview" type="button">Return to Admin Dashboard</button>
          `;
        }
      }

      // Filter upcoming vs. completed events
      const events = Array.isArray(data.events)
        ? data.events.filter(event => event && event.date)
        : [];

      const participants = Array.isArray(data.participants)
        ? data.participants
        : [];

      const now = Date.now();

      const allUpcomingEvents = events
        .filter(event => new Date(event.date).getTime() >= now)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      const allRecentEvents = events
        .filter(event => new Date(event.date).getTime() < now)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      const upcomingEvents = allUpcomingEvents.slice(0, 6);
      const recentEvents = allRecentEvents.slice(0, 6);

      const myRegistrations = participants.filter(
        participant => String(participant.memberId) === String(member.id)
      );

      const registeredUpcoming = allUpcomingEvents.filter(event =>
        Boolean(eventRegistration(participants, member.id, event.id))
      ).length;

      const attendedRecent = allRecentEvents
        .slice(0, 6)
        .filter(event =>
          eventRegistration(participants, member.id, event.id)?.attended
        ).length;

      // Render the complete member portal layout
      document.getElementById('memberPortalContent').innerHTML = `
        ${previewMode ? `
          <section class="member-preview-banner" role="status">
            <strong>Member Portal Preview</strong>
            <span>You are previewing the interface a regular Member sees. Your administrator session remains active.</span>
          </section>
        ` : ''}

        <section class="member-welcome-card" id="overview">
          <div class="member-welcome-copy">
            <span class="member-eyebrow">${previewMode ? 'MEMBER VIEW PREVIEW' : 'MEMBER ACCESS'}</span>
            <h1>Welcome, ${esc(member.firstName || fullName(member))}!</h1>
            <p>
              ${esc(member.chapterName || 'No Chapter Assigned')}
              ${member.services?.length ? ` · ${esc(member.services.join(', '))}` : ''}
            </p>
          </div>

          <div class="member-hero-badge">
            <span>Account</span>
            <strong>${previewMode ? 'Preview' : 'Member'}</strong>
          </div>
        </section>

        <section class="member-quick-grid" aria-label="Member dashboard summary">
          <article><span>Upcoming Events</span><strong>${allUpcomingEvents.length}</strong></article>
          <article><span>My Registrations</span><strong>${registeredUpcoming}</strong></article>
          <article><span>Recently Attended</span><strong>${attendedRecent}</strong></article>
          <article><span>Total Event Records</span><strong>${myRegistrations.length}</strong></article>
        </section>

        <section class="member-dashboard-section" id="upcoming">
          <div class="member-section-heading">
            <div><span class="member-eyebrow">WHAT'S NEXT</span><h2>Upcoming Events</h2></div>
            <p>Recent announcements and upcoming MFC Youth activities.</p>
          </div>
          <div class="member-event-stack">
            ${upcomingEvents.length
              ? upcomingEvents.map(event => eventCard(event, eventRegistration(participants, member.id, event.id), 'upcoming')).join('')
              : `<div class="member-empty-card"><strong>No upcoming events yet.</strong><span>New events will appear here once they are added by your Area.</span></div>`
            }
          </div>
        </section>

        <section class="member-dashboard-section" id="recent">
          <div class="member-section-heading">
            <div><span class="member-eyebrow">LOOKING BACK</span><h2>Recent Events</h2></div>
            <p>See recently completed activities and your participation status.</p>
          </div>
          <div class="member-event-stack">
            ${recentEvents.length
              ? recentEvents.map(event => eventCard(event, eventRegistration(participants, member.id, event.id), 'past')).join('')
              : `<div class="member-empty-card"><strong>No recent events yet.</strong><span>Completed Area events will appear here.</span></div>`
            }
          </div>
        </section>

        <section class="member-dashboard-section" id="profile">
          <div class="member-section-heading">
            <div><span class="member-eyebrow">MY ACCOUNT</span><h2>Member Profile</h2></div>
            <p>${previewMode ? 'Preview of the profile section visible to a Member.' : 'Your profile is linked to the official Area Members database.'}</p>
          </div>
          <article class="member-portal-card">
            <dl class="member-profile-list member-profile-wide">
              <div><dt>Name</dt><dd>${esc(fullName(member) || '—')}</dd></div>
              <div><dt>Email</dt><dd>${esc(member.email || '—')}</dd></div>
              <div><dt>Chapter</dt><dd>${esc(member.chapterName || 'No Chapter Assigned')}</dd></div>
              <div><dt>Contact</dt><dd>${esc(member.contact || '—')}</dd></div>
              <div><dt>First Attended Youth Camp</dt><dd>${esc(fmtDate(member.firstAttendedYouthCamp))}</dd></div>
              <div><dt>Services</dt><dd>${esc((member.services || []).join(', ') || 'No Service Assigned')}</dd></div>
            </dl>
          </article>
        </section>
      `;

      // Return to admin button for preview mode
      document.getElementById('exitMemberPreview')?.addEventListener('click', () => {
        navigateWithLoader(session.role === 'chapter_servant' ? '/chapters' : '/dashboard');
      });
    }
  }

  // 8. Event Listeners: Logout & Change Password Actions
  if (!previewMode) {
    document.getElementById('memberLogoutBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const originalText = button?.textContent || 'Logout';
      if (button) {
        button.disabled = true;
        button.textContent = 'Signing Out…';
      }

      // Invalidate backend session token if signed in to cloud
      if (session?.backendAuth && !session?.demo && session?.accessToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.accessToken}`
            },
            body: JSON.stringify({ scope: 'local' })
          });
        } catch (error) {
          console.warn('Backend logout could not be confirmed; clearing this browser session anyway.', error?.message || error);
        }
      }

      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      if (button) button.textContent = originalText;
      navigateWithLoader('/');
    });

    document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
      navigateWithLoader('/change-password');
    });
  }
}

// 9. Execute Bootstrap
bootstrapMemberPortal().catch(error => {
  console.error('Member Portal failed to load:', error);
  const root = document.getElementById('memberPortalContent');
  if (root) root.innerHTML = `<div class="member-empty-card"><strong>Unable to load the Member Portal.</strong><span>Please refresh and try again.</span></div>`;
});
