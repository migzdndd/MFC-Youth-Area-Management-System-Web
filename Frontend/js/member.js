// MFC Youth Member Portal - frontend prototype
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';
const CLOUD_CACHE_PREFIX = `${DB_KEY}::cloud`;

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function getSession() {
  return (
    safeParse(localStorage.getItem(SESSION_KEY), null) ||
    safeParse(sessionStorage.getItem(SESSION_KEY), null)
  );
}

function isCloudAuthenticatedSession(currentSession) {
  return Boolean(
    currentSession?.backendAuth === true &&
    currentSession?.accessToken
  );
}

function cacheIdentityPart(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return encodeURIComponent(normalized);
}

function databaseStorageKey(currentSession = getSession()) {
  if (!currentSession?.backendAuth) return DB_KEY;

  const areaPart = cacheIdentityPart(currentSession.areaId, 'unassigned-area');
  const accountPart = cacheIdentityPart(
    currentSession.userId || currentSession.memberId || currentSession.email,
    'unknown-account'
  );

  return `${CLOUD_CACHE_PREFIX}::${areaPart}::${accountPart}`;
}

function clearScopedDatabaseCache(currentSession = getSession()) {
  const key = databaseStorageKey(currentSession);
  if (key !== DB_KEY) localStorage.removeItem(key);
}

function updateStoredSession(nextSession) {
  if (localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  }
}

function clearStoredSession(currentSession = getSession()) {
  clearScopedDatabaseCache(currentSession);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function sessionExpiresSoon(expiresAt, skewSeconds = 60) {
  if (!expiresAt) return false;

  const numeric = Number(expiresAt);
  if (Number.isFinite(numeric) && numeric > 0) {
    return (numeric * 1000) <= (Date.now() + (skewSeconds * 1000));
  }

  const parsed = Date.parse(String(expiresAt));
  return Number.isFinite(parsed) && parsed <= (Date.now() + (skewSeconds * 1000));
}

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

function fullName(member) {
  return [
    member?.firstName,
    member?.middleName,
    member?.lastName
  ].filter(Boolean).join(' ');
}

function eventRegistration(participants, memberId, eventId) {
  return participants.find(
    participant =>
      String(participant.memberId) === String(memberId) &&
      String(participant.eventId) === String(eventId)
  ) || null;
}

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

let session = getSession();

// Member Portal and Member View Preview require a real cloud-authenticated
// Supabase session. Old browser/demo sessions are no longer accepted.
if (session && !isCloudAuthenticatedSession(session)) {
  clearStoredSession(session);
  session = null;
}

const previewMode = Boolean(
  session &&
  session.role !== 'member' &&
  isCloudAuthenticatedSession(session) &&
  new URLSearchParams(window.location.search).get('preview') === '1'
);

let portalRefreshPromise = null;
let portalRefreshDefinitiveFailure = false;

async function refreshPortalSession({ force = false } = {}) {
  if (!session?.backendAuth || !session?.refreshToken) return false;
  if (!force && !sessionExpiresSoon(session?.expiresAt)) return true;
  if (portalRefreshPromise) return portalRefreshPromise;

  portalRefreshPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    portalRefreshDefinitiveFailure = false;

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.session?.accessToken) {
        portalRefreshDefinitiveFailure =
          response.status === 401 ||
          response.status === 403 ||
          ['SESSION_REFRESH_FAILED', 'ACCOUNT_INACTIVE'].includes(String(payload?.code || ''));
        return false;
      }

      Object.assign(session, {
        accessToken: payload.session.accessToken,
        refreshToken: payload.session.refreshToken || session.refreshToken,
        expiresAt: payload.session.expiresAt || null,
        userId: payload.user?.id ?? session.userId,
        memberId: payload.user?.memberId ?? session.memberId,
        email: payload.user?.email || session.email,
        name: payload.user?.name || session.name,
        role: payload.user?.role || session.role,
        areaId: payload.user?.areaId ?? session.areaId,
        chapterId: payload.user?.chapterId ?? session.chapterId,
        mustChangePassword: payload.user?.mustChangePassword === true,
        needsAreaSetup: payload.user?.role !== 'member' && !(payload.user?.areaId ?? session.areaId)
      });

      updateStoredSession(session);
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError' && !(error instanceof TypeError)) {
        console.warn('Member Portal session refresh failed:', error?.message || error);
      }
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  try {
    return await portalRefreshPromise;
  } finally {
    portalRefreshPromise = null;
  }
}

function invalidatePortalSession() {
  const previous = session;
  clearStoredSession(previous);
  session = null;
  navigateWithLoader('/', true);
}

