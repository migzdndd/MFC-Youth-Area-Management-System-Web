// MFC Youth Member Portal - frontend prototype
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';
const USER_KEY = 'mfc_demo_users';

function safeParse(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
function getSession() { return safeParse(localStorage.getItem(SESSION_KEY), null) || safeParse(sessionStorage.getItem(SESSION_KEY), null); }
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fullName(member) { return [member?.firstName, member?.middleName, member?.lastName].filter(Boolean).join(' '); }

const session = getSession();
if (!session) {
  location.replace('/');
} else if (session.mustChangePassword) {
  location.replace('/change-password');
} else if (session.role !== 'member') {
  location.replace('/dashboard');
} else {
  const data = safeParse(localStorage.getItem(DB_KEY) || '{}', {});
  const members = Array.isArray(data.members) ? data.members : [];
  const member = members.find(item => String(item.id) === String(session.memberId));
  const users = safeParse(localStorage.getItem(USER_KEY) || '[]', []);
  const account = Array.isArray(users) ? users.find(item => String(item.id) === String(session.userId)) : null;

  if (!member || !account || account.isActive === false || String(member?.status || 'Active') === 'Inactive') {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    location.replace('/');
  } else {
    const events = (Array.isArray(data.events) ? data.events : [])
      .filter(event => event && event.date && event.date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 5);

    const participants = Array.isArray(data.participants) ? data.participants : [];
    const myEventIds = new Set(participants.filter(p => String(p.memberId) === String(member.id)).map(p => String(p.eventId)));

    document.getElementById('memberPortalContent').innerHTML = `
      <section class="member-welcome-card">
        <span class="member-eyebrow">MEMBER ACCESS</span>
        <h1>Welcome, ${esc(member.firstName || fullName(member))}!</h1>
        <p>Your account is linked directly to your official member record. The full Youth Portal UI will continue to grow from this foundation.</p>
      </section>

      <section class="member-portal-grid">
        <article class="member-portal-card">
          <div class="member-card-heading"><div><span class="member-eyebrow">MY PROFILE</span><h2>${esc(fullName(member))}</h2></div><span class="badge active">${esc(member.status || 'Active')}</span></div>
          <dl class="member-profile-list">
            <div><dt>Email</dt><dd>${esc(member.email || '—')}</dd></div>
            <div><dt>Chapter</dt><dd>${esc(member.chapterName || 'No Chapter Assigned')}</dd></div>
            <div><dt>Contact</dt><dd>${esc(member.contact || '—')}</dd></div>
            <div><dt>First Attended Youth Camp</dt><dd>${esc(fmtDate(member.firstAttendedYouthCamp))}</dd></div>
            <div><dt>Services</dt><dd>${esc((member.services || []).join(', ') || 'No Service Assigned')}</dd></div>
          </dl>
        </article>

        <article class="member-portal-card">
          <div class="member-card-heading"><div><span class="member-eyebrow">UPCOMING</span><h2>Events</h2></div></div>
          ${events.length ? `<div class="member-event-list">${events.map(event => `
            <div class="member-event-item">
              <div><strong>${esc(event.name || event.title || 'MFC Youth Event')}</strong><span>${esc(fmtDate(event.date))}${event.location || event.venue ? ` · ${esc(event.location || event.venue)}` : ''}</span></div>
              <span class="badge ${myEventIds.has(String(event.id)) ? 'active' : 'inactive'}">${myEventIds.has(String(event.id)) ? 'Registered' : 'Not Registered'}</span>
            </div>`).join('')}</div>` : '<p class="muted">No upcoming events yet.</p>'}
        </article>
      </section>
    `;
  }
}

document.getElementById('memberLogoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  location.href = '/';
});

document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
  location.href = '/change-password';
});
