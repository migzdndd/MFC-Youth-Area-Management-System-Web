// MFC Youth Member Portal - frontend prototype
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';
const USER_KEY = 'mfc_demo_users';

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function getSession() {
  return (
    safeParse(localStorage.getItem(SESSION_KEY), null) ||
    safeParse(sessionStorage.getItem(SESSION_KEY), null)
  );
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

const session = getSession();
const previewMode = Boolean(
  session &&
  session.role !== 'member' &&
  new URLSearchParams(window.location.search).get('preview') === '1'
);

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
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    navigateWithLoader('/');
  });

  document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
    navigateWithLoader('/change-password');
  });
}