async function portalBackendApi(path, options = {}) {
  const {
    timeoutMs: requestedTimeout,
    _retriedAfterRefresh = false,
    ...fetchOptions
  } = options;

  const isRefreshRequest = path === '/api/auth/refresh';

  if (
    !isRefreshRequest &&
    !_retriedAfterRefresh &&
    session?.backendAuth &&
    session?.refreshToken &&
    sessionExpiresSoon(session?.expiresAt)
  ) {
    await refreshPortalSession({ force: true }).catch(() => false);
  }

  const token = session?.accessToken || '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Number(requestedTimeout || 8000));

  try {
    const response = await fetch(path, {
      ...fetchOptions,
      method: fetchOptions.method || 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(fetchOptions.headers || {})
      }
    });

    const body = await response.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));

    if (!response.ok) {
      const code = String(body?.code || '');
      const canRefresh =
        response.status === 401 &&
        !_retriedAfterRefresh &&
        !isRefreshRequest &&
        session?.backendAuth &&
        Boolean(session?.refreshToken) &&
        ['INVALID_SESSION', 'AUTH_REQUIRED'].includes(code);

      if (canRefresh) {
        const refreshed = await refreshPortalSession({ force: true });
        if (refreshed) {
          return portalBackendApi(path, {
            ...fetchOptions,
            timeoutMs: requestedTimeout,
            _retriedAfterRefresh: true
          });
        }

        if (portalRefreshDefinitiveFailure || response.status === 401) {
          invalidatePortalSession();
        }
      }

      if (response.status === 403 && code === 'ACCOUNT_INACTIVE') {
        invalidatePortalSession();
      }

      if (response.status === 403 && code === 'PASSWORD_SETUP_REQUIRED') {
        if (session) {
          session.mustChangePassword = true;
          updateStoredSession(session);
        }
        navigateWithLoader('/change-password', true);
      }

      const error = new Error(body?.error || 'Request failed.');
      error.status = response.status;
      error.code = code;
      throw error;
    }

    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The server took too long to respond. Please try again.');
    }
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the server. Check your connection and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

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

async function syncMemberPortalCloudCache() {
  if (!session?.backendAuth || !session?.areaId) return false;

  // One unified request now returns the Member record, assignments, events,
  // participants, and authoritative profile metadata.
  const syncPayload = await portalBackendApi('/api/sync');
  if (!session) return false;

  if (syncPayload?.user) {
    const previousKey = databaseStorageKey(session);
    Object.assign(session, {
      userId: syncPayload.user.id ?? session.userId,
      memberId: syncPayload.user.memberId ?? session.memberId,
      email: syncPayload.user.email || session.email,
      name: syncPayload.user.name || session.name,
      role: String(syncPayload.user.role || session.role || '').trim().toLowerCase(),
      areaId: syncPayload.user.areaId ?? session.areaId,
      chapterId: syncPayload.user.chapterId ?? session.chapterId,
      mustChangePassword: syncPayload.user.mustChangePassword === true,
      needsAreaSetup: syncPayload.user.role !== 'member' && !(syncPayload.user.areaId ?? session.areaId)
    });
    updateStoredSession(session);

    const nextKey = databaseStorageKey(session);
    if (previousKey !== nextKey && previousKey !== DB_KEY) localStorage.removeItem(previousKey);

    if (session.mustChangePassword) {
      navigateWithLoader('/change-password', true);
      return false;
    }
    if (session.role !== 'member' && !previewMode) {
      navigateWithLoader(session.role === 'chapter_servant' ? '/chapters' : '/dashboard', true);
      return false;
    }
  }

  const data = safeParse(localStorage.getItem(databaseStorageKey(session)) || '{}', {});
  const previousMembers = Array.isArray(data.members) ? data.members : [];
  const cloudMembers = Array.isArray(syncPayload?.members) ? syncPayload.members : [];
  const chapters = Array.isArray(syncPayload?.chapters) ? syncPayload.chapters : [];
  const services = Array.isArray(syncPayload?.services) ? syncPayload.services : [];
  const serviceLinks = Array.isArray(syncPayload?.memberServices) ? syncPayload.memberServices : [];
  const chapterNameById = new Map(chapters.map(row => [String(row.id), row.name]));
  const serviceNameById = new Map(services.map(row => [String(row.id), row.name]));
  const servicesByMember = new Map();

  serviceLinks.forEach(link => {
    const memberId = String(link.member_id || '');
    const name = serviceNameById.get(String(link.service_id || ''));
    if (!memberId || !name) return;
    if (!servicesByMember.has(memberId)) servicesByMember.set(memberId, []);
    servicesByMember.get(memberId).push(name);
  });

  data.members = cloudMembers.map(row => {
    const previous = previousMembers.find(item => String(item.id) === String(row.id)) || {};
    const member = portalCloudMember(row, previous);
    member.chapterName = member.chapterId ? (chapterNameById.get(String(member.chapterId)) || '') : '';
    member.services = servicesByMember.get(String(member.id)) || [];
    return member;
  });

  data.chapters = chapters.map(row => ({ id: row.id, name: row.name, areaId: row.area_id, cloudBacked: true }));
  data.services = services.map(row => row.name).filter(Boolean);
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
  data.cloudSyncedAt = Number(syncPayload?.syncedAt || Date.now());

  localStorage.setItem(databaseStorageKey(session), JSON.stringify(data));
  return true;
}

function memberPortalCacheIsFresh(maxAgeMs = 30000) {
  const data = safeParse(localStorage.getItem(databaseStorageKey(session)) || '{}', {});
  const syncedAt = Number(data.cloudSyncedAt || 0);
  const members = Array.isArray(data.members) ? data.members : [];
  const linked = members.some(item =>
    String(item.id) === String(session?.memberId) ||
    String(item.email || '').trim().toLowerCase() === String(session?.email || '').trim().toLowerCase()
  );
  return linked && syncedAt > 0 && (Date.now() - syncedAt) < maxAgeMs;
}

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

async function bootstrapMemberPortal() {
  if (!session) {
    navigateWithLoader('/', true);
    return;
  }

  if (session.mustChangePassword) {
    navigateWithLoader('/change-password', true);
    return;
  }

  if (session.role !== 'member' && !previewMode) {
    navigateWithLoader(
      session.role === 'chapter_servant'
        ? '/chapters'
        : '/dashboard',
      true
    );
    return;
  }

  // Refresh an expired/near-expiry session before loading protected cloud data.
  // If the refresh is definitively rejected, invalidatePortalSession() will
  // route the user back to sign-in instead of rendering stale cached data.
  if (sessionExpiresSoon(session.expiresAt)) {
    const refreshed = await refreshPortalSession({ force: true });
    if (!refreshed && portalRefreshDefinitiveFailure) {
      invalidatePortalSession();
      return;
    }

    if (session?.mustChangePassword) {
      navigateWithLoader('/change-password', true);
      return;
    }
  }

  // Recent account/Area-scoped cache makes repeat portal visits immediate.
  // First load or stale cache performs one unified /api/sync request.
  if (!memberPortalCacheIsFresh()) {
    try {
      await syncMemberPortalCloudCache();
    } catch (error) {
      if (!session) return;
      console.warn('Member Portal cloud sync skipped:', error?.message || error);
    }
  }

  if (!session) return;

  {
  const data = safeParse(localStorage.getItem(databaseStorageKey(session)) || '{}', {});
  const members = Array.isArray(data.members) ? data.members : [];
  const linkedMember = members.find(
    item => String(item.id) === String(session.memberId)
  ) || members.find(
    item => String(item.email || '').trim().toLowerCase() === String(session.email || '').trim().toLowerCase()
  );
  const member = linkedMember || (previewMode ? previewMemberFromSession(session) : null);

  const validMemberCloudSession = Boolean(
    session?.role === 'member' &&
    isCloudAuthenticatedSession(session)
  );

  if (
    !previewMode &&
    (
      !member ||
      !validMemberCloudSession ||
      String(member?.status || 'Active') === 'Inactive'
    )
  ) {
    clearStoredSession(session);
    session = null;
    navigateWithLoader('/', true);
  } else if (member) {
    if (previewMode) {
      document.body.classList.add('member-preview-mode');
      const actions = document.querySelector('.member-portal-actions');
      if (actions) {
        actions.innerHTML = `
          <button class="btn" id="exitMemberPreview" type="button">Return to Admin Dashboard</button>
        `;
      }
    }

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

    document.getElementById('exitMemberPreview')?.addEventListener('click', () => {
      navigateWithLoader(session.role === 'chapter_servant' ? '/chapters' : '/dashboard');
    });
  }
}

if (!previewMode) {
  document.getElementById('memberLogoutBtn')?.addEventListener('click', () => {
    clearStoredSession(session);
    session = null;
    navigateWithLoader('/');
  });

  document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
    navigateWithLoader('/change-password');
  });
}

}

bootstrapMemberPortal().catch(error => {
  console.error('Member Portal failed to load:', error);
  const root = document.getElementById('memberPortalContent');
  if (root) root.innerHTML = `<div class="member-empty-card"><strong>Unable to load the Member Portal.</strong><span>Please refresh and try again.</span></div>`;
});
