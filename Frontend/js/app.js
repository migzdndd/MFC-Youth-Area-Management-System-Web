// =========================================================
// MFC Youth Area Management System - Frontend Application
// Supabase-backed application. localStorage is used only as a fast UI cache/fallback for authenticated cloud data and demo mode.
// =========================================================

const DB_KEY = 'mfc_web_database_v1';
const SESSION_KEY = 'mfc_demo_session';
const USER_KEY = 'mfc_demo_users';
const DB_VERSION = 7;
let activeModalCleanup = null;

function initializeMotionEffects() {
  const revealTargets = document.querySelectorAll('.animate-in');
  if (!revealTargets.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealTargets.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  revealTargets.forEach((element, index) => {
    element.style.animationDelay = `${index * 80}ms`;
    requestAnimationFrame(() => element.classList.add('is-visible'));
  });
}

window.addEventListener('DOMContentLoaded', initializeMotionEffects);

const SERVICES = [
  'Unit Servant',
  'Household Servant',
  'Chapter Servant',
  'Area Servant',
  'LIT Servant',
  'Campus Servant',
  'MFC High Servant'
];

const ACCESS_LEVELS = [
  { value: 'couple_coordinator', label: 'Couple Coordinator/s' },
  { value: 'area_servant', label: 'Area Servant' },
  { value: 'lit_servant', label: 'LIT Servant' },
  { value: 'campus_servant', label: 'Campus Servant' },
  { value: 'chapter_servant', label: 'Chapter Servant' },
  { value: 'member', label: 'Member' }
];

const ACCESS_ROLE_VALUES = new Set(
  ACCESS_LEVELS.map(item => item.value)
);

const SUPER_ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  // Kept only for compatibility with the older prototype session.
  'area_admin'
]);

function normalizeAccessRole(value) {
  const role = String(value || 'member').trim().toLowerCase();
  if (role === 'area_admin') return 'area_servant';
  return ACCESS_ROLE_VALUES.has(role) ? role : 'member';
}

function accessRoleLabel(value) {
  const normalized = normalizeAccessRole(value);
  return ACCESS_LEVELS.find(item => item.value === normalized)?.label || 'Member';
}

function inlineJsArg(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}

function isSuperAdminRole(value) {
  return SUPER_ADMIN_ROLES.has(String(value || '').trim().toLowerCase());
}

function isChapterServantRole(value) {
  return String(value || '').trim().toLowerCase() === 'chapter_servant';
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getSession() {
  return (
    safeParse(localStorage.getItem(SESSION_KEY), null) ||
    safeParse(sessionStorage.getItem(SESSION_KEY), null)
  );
}

function updateStoredSession(nextSession) {
  if (localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  }
}

async function backendApi(path, options = {}) {
  const token = session?.accessToken || '';
  const timeoutMs = Number(options.timeoutMs || 8000);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = { ok: false, error: 'The server returned an invalid response.' };
    }

    if (!response.ok) {
      const error = new Error(body?.error || 'Request failed.');
      error.status = response.status;
      error.body = body;
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

function cloudMemberToLocal(member, previous = {}) {
  return {
    ...previous,
    id: member.id,
    areaId: member.area_id ?? previous.areaId ?? null,
    chapterId: member.chapter_id ?? previous.chapterId ?? null,
    firstName: member.first_name || previous.firstName || '',
    middleName: member.middle_name || '',
    lastName: member.last_name || previous.lastName || '',
    birthDate: member.birth_date || '',
    contact: member.contact_number || '',
    email: String(member.email || previous.email || '').trim().toLowerCase(),
    address: member.address || '',
    status: member.status || 'Active',
    firstAttendedYouthCamp: member.first_attended_youth_camp || '',
    accessLevel: normalizeAccessRole(member.access_level || 'member'),
    createdAt: member.created_at || previous.createdAt || null,
    updatedAt: member.updated_at || previous.updatedAt || null,
    services: Array.isArray(previous.services) ? previous.services : [],
    chapterName: previous.chapterName || '',
    cloudBacked: true
  };
}

async function syncBackendMembersIntoLocalDb() {
  if (!session?.backendAuth || session?.demo || !session?.areaId) return false;

  const payload = await backendApi('/api/members');
  const cloudMembers = Array.isArray(payload?.members) ? payload.members : [];
  const data = db();
  const previousMembers = Array.isArray(data.members) ? data.members : [];

  // In authenticated cloud mode, Supabase is the source of truth. localStorage
  // only keeps a fast render cache so deleted/stale prototype records cannot
  // reappear after a refresh.
  data.members = cloudMembers.map(cloudMember => {
    const email = String(cloudMember.email || '').trim().toLowerCase();
    const previous = previousMembers.find(localMember =>
      String(localMember.id) === String(cloudMember.id) ||
      (email && String(localMember.email || '').trim().toLowerCase() === email)
    ) || {};
    return cloudMemberToLocal(cloudMember, previous);
  });

  save(data);
  return true;
}

function cloudEventToLocal(row) {
  let localDateTime = '';
  if (row.starts_at) {
    const date = new Date(row.starts_at);
    if (!Number.isNaN(date.getTime())) {
      const phTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));
      localDateTime = phTime.toISOString().slice(0, 16);
    }
  }

  return {
    id: row.id,
    areaId: row.area_id,
    name: row.name || '',
    date: localDateTime,
    fee: Number(row.fee || 0),
    venue: row.venue || '',
    peopleAttended: Number(row.manual_attendance || 0),
    description: row.description || '',
    cloudBacked: true
  };
}

function cloudParticipantToLocal(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    memberId: row.member_id,
    paymentMode: row.mode_of_payment || 'Cash',
    paymentStatus: row.payment_status || 'Unpaid',
    attended: Boolean(row.attended),
    cloudBacked: true
  };
}

function cloudGigToLocal(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    chapterId: row.chapter_id || null,
    date: row.contribution_date,
    amount: Number(row.amount || 0),
    note: row.notes || '',
    cloudBacked: true
  };
}

async function syncCloudModulesIntoLocalDb() {
  if (!session?.backendAuth || session?.demo || !session?.areaId) return false;

  const payload = await backendApi('/api/sync', { timeoutMs: 10000 });
  const data = db();

  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
  const services = Array.isArray(payload?.services) ? payload.services : [];
  const memberServices = Array.isArray(payload?.memberServices) ? payload.memberServices : [];
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const participants = Array.isArray(payload?.participants) ? payload.participants : [];
  const reports = Array.isArray(payload?.reports) ? payload.reports : [];
  const gig = Array.isArray(payload?.gig) ? payload.gig : [];

  data.chapters = chapters.map(row => ({
    id: row.id,
    areaId: row.area_id,
    name: row.name || '',
    cloudBacked: true
  }));

  data.services = services.map(row => row.name).filter(Boolean);
  const serviceNameById = new Map(services.map(row => [String(row.id), row.name]));
  const serviceNamesByMember = new Map();
  memberServices.forEach(link => {
    const memberId = String(link.member_id || '');
    const serviceName = serviceNameById.get(String(link.service_id || ''));
    if (!memberId || !serviceName) return;
    if (!serviceNamesByMember.has(memberId)) serviceNamesByMember.set(memberId, []);
    serviceNamesByMember.get(memberId).push(serviceName);
  });

  const chapterNameById = new Map(data.chapters.map(chapter => [String(chapter.id), chapter.name]));
  data.members = data.members.map(member => ({
    ...member,
    chapterName: member.chapterId ? (chapterNameById.get(String(member.chapterId)) || '') : '',
    services: serviceNamesByMember.get(String(member.id)) || []
  }));

  data.events = events.map(cloudEventToLocal);
  data.participants = participants.map(cloudParticipantToLocal);
  data.reports = reports.map(row => ({
    id: row.id,
    areaId: row.area_id,
    chapterId: row.chapter_id || null,
    chapter: row.chapter_id ? (chapterNameById.get(String(row.chapter_id)) || row.chapter_name_snapshot || '') : (row.chapter_name_snapshot || ''),
    type: row.report_type || '',
    date: row.activity_date || '',
    title: row.title || '',
    activity: row.activity || '',
    preparedBy: row.prepared_by_name || '',
    participants: Number(row.participant_count || 0),
    location: row.location || '',
    eventId: row.event_id || null,
    description: row.notes || '',
    cloudBacked: true
  }));
  data.gig = gig.map(cloudGigToLocal);
  data.cloudDashboard = payload?.dashboard || null;

  save(data);
  return true;
}

async function refreshAllCloudData({ render = true } = {}) {
  if (!session?.backendAuth || session?.demo || !session?.areaId) return false;
  await syncBackendMembersIntoLocalDb();
  await syncCloudModulesIntoLocalDb();
  if (render) renderPageSafely();
  return true;
}

function isSuperAdminSession() {
  return isSuperAdminRole(session?.role);
}

function isChapterServantSession() {
  return isChapterServantRole(session?.role);
}

function scopedChapter(data) {
  if (!isChapterServantSession()) return null;

  const directId = session?.chapterId;
  if (directId !== null && directId !== undefined && String(directId).trim() !== '') {
    const direct = data.chapters.find(
      chapter => String(chapter.id) === String(directId)
    );
    if (direct) return direct;
  }

  const linkedMember = data.members.find(
    member => String(member.id) === String(session?.memberId)
  );

  if (!linkedMember?.chapterId) return null;

  return data.chapters.find(
    chapter => String(chapter.id) === String(linkedMember.chapterId)
  ) || null;
}

function denyUnlessSuperAdmin(message = 'Only Couple Coordinators, Area Servants, LIT Servants, and Campus Servants can perform this action.') {
  if (isSuperAdminSession()) return false;
  toast(message, 'error');
  return true;
}

function canManageOwnChapterMember(data, member) {
  if (isSuperAdminSession()) return true;
  if (!isChapterServantSession() || !member) return false;

  const chapter = scopedChapter(data);
  return Boolean(
    chapter &&
    String(member.chapterId) === String(chapter.id)
  );
}


function authEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function isOwnMemberRecord(member) {
  if (!member) return false;

  const currentMemberId = String(session?.memberId || '').trim();
  const recordMemberId = String(member.id || '').trim();
  if (currentMemberId && recordMemberId && currentMemberId === recordMemberId) {
    return true;
  }

  // Email is a safe fallback for older/self-healed sessions where memberId
  // has not been hydrated yet. Member emails are unique in the cloud schema.
  const currentEmail = authEmail(session?.email || '');
  const recordEmail = authEmail(member.email || '');
  return Boolean(currentEmail && recordEmail && currentEmail === recordEmail);
}

function normalizeDatabase(input) {
  const data = input && typeof input === 'object' ? input : {};

  const chapters = Array.isArray(data.chapters)
    ? data.chapters
      .filter(chapter =>
        chapter &&
        typeof chapter === 'object' &&
        String(chapter.name || '').trim()
      )
      .map(chapter => ({
        ...chapter,
        name: String(chapter.name).trim()
      }))
    : [];

  const chapterById = new Map(
    chapters.map(chapter => [String(chapter.id), chapter])
  );

  const chapterByName = new Map(
    chapters.map(chapter => [chapter.name.toLowerCase(), chapter])
  );

  const members = Array.isArray(data.members)
    ? data.members
      .filter(member => member && typeof member === 'object')
      .map(member => {
        const normalized = {
          ...member,
          accessLevel: normalizeAccessRole(member.accessLevel || 'member'),
          services: Array.isArray(member.services)
            ? member.services.filter(Boolean).map(String)
            : []
        };

        const rawId = member.chapterId;
        const rawName = String(member.chapterName || '').trim();
        const chapterFromId =
          rawId !== null &&
          rawId !== undefined &&
          String(rawId).trim() !== ''
            ? chapterById.get(String(rawId))
            : null;
        const chapterFromName = rawName
          ? chapterByName.get(rawName.toLowerCase())
          : null;
        const chapter = chapterFromId || chapterFromName;

        if (chapter) {
          normalized.chapterId = chapter.id;
          normalized.chapterName = chapter.name;
        } else {
          normalized.chapterId = null;
          normalized.chapterName = '';
        }

        return normalized;
      })
    : [];

  const memberById = new Map(
    members.map(member => [String(member.id), member])
  );

  const participants = Array.isArray(data.participants)
    ? data.participants
      .filter(
        participant => participant && typeof participant === 'object'
      )
      .map(participant => {
        const directMember =
          participant.memberId !== null &&
          participant.memberId !== undefined &&
          String(participant.memberId).trim() !== ''
            ? memberById.get(String(participant.memberId))
            : null;

        let linkedMember = directMember || null;

        // Best-effort migration for participant records created before
        // event registration was linked to the Members database.
        if (!linkedMember && participant.contact) {
          const matches = members.filter(
            member => String(member.contact || '') === String(participant.contact || '')
          );

          if (matches.length === 1) {
            linkedMember = matches[0];
          }
        }

        if (!linkedMember) {
          const participantName = [
            participant.first,
            participant.mi,
            participant.last
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

          if (participantName) {
            const matches = members.filter(member =>
              [
                member.firstName,
                member.middleName,
                member.lastName
              ]
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase() === participantName
            );

            if (matches.length === 1) {
              linkedMember = matches[0];
            }
          }
        }

        return {
          ...participant,
          memberId: linkedMember?.id ?? participant.memberId ?? null
        };
      })
    : [];

  const reports = Array.isArray(data.reports)
    ? data.reports
      .filter(report => report && typeof report === 'object')
      .map(report => {
        const eventId = report.eventId !== null && report.eventId !== undefined && String(report.eventId).trim()
          ? report.eventId
          : null;

        const linkedParticipants = eventId
          ? participants.filter(item => String(item.eventId) === String(eventId))
          : [];

        const attendedCount = linkedParticipants.filter(
          item => item.attended
        ).length;

        const sourceParticipants =
          report.participants ??
          report.attendance ??
          (eventId
            ? (linkedParticipants.length ? attendedCount : 0)
            : 0);

        return {
          ...report,
          participants: Number.isFinite(Number(sourceParticipants))
            ? Math.max(0, Math.trunc(Number(sourceParticipants)))
            : 0,
          location: String(report.location || report.venue || '').trim(),
          eventId: Number.isFinite(eventId) ? eventId : null
        };
      })
    : [];

  const services = Array.isArray(data.services)
    ? [...new Set(data.services.filter(Boolean).map(String))]
    : [];

  return {
    version: DB_VERSION,
    members,
    chapters,
    services: services.length ? services : [...SERVICES],
    reports,
    events: Array.isArray(data.events)
      ? data.events.filter(event => event && typeof event === 'object')
      : [],
    participants,
    gig: Array.isArray(data.gig)
      ? data.gig.filter(item => item && typeof item === 'object')
      : [],
    cloudDashboard: data.cloudDashboard && typeof data.cloudDashboard === 'object'
      ? data.cloudDashboard
      : null
  };
}

function seedDB() {
  const existing = safeParse(
    localStorage.getItem(DB_KEY),
    null
  );

  localStorage.setItem(
    DB_KEY,
    JSON.stringify(normalizeDatabase(existing))
  );
}

function db() {
  return normalizeDatabase(
    safeParse(localStorage.getItem(DB_KEY), null)
  );
}

function save(data) {
  localStorage.setItem(
    DB_KEY,
    JSON.stringify(normalizeDatabase(data))
  );
}

let uidSequence = 0;
function uid() {
  return Date.now() * 1000 + (++uidSequence % 1000);
}

function esc(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  );
}

function money(value) {
  return Number(value || 0).toLocaleString('en-PH', {
    style: 'currency',
    currency: 'PHP'
  });
}

function fmtDate(value) {
  if (!value) return '—';

  const d = new Date(
    `${value}`.length === 10
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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fullName(member) {
  return [
    member.firstName,
    member.middleName,
    member.lastName
  ]
    .filter(Boolean)
    .join(' ');
}

function calculateAge(birthDate) {
  if (!birthDate) return null;

  const parsed = new Date(
    `${birthDate}T00:00:00`
  );

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();

  if (
    monthDelta < 0 ||
    (
      monthDelta === 0 &&
      today.getDate() < parsed.getDate()
    )
  ) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function participantMember(data, participant) {
  if (!participant || !data) return null;

  if (participant.memberId !== null && participant.memberId !== undefined) {
    const linked = data.members.find(
      member => String(member.id) === String(participant.memberId)
    );

    if (linked) return linked;
  }

  if (participant.contact) {
    const matches = data.members.filter(
      member => String(member.contact || '') === String(participant.contact || '')
    );

    if (matches.length === 1) return matches[0];
  }

  return null;
}

function participantName(data, participant) {
  const member = participantMember(data, participant);

  return member
    ? fullName(member)
    : [participant?.first, participant?.mi, participant?.last]
      .filter(Boolean)
      .join(' ');
}

function isUnassignedMember(member) {
  if (!member || typeof member !== 'object') {
    return false;
  }

  const chapterId = member.chapterId;
  const chapterName = member.chapterName;

  const hasEmptyId =
    chapterId === null ||
    chapterId === undefined ||
    chapterId === '' ||
    String(chapterId).trim() === '';

  const hasEmptyName =
    !chapterName ||
    String(chapterName).trim() === '';

  return hasEmptyId && hasEmptyName;
}

function validEmail(value) {
  return (
    !value ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

// =========================================================
// TOAST NOTIFICATIONS
// =========================================================

function toast(text, type = 'success') {
  const wrap = document.getElementById('toastWrap');

  if (!wrap) return;

  const item = document.createElement('div');

  item.className = `toast ${type}`;
  item.setAttribute('role', 'status');
  item.textContent = text;

  wrap.appendChild(item);

  setTimeout(() => item.remove(), 3000);
}

// =========================================================
// MODAL
// =========================================================

function openModal(
  title,
  body,
  onSave = null,
  saveText = 'Save'
) {
  const root = document.getElementById('modalRoot');

  if (!root) return;

  if (activeModalCleanup) {
    activeModalCleanup();
  }

  root.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
      >
        <header class="modal-header">
          <h2 id="modalTitle">${title}</h2>

          <button
            class="icon-btn"
            id="closeModal"
            type="button"
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>

        <div class="modal-body">
          ${body}
        </div>

        <footer class="modal-footer">
          <button
            class="btn"
            id="cancelModal"
            type="button"
          >
            ${onSave ? 'Cancel' : 'Close'}
          </button>

          ${onSave
      ? `
                <button
                  class="btn blue"
                  id="saveModal"
                  type="button"
                >
                  ${saveText}
                </button>
              `
      : ''
    }
        </footer>
      </section>
    </div>
  `;

  const close = () => {
    document.removeEventListener(
      'keydown',
      onKeyDown
    );

    root.innerHTML = '';

    if (activeModalCleanup === close) {
      activeModalCleanup = null;
    }
  };

  activeModalCleanup = close;

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      close();
    }
  };

  document.addEventListener(
    'keydown',
    onKeyDown
  );

  document.getElementById(
    'closeModal'
  ).onclick = close;

  document.getElementById(
    'cancelModal'
  ).onclick = close;

  document
    .getElementById('modalBackdrop')
    .addEventListener('click', event => {
      if (event.target.id === 'modalBackdrop') {
        close();
      }
    });

  if (onSave) {
    document.getElementById(
      'saveModal'
    ).onclick = () => onSave(close);
  }

  requestAnimationFrame(() =>
    root
      .querySelector(
        'input, select, textarea, button'
      )
      ?.focus()
  );
}

function field(
  label,
  id,
  type = 'text',
  value = '',
  extra = ''
) {
  return `
    <div class="form-group">
      <label for="${id}">
        ${label}
      </label>

      <input
        class="text-input"
        id="${id}"
        type="${type}"
        value="${esc(value)}"
        ${extra}
      >
    </div>
  `;
}

function selectField(
  label,
  id,
  options,
  value = ''
) {
  return `
    <div class="form-group">
      <label for="${id}">
        ${label}
      </label>

      <select
        class="select-input"
        id="${id}"
      >
        ${options
      .map(
        option => `
              <option
                ${option === value ? 'selected' : ''}
              >
                ${esc(option)}
              </option>
            `
      )
      .join('')}
      </select>
    </div>
  `;
}

function pageHeader(
  title,
  subtitle,
  actions = ''
) {
  return `
    <header class="page-header">
      <div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>

      <div class="page-actions">
        ${actions}
      </div>
    </header>
  `;
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </div>
  `;
}

// =========================================================
// APP BOOTSTRAP
// =========================================================

seedDB();

const page =
  document.body.dataset.page;

const session = getSession();

if (!session) {
  navigateWithLoader('/', true);
} else if (session.mustChangePassword) {
  navigateWithLoader('/change-password', true);
} else if (session.role === 'member') {
  navigateWithLoader('/member', true);
} else if (
  isChapterServantSession() &&
  !session.needsAreaSetup &&
  !['members', 'chapters', 'reports', 'events'].includes(page)
) {
  navigateWithLoader('/chapters', true);
}

const content =
  document.getElementById('pageContent');

const logoutBtn =
  document.getElementById('logoutBtn');

if (isChapterServantSession()) {
  const allowedPaths = new Set([
    '/members',
    '/chapters',
    '/reports',
    '/events'
  ]);

  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (!allowedPaths.has(href)) {
      link.classList.add('role-hidden');
      link.setAttribute('aria-hidden', 'true');
      link.tabIndex = -1;
    }
  });
}

if (logoutBtn) {
  const user =
    document.createElement('div');

  user.className = 'signed-in-user';

  const scopeData = db();
  const chapter = isChapterServantSession()
    ? scopedChapter(scopeData)
    : null;

  user.innerHTML = `
    <span>Signed in as</span>
    <strong>
      ${esc(
    session?.name ||
    session?.email ||
    'Area User'
  )}
    </strong>
    <small class="signed-in-role">
      ${esc(accessRoleLabel(session?.role))}
      ${chapter ? ` · ${esc(chapter.name)}` : ''}
    </small>
  `;

  logoutBtn.parentElement?.insertBefore(
    user,
    logoutBtn
  );

  if (session?.role !== 'member') {
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'sidebar-account-action member-preview-button';
    previewButton.textContent = 'Enter Members Portal';
    previewButton.onclick = () => navigateWithLoader('/member?preview=1');
    logoutBtn.parentElement?.insertBefore(previewButton, logoutBtn);

    if (session?.backendAuth && !session?.demo) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'sidebar-account-action delete-account-button';
      deleteButton.textContent = 'Delete Account';
      deleteButton.onclick = async () => {
        const warning = 'Permanently delete your account? This removes your Supabase login, profile, and linked member record. This cannot be undone.';
        if (!window.confirm(warning)) return;

        const typed = window.prompt('Type DELETE to permanently delete your account.');
        if (typed !== 'DELETE') {
          toast('Account deletion cancelled.', 'error');
          return;
        }

        const originalText = deleteButton.textContent;
        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting Account…';

        try {
          await backendApi('/api/auth/account', { method: 'DELETE' });

          const data = db();
          data.members = (data.members || []).filter(member =>
            String(member.id) !== String(session?.memberId) &&
            String(member.email || '').trim().toLowerCase() !== String(session?.email || '').trim().toLowerCase()
          );
          save(data);

          localStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(SESSION_KEY);
          navigateWithLoader('/', true);
        } catch (error) {
          deleteButton.disabled = false;
          deleteButton.textContent = originalText;
          toast(error?.message || 'Unable to delete the account.', 'error');
        }
      };
      logoutBtn.parentElement?.insertBefore(deleteButton, logoutBtn);
    }
  }

  logoutBtn.onclick = () => {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);

    navigateWithLoader('/');
  };
}

// =========================================================
// MOBILE SIDEBAR
// =========================================================

const sidebar =
  document.getElementById('sidebar');

const menuBtn =
  document.getElementById('menuBtn');

if (sidebar && menuBtn) {
  const scrim =
    document.createElement('button');

  scrim.type = 'button';
  scrim.className = 'sidebar-scrim';
  scrim.id = 'sidebarScrim';

  scrim.setAttribute(
    'aria-label',
    'Close navigation menu'
  );

  document.body.appendChild(scrim);

  const closeMenu = () => {
    sidebar.classList.remove('open');
    scrim.classList.remove('show');

    menuBtn.setAttribute(
      'aria-expanded',
      'false'
    );
  };

  const toggleMenu = () => {
    const open =
      !sidebar.classList.contains('open');

    sidebar.classList.toggle(
      'open',
      open
    );

    scrim.classList.toggle(
      'show',
      open
    );

    menuBtn.setAttribute(
      'aria-expanded',
      String(open)
    );
  };

  menuBtn.setAttribute(
    'aria-controls',
    'sidebar'
  );

  menuBtn.setAttribute(
    'aria-expanded',
    'false'
  );

  menuBtn.addEventListener(
    'click',
    toggleMenu
  );

  scrim.addEventListener(
    'click',
    closeMenu
  );

  sidebar
    .querySelectorAll('a')
    .forEach(link =>
      link.addEventListener(
        'click',
        closeMenu
      )
    );

  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    }
  );
}

// =========================================================
// DASHBOARD
// =========================================================

function renderDashboard() {
  const data = db();

  const cloudSummary = session?.backendAuth && !session?.demo
    ? data.cloudDashboard
    : null;

  const cards = [
    [
      'members',
      'Total Members',
      cloudSummary?.members ?? data.members.length,
      'People currently on record'
    ],

    [
      'chapters',
      'Chapters',
      cloudSummary?.chapters ?? data.chapters.length,
      'Registered chapters'
    ],

    [
      'services',
      'Services',
      cloudSummary?.services ?? data.services.length,
      'Available service roles'
    ],

    [
      'reports',
      'Activity Reports',
      cloudSummary?.reports ?? data.reports.length,
      'Reports currently filed'
    ],

    [
      'events',
      'Events',
      cloudSummary?.events ?? data.events.length,
      'Events currently recorded'
    ]
  ];

  const chapterCounts =
    data.chapters
      .map(chapter => ({
        name: chapter.name,

        count: data.members.filter(
          member =>
            String(member.chapterId) ===
            String(chapter.id)
        ).length
      }))
      .sort(
        (a, b) =>
          b.count - a.count
      );

  const now = Date.now();

  // FUTURE / CURRENT EVENTS ONLY
  const upcomingEvents = [
    ...data.events
  ]
    .filter(
      event =>
        event.date &&
        new Date(
          event.date
        ).getTime() >= now
    )
    .sort(
      (a, b) =>
        new Date(a.date) -
        new Date(b.date)
    )
    .slice(0, 5);

  // PAST EVENTS ONLY
  const recentEvents = [
    ...data.events
  ]
    .filter(
      event =>
        event.date &&
        new Date(
          event.date
        ).getTime() < now
    )
    .sort(
      (a, b) =>
        new Date(b.date) -
        new Date(a.date)
    )
    .slice(0, 5);

  const activeMembers = cloudSummary?.activeMembers ?? data.members.filter(
    member => member.status === 'Active'
  ).length;

  const attended = cloudSummary?.attended ?? data.participants.filter(
    participant => participant.attended
  ).length;

  const dashboardAreaName = session?.areaName || 'Your Area';
  const dashboardRole = accessRoleLabel(session?.role);

  content.innerHTML = `
    <section class="dashboard-hero animate-in is-visible">
      <div class="dashboard-hero-copy">
        <div class="dashboard-kicker"><span class="dashboard-live-dot"></span> Cloud workspace</div>
        <h1>Welcome back, ${esc(session?.name || 'Area User')}.</h1>
        <p>Here is the latest overview of ${esc(dashboardAreaName)}. Your records are organized, synced, and ready for action.</p>
        <div class="dashboard-identity-row">
          <span>${esc(dashboardRole)}</span>
          <span>${esc(dashboardAreaName)}</span>
          <span>Supabase connected</span>
        </div>
      </div>
      <div class="dashboard-hero-actions">
        <a class="btn blue" href="/members">View Members</a>
        <a class="btn" href="/events">Manage Events</a>
      </div>
    </section>

    <section>
      <div class="section-heading">
        <h2>Area Summary</h2>

        <p>
          Current totals from your Area cloud database
        </p>

        <div class="section-line"></div>
      </div>

      <div class="summary-card card">
        ${cards
      .map(
        card => `
              <a
                class="summary-item ${card[0]}"
                href="/${card[0]}"
                style="text-decoration: none; color: inherit; display: flex; flex-direction: column;"
                title="View ${esc(card[1])}"
              >
                <div class="summary-label">
                  ${card[1]}

                  <div
                    class="label-line"
                  ></div>
                </div>

                <strong
                  class="summary-number"
                >
                  ${card[2]}
                </strong>

                <p>
                  ${card[3]}
                </p>
                <span class="summary-link-hint" style="font-size: 0.76rem; color: var(--blue); font-weight: 600; margin-top: auto; padding-top: 6px; display: inline-flex; align-items: center; gap: 4px;">
                  Open module &rarr;
                </span>
              </a>
            `
      )
      .join('')}
      </div>
    </section>

    <div class="quick-stat-row">
      <span>
        <strong>
          ${activeMembers}
        </strong>
        Active Members
      </span>

      <span>
        <strong>
          ${cloudSummary?.registrations ?? data.participants.length}
        </strong>
        Event Registrations
      </span>

      <span>
        <strong>
          ${attended}
        </strong>
        Recorded Attendances
      </span>
    </div>

    <div class="grid-2">

      <section class="card panel">
        <h3>
          Members by Chapter
        </h3>

        ${chapterCounts.length
      ? `
              <div class="bar-list">
                ${chapterCounts
        .slice(0, 7)
        .map(item => {
          const max =
            Math.max(
              ...chapterCounts.map(
                row => row.count
              ),
              1
            );

          return `
                      <div class="bar-row">
                        <span>
                          ${esc(
            item.name
          )}
                        </span>

                        <div
                          class="bar-track"
                        >
                          <div
                            class="bar-fill"
                            style="
                              width:
                              ${(item.count /
              max) *
            100
            }%
                            "
                          ></div>
                        </div>

                        <strong>
                          ${item.count}
                        </strong>
                      </div>
                    `;
        })
        .join('')}
              </div>
            `
      : emptyState(
        'No chapter data yet',
        'Add chapters and members to see distribution.'
      )
    }
      </section>

      <section class="card panel">
        <h3>
          Upcoming Events
        </h3>

        ${upcomingEvents.length
      ? `
              <div class="mini-list">
                ${upcomingEvents
        .map(
          event => `
                      <div class="mini-row">

                        <div>
                          <strong>
                            ${esc(
            event.name
          )}
                          </strong>

                          <div
                            class="muted"
                          >
                            ${esc(
            event.venue ||
            'No venue'
          )}
                          </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span>
                            ${fmtDateTime(
            event.date
          )}
                          </span>
                          <button
                            class="btn"
                            type="button"
                            onclick='viewEvent(${inlineJsArg(event.id)})'
                            style="padding: 3px 8px; font-size: 0.76rem;"
                          >
                            View
                          </button>
                        </div>

                      </div>
                    `
        )
        .join('')}
              </div>
            `
      : emptyState(
        'No upcoming events',
        'Future events you add will appear here.'
      )
    }
      </section>

    </div>

    <div class="grid-2">

      <section class="card panel">
        <h3>
          Recent Events
        </h3>

        ${recentEvents.length
      ? `
              <div class="mini-list">
                ${recentEvents
        .map(
          event => `
                      <div class="mini-row">

                        <div>
                          <strong>
                            ${esc(
            event.name
          )}
                          </strong>

                          <div
                            class="muted"
                          >
                            ${esc(
            event.venue ||
            'No venue'
          )}
                          </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span>
                            ${fmtDate(
            event.date
          )}
                          </span>
                          <button
                            class="btn"
                            type="button"
                            onclick='viewEvent(${inlineJsArg(event.id)})'
                            style="padding: 3px 8px; font-size: 0.76rem;"
                          >
                            View
                          </button>
                        </div>

                      </div>
                    `
        )
        .join('')}
              </div>
            `
      : emptyState(
        'No past events yet',
        'Completed events will appear here automatically.'
      )
    }
      </section>

      <section class="card panel">
        <h3>
          Frontend Status
        </h3>

        <div class="status-list">

          <div>
            <span>
              Clean routes
            </span>

            <strong
              class="status-ok"
            >
              Ready
            </strong>
          </div>

          <div>
            <span>
              Responsive interface
            </span>

            <strong
              class="status-ok"
            >
              Ready
            </strong>
          </div>

          <div>
            <span>
              Browser data persistence
            </span>

            <strong
              class="status-ok"
            >
              Ready
            </strong>
          </div>

          <div>
            <span>
              Cloud backend
            </span>

            <strong
              class="status-pending"
            >
              Future phase
            </strong>
          </div>

        </div>
      </section>

    </div>
  `;
}

// =========================================================
// MEMBERS
// =========================================================

let memberFilters = {
  search: '',
  status: 'All',
  chapter: 'All'
};

function filteredMembers(data) {
  return data.members.filter(member => {
    const haystack = `
      ${member.firstName}
      ${member.middleName || ''}
      ${member.lastName}
      ${member.email || ''}
      ${member.contact || ''}
      ${member.chapterName || ''}
      ${(member.services || []).join(' ')}
    `.toLowerCase();

    if (
      !haystack.includes(
        memberFilters.search.toLowerCase()
      )
    ) {
      return false;
    }

    if (
      memberFilters.status !== 'All' &&
      member.status !== memberFilters.status
    ) {
      return false;
    }

    if (
      memberFilters.chapter !== 'All' &&
      member.chapterName !==
      memberFilters.chapter
    ) {
      return false;
    }

    return true;
  });
}


function renderChapterServantMembers(data) {
  const chapter = scopedChapter(data);

  if (!chapter) {
    content.innerHTML =
      pageHeader(
        'Members',
        'Your account is not assigned to a chapter yet.'
      ) +
      emptyState(
        'No chapter assignment',
        'Ask an Area Servant, LIT Servant, Campus Servant, or Couple Coordinator to assign your account to a chapter.'
      );
    return;
  }

  const chapterMembers = data.members
    .filter(member => String(member.chapterId) === String(chapter.id));

  const list = chapterMembers.filter(member => {
    const haystack = `
      ${member.firstName || ''}
      ${member.middleName || ''}
      ${member.lastName || ''}
      ${member.email || ''}
      ${member.contact || ''}
      ${(member.services || []).join(' ')}
    `.toLowerCase();

    if (!haystack.includes(memberFilters.search.toLowerCase())) {
      return false;
    }

    if (
      memberFilters.status !== 'All' &&
      member.status !== memberFilters.status
    ) {
      return false;
    }

    return true;
  });

  content.innerHTML =
    pageHeader(
      'Members',
      `View members and add new member records for ${esc(chapter.name)} Chapter. Existing records remain view-only for Chapter Servants.`,
      `
        <button class="btn blue" id="addChapterMember" type="button">
          + Add Member
        </button>
        <span class="scope-chip">${esc(chapter.name)} Chapter · View + Add</span>
      `
    ) +
    `
    <div class="toolbar">
      <div class="grow">
        <input
          class="search-input"
          id="memberSearch"
          placeholder="Search ${esc(chapter.name)} members..."
          value="${esc(memberFilters.search)}"
        >
      </div>

      <select
        class="select-input compact-filter"
        id="memberStatus"
      >
        <option>All</option>
        <option ${memberFilters.status === 'Active' ? 'selected' : ''}>Active</option>
        <option ${memberFilters.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
      </select>

      <button class="btn" id="clearMemberFilters">Clear</button>
    </div>

    <div class="result-count">
      Showing ${list.length} of ${chapterMembers.length}
      ${esc(chapter.name)} member${chapterMembers.length === 1 ? '' : 's'}
    </div>

    <section class="card table-wrap">
      ${list.length
        ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Services</th>
                <th>Contact Number</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(member => `
                <tr>
                  <td>
                    <strong>${esc(fullName(member))}</strong>
                    <div class="muted">${esc(member.email || 'No email')}</div>
                  </td>
                  <td>
                    <span class="badge ${member.status === 'Active' ? 'active' : 'inactive'}">
                      ${esc(member.status || 'Active')}
                    </span>
                  </td>
                  <td>${esc((member.services || []).join(', ') || 'No Service Assigned')}</td>
                  <td>${esc(member.contact || '—')}</td>
                  <td class="actions-cell">
                    <button class="btn" onclick='viewMember(${inlineJsArg(member.id)})'>View</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        : emptyState(
            'No matching members',
            chapterMembers.length
              ? 'Change or clear the filters to see other chapter members.'
              : 'This chapter does not have assigned members yet.'
          )
      }
    </section>
  `;

  document.getElementById('addChapterMember').onclick = () => memberModal();

  document.getElementById('memberSearch').oninput = event => {
    memberFilters.search = event.target.value;
    renderMembers();
  };

  document.getElementById('memberStatus').onchange = event => {
    memberFilters.status = event.target.value;
    renderMembers();
  };

  document.getElementById('clearMemberFilters').onclick = () => {
    memberFilters.search = '';
    memberFilters.status = 'All';
    memberFilters.chapter = 'All';
    renderMembers();
  };
}

function renderMembers() {
  const data = db();

  if (isChapterServantSession()) {
    renderChapterServantMembers(data);
    return;
  }

  const list =
    filteredMembers(data);

  content.innerHTML =
    pageHeader(
      'Members',
      'Manage registered MFC Youth members, chapter assignments, services, and GIG records.',
      `
        <button
          class="btn blue"
          id="addMember"
        >
          + Add Member
        </button>
      `
    ) +
    `
    <div class="toolbar">

      <div class="grow">
        <input
          class="search-input"
          id="memberSearch"
          placeholder="Search members, email, contact, chapter, or service..."
          value="${esc(
      memberFilters.search
    )}"
        >
      </div>

      <select
        class="select-input compact-filter"
        id="memberStatus"
      >
        <option>
          All
        </option>

        <option
          ${memberFilters.status ===
      'Active'
      ? 'selected'
      : ''
    }
        >
          Active
        </option>

        <option
          ${memberFilters.status ===
      'Inactive'
      ? 'selected'
      : ''
    }
        >
          Inactive
        </option>
      </select>

      <select
        class="select-input compact-filter"
        id="memberChapter"
      >
        <option>
          All
        </option>

        ${data.chapters
      .map(
        chapter => `
              <option
                ${memberFilters.chapter ===
            chapter.name
            ? 'selected'
            : ''
          }
              >
                ${esc(
            chapter.name
          )}
              </option>
            `
      )
      .join('')}
      </select>

      <button
        class="btn"
        id="clearMemberFilters"
      >
        Clear
      </button>

    </div>

    <div class="result-count">
      Showing
      ${list.length}
      of
      ${data.members.length}
      member${data.members.length === 1
      ? ''
      : 's'}
    </div>

    <section class="card table-wrap">

      ${list.length
      ? `
            <table class="data-table">

              <thead>
                <tr>
                  <th>Member</th>
                  <th>Chapter</th>
                  <th>Status</th>
                  <th>Services</th>
                  <th>Access</th>
                  <th>Contact Number</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                ${list
        .map(
          member => `
                      <tr>

                        <td>
                          <strong>
                            ${esc(
            fullName(
              member
            )
          )}
                          </strong>

                          <div
                            class="muted"
                          >
                            ${esc(
            member.email ||
            'No email'
          )}
                          </div>
                        </td>

                        <td>
                          ${esc(
            member.chapterName ||
            '—'
          )}
                        </td>

                        <td>
                          <span
                            class="badge ${member.status ===
              'Active'
              ? 'active'
              : 'inactive'}"
                          >
                            ${esc(
              member.status ||
              'Active'
            )}
                          </span>
                        </td>

                        <td>
                          ${esc(
              (
                member.services ||
                []
              ).join(
                ', '
              ) ||
              'No Service Assigned'
            )}
                        </td>

                        <td>
                          ${esc(accessRoleLabel(member.accessLevel))}
                        </td>

                        <td>
                          ${esc(
              member.contact ||
              '—'
            )}
                        </td>

                        <td
                          class="actions-cell"
                        >
                          <button
                            class="btn"
                            onclick='viewMember(${inlineJsArg(member.id)})'
                          >
                            View
                          </button>

                          <button
                            class="btn"
                            onclick='editMember(${inlineJsArg(member.id)})'
                          >
                            Edit
                          </button>

                          <button
                            class="btn"
                            onclick='serviceMember(${inlineJsArg(member.id)})'
                          >
                            Services
                          </button>

                          <button
                            class="btn"
                            onclick='gigMember(${inlineJsArg(member.id)})'
                          >
                            GIG
                          </button>

                          ${isOwnMemberRecord(member)
                            ? `
                              <span
                                class="badge active"
                                title="Your own member record cannot be deleted from the Members tab."
                              >
                                Your Account
                              </span>
                            `
                            : `
                              <button
                                class="btn red"
                                onclick='deleteMember(${inlineJsArg(member.id)})'
                              >
                                Delete
                              </button>
                            `}
                        </td>

                      </tr>
                    `
        )
        .join('')}

              </tbody>

            </table>
          `
      : emptyState(
        'No matching members',
        data.members.length
          ? 'Change or clear the filters to see other members.'
          : 'Add the first MFC Youth member to begin managing your Area.'
      )
    }

    </section>
  `;

  document.getElementById(
    'addMember'
  ).onclick = () => memberModal();

  document.getElementById(
    'memberSearch'
  ).oninput = event => {
    memberFilters.search =
      event.target.value;

    renderMembers();
  };

  document.getElementById(
    'memberStatus'
  ).onchange = event => {
    memberFilters.status =
      event.target.value;

    renderMembers();
  };

  document.getElementById(
    'memberChapter'
  ).onchange = event => {
    memberFilters.chapter =
      event.target.value;

    renderMembers();
  };

  document.getElementById(
    'clearMemberFilters'
  ).onclick = () => {
    memberFilters = {
      search: '',
      status: 'All',
      chapter: 'All'
    };

    renderMembers();
  };
}

window.viewMember = function(id) {
  const data = db();

  const member = data.members.find(
    item => String(item.id) === String(id)
  );

  if (!member) return;

  if (
    isChapterServantSession() &&
    !canManageOwnChapterMember(data, member)
  ) {
    toast('You can only view members assigned to your chapter.', 'error');
    return;
  }

  const rows = data.gig
    .filter(item => String(item.memberId) === String(id))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalContributions = rows.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const age = calculateAge(member.birthDate);
  const services = Array.isArray(member.services)
    ? member.services.filter(Boolean).map(String)
    : [];

  const chapterLabel = member.chapterName && String(member.chapterName).trim()
    ? member.chapterName
    : 'No Chapter Assigned';

  const addressLabel = member.address && String(member.address).trim()
    ? member.address
    : 'No Address Provided';

  const serviceList = services.length
    ? `
      <ul class="detail-list">
        ${services
          .map(
            service =>
              `<li class="detail-list-item"><span class="detail-pill">${esc(service)}</span></li>`
          )
          .join('')}
      </ul>
    `
    : '<span class="muted">No Services Assigned</span>';

  const gigHistory = rows.length
    ? `
      <div class="detail-history">
        ${rows
          .map(
            row => `
              <div class="detail-history-item">
                <div class="detail-history-head">
                  <span>${esc(fmtDate(row.date))}</span>
                  <strong>${esc(money(row.amount || 0))}</strong>
                </div>
                <div class="detail-history-note">${esc(row.note || '—')}</div>
              </div>
            `
          )
          .join('')}
      </div>
    `
    : '<span class="muted">No GIG contributions recorded.</span>';

  openModal(
    'Member Details',
    `
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Full Name</span>
          <div class="detail-value">${esc(fullName(member) || '—')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Status</span>
          <div class="detail-value">${esc(member.status || 'Active')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">First Name</span>
          <div class="detail-value">${esc(member.firstName || '—')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Middle Name</span>
          <div class="detail-value">${esc(member.middleName || '—')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Last Name</span>
          <div class="detail-value">${esc(member.lastName || '—')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Current Age</span>
          <div class="detail-value">${age === null ? '—' : esc(String(age))}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Birth Date</span>
          <div class="detail-value">${esc(fmtDate(member.birthDate))}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">First Attended Youth Camp</span>
          <div class="detail-value">${esc(fmtDate(member.firstAttendedYouthCamp))}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Contact Number</span>
          <div class="detail-value">${esc(member.contact || '—')}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Email Address</span>
          <div class="detail-value">
            ${member.email && String(member.email).trim()
              ? `<a href="mailto:${esc(member.email)}">${esc(member.email)}</a>`
              : '<span class="muted">No Email Provided</span>'}
          </div>
        </div>

        <div class="detail-item">
          <span class="detail-label">System Access</span>
          <div class="detail-value">${esc(accessRoleLabel(member.accessLevel))}</div>
        </div>

        <div class="detail-item">
          <span class="detail-label">Chapter</span>
          <div class="detail-value">${esc(chapterLabel)}</div>
        </div>

        <div class="detail-item full">
          <span class="detail-label">Address</span>
          <div class="detail-value">${esc(addressLabel)}</div>
        </div>

        <div class="detail-item full">
          <span class="detail-label">Assigned Services</span>
          <div class="detail-value">${serviceList}</div>
        </div>

        <div class="detail-item full">
          <span class="detail-label">Total GIG Contributions</span>
          <div class="detail-value">
            <div class="detail-total">${esc(money(totalContributions))}</div>
            <div class="detail-section-label">GIG contribution history</div>
            ${gigHistory}
          </div>
        </div>
      </div>
    `
  );
};

function memberModal(id = null) {
  if (id) {
    if (denyUnlessSuperAdmin()) return;
  } else if (!isSuperAdminSession() && !isChapterServantSession()) {
    toast('Only Super Admin access levels and Chapter Servants can add members.', 'error');
    return;
  }

  const data = db();

  const chapterServantChapter = isChapterServantSession()
    ? scopedChapter(data)
    : null;

  if (!id && isChapterServantSession() && !chapterServantChapter) {
    toast('Your account is not assigned to a chapter.', 'error');
    return;
  }

  const member = id
    ? data.members.find(
      item => String(item.id) === String(id)
    )
    : {};

  const body = `
    <div class="form-grid">

      ${field(
    'First Name',
    'mFirst',
    'text',
    member.firstName || '',
    'required maxlength="60"'
  )}

      ${field(
    'Middle Name (optional)',
    'mMiddle',
    'text',
    member.middleName || '',
    'maxlength="60"'
  )}

      ${field(
    'Last Name',
    'mLast',
    'text',
    member.lastName || '',
    'required maxlength="60"'
  )}

      ${field(
    'Birth Date',
    'mBirth',
    'date',
    member.birthDate || '',
    `required max="${todayISO()}"`
  )}

      ${field(
    'First Attended Youth Camp',
    'mFirstYouthCamp',
    'date',
    member.firstAttendedYouthCamp || '',
    `max="${todayISO()}"`
  )}

      ${field(
    'Contact Number',
    'mContact',
    'tel',
    member.contact || '',
    'maxlength="11" inputmode="numeric" placeholder="09XXXXXXXXX" required'
  )}

      ${field(
    'Email Address',
    'mEmail',
    'email',
    member.email || '',
    'required autocomplete="email"'
  )}

      ${selectField(
    'Status',
    'mStatus',
    [
      'Active',
      'Inactive'
    ],
    member.status ||
    'Active'
  )}

      <div class="form-group">
        <label for="mAccessLevel">
          System Access Level
        </label>

        ${isChapterServantSession() && !id
          ? `
            <input
              class="text-input"
              id="mAccessLevelDisplay"
              type="text"
              value="Member"
              readonly
              aria-readonly="true"
            >
            <input id="mAccessLevel" type="hidden" value="member">
            <small class="field-help">
              Chapter Servants can create member accounts, but only Super Admin access levels can grant elevated system access.
            </small>
          `
          : `
            <select
              class="select-input"
              id="mAccessLevel"
            >
              ${ACCESS_LEVELS
                .map(level => `
                  <option
                    value="${level.value}"
                    ${normalizeAccessRole(member.accessLevel || 'member') === level.value ? 'selected' : ''}
                  >
                    ${esc(level.label)}
                  </option>
                `)
                .join('')}
            </select>
            <small class="field-help">
              Chapter Servants are automatically scoped to the chapter selected below.
            </small>
          `}
      </div>

      <div class="form-group">

        <label for="mChapter">
          Chapter
        </label>

        <select
          class="select-input"
          id="mChapter"
        >

          ${chapterServantChapter ? '' : `
            <option value="">
              No Chapter
            </option>
          `}

          ${(chapterServantChapter ? [chapterServantChapter] : data.chapters)
      .map(
        chapter => `
                <option
                  value="${chapter.id}"
                  ${String(member.chapterId) ===
            String(chapter.id)
            ? 'selected'
            : ''
          }
                >
                  ${esc(
            chapter.name
          )}
                </option>
              `
      )
      .join('')}

        </select>

      </div>

      <div
        class="form-group full"
      >

        <label for="mAddress">
          Address
        </label>

        <textarea
          class="textarea-input"
          id="mAddress"
          maxlength="250"
        >${esc(
        member.address || ''
      )}</textarea>

      </div>

    </div>
  `;

  openModal(
    id
      ? 'Edit Member'
      : 'Add Member',

    body,

    async close => {
      const firstName =
        document
          .getElementById('mFirst')
          .value.trim();

      const lastName =
        document
          .getElementById('mLast')
          .value.trim();

      const birthDate =
        document.getElementById(
          'mBirth'
        ).value;

      const contact =
        document
          .getElementById('mContact')
          .value.trim();

      const email =
        document
          .getElementById('mEmail')
          .value.trim()
          .toLowerCase();

      if (
        !firstName ||
        !lastName ||
        !birthDate ||
        !email
      ) {
        toast(
          'First name, last name, birth date, and email address are required.',
          'error'
        );

        return;
      }

      if (
        birthDate > todayISO()
      ) {
        toast(
          'Birth date cannot be in the future.',
          'error'
        );

        return;
      }

      const firstAttendedYouthCamp =
        document.getElementById(
          'mFirstYouthCamp'
        ).value;

      if (
        firstAttendedYouthCamp &&
        firstAttendedYouthCamp > todayISO()
      ) {
        toast(
          'First Attended Youth Camp cannot be in the future.',
          'error'
        );

        return;
      }

      if (
        !/^\d{11}$/.test(
          contact
        )
      ) {
        toast(
          'Contact number must be exactly 11 digits.',
          'error'
        );

        return;
      }

      if (
        !validEmail(email)
      ) {
        toast(
          'Enter a valid email address.',
          'error'
        );

        return;
      }

      if (
        data.members.some(
          item =>
            String(item.id) !== String(id || '') &&
            item.contact === contact
        )
      ) {
        toast(
          'That contact number is already assigned to another member.',
          'error'
        );

        return;
      }

      if (
        email &&
        data.members.some(
          item =>
            String(item.id) !== String(id || '') &&
            (
              item.email || ''
            ).toLowerCase() ===
            email
        )
      ) {
        toast(
          'That email address is already assigned to another member.',
          'error'
        );

        return;
      }

      const chapterId = document.getElementById('mChapter').value || null;

      const chapter = data.chapters.find(
        item => String(item.id) === String(chapterId || '')
      );

      if (
        !id &&
        isChapterServantSession() &&
        (!chapterServantChapter || String(chapterId || '') !== String(chapterServantChapter.id))
      ) {
        toast('You can only add members to your assigned chapter.', 'error');
        return;
      }

      const accessLevel =
        !id && isChapterServantSession()
          ? 'member'
          : normalizeAccessRole(
              document.getElementById(
                'mAccessLevel'
              ).value
            );

      if (
        accessLevel === 'chapter_servant' &&
        !chapter
      ) {
        toast(
          'A Chapter Servant must be assigned to a chapter.',
          'error'
        );

        return;
      }

      const record = {
        id:
          id ||
          uid(),

        firstName,

        middleName:
          document
            .getElementById(
              'mMiddle'
            )
            .value.trim(),

        lastName,

        birthDate,

        firstAttendedYouthCamp,

        contact,

        email,

        status:
          document.getElementById(
            'mStatus'
          ).value,

        accessLevel,

        chapterId,

        chapterName:
          chapter?.name || '',

        address:
          document
            .getElementById(
              'mAddress'
            )
            .value.trim(),

        services:
          member.services || []
      };

      let savedRecord = record;

      if (session?.backendAuth && !session?.demo) {
        try {
          const payload = await backendApi('/api/members', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify({
              ...(id ? { id } : {}),
              firstName: record.firstName,
              middleName: record.middleName,
              lastName: record.lastName,
              birthDate: record.birthDate || null,
              firstAttendedYouthCamp: record.firstAttendedYouthCamp || null,
              contactNumber: record.contact || null,
              email: record.email,
              status: record.status,
              accessLevel: record.accessLevel,
              chapterId: record.chapterId || null,
              address: record.address || null
            })
          });

          savedRecord = cloudMemberToLocal(payload.member, record);

          const existingIndex = data.members.findIndex(item =>
            String(item.id) === String(savedRecord.id) ||
            (savedRecord.email && String(item.email || '').trim().toLowerCase() === savedRecord.email)
          );
          if (existingIndex >= 0) data.members[existingIndex] = savedRecord;
          else data.members.push(savedRecord);

          if (id && String(savedRecord.id) === String(session?.memberId || '')) {
            Object.assign(session, {
              memberId: savedRecord.id,
              name: fullName(savedRecord),
              firstName: savedRecord.firstName || '',
              lastName: savedRecord.lastName || '',
              email: savedRecord.email || session.email,
              role: normalizeAccessRole(savedRecord.accessLevel || session.role),
              chapterId: savedRecord.chapterId ?? null
            });
            updateStoredSession(session);
          }
        } catch (error) {
          toast(error?.message || 'Unable to save this member to Supabase.', 'error');
          return;
        }
      } else if (id) {
        Object.assign(
          data.members.find(item => String(item.id) === String(id)),
          record
        );

      } else {
        data.members.push(record);
      }

      save(data);

      close();

      toast(
        id
          ? 'Member updated.'
          : 'Member added.'
      );

      renderMembers();
    }
  );
}

window.editMember = memberModal;
window.manageAccount = memberModal;
window.assignChapter = memberModal;

window.deleteMember = async id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();
  const member = data.members.find(item => String(item.id) === String(id));
  if (!member) return;

  if (isOwnMemberRecord(member)) {
    toast('You cannot delete your own member record from the Members tab. Use Delete Account only if you intend to permanently remove your account.', 'error');
    return;
  }

  if (!confirm('Delete this member and their GIG contribution records? This cannot be undone.')) return;

  if (member.cloudBacked && session?.backendAuth && !session?.demo) {
    try {
      await backendApi(`/api/members?id=${encodeURIComponent(member.id)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } catch (error) {
      toast(error?.message || 'Unable to delete this member from Supabase.', 'error');
      return;
    }
  } else {
    data.members = data.members.filter(item => String(item.id) !== String(id));
    data.gig = data.gig.filter(item => String(item.memberId) !== String(id));
    data.participants = data.participants.filter(item => String(item.memberId) !== String(id));
    save(data);
  }

  if (String(session?.memberId || '') === String(id)) {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    navigateWithLoader('/', true);
    return;
  }

  toast('Member deleted.');
  renderMembers();
};

window.serviceMember = id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();

  const member =
    data.members.find(
      item => String(item.id) === String(id)
    );

  if (!member) return;

  const currentService = Array.isArray(member.services) && member.services.length
    ? member.services[0]
    : '';

  const checks =
    data.services
      .map(
        service => `
          <label
            class="check-row"
          >
            <input
              type="radio"
              name="serviceAssignment"
              value="${esc(service)}"
              ${currentService === service ? 'checked' : ''}
            >

            ${esc(service)}
          </label>
        `
      )
      .join('');

  openModal(
    `Assign Service - ${esc(
      fullName(member)
    )}`,

    `
      <div
        class="check-grid"
        id="serviceChecks"
      >
        ${checks}
      </div>
    `,

    async close => {
      const selectedService = document.querySelector(
        '#serviceChecks input[name="serviceAssignment"]:checked'
      )?.value || '';
      const selectedServices = selectedService ? [selectedService] : [];

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/services', {
            method: 'PATCH',
            body: JSON.stringify({ memberId: member.id, serviceNames: selectedServices })
          });
          await refreshAllCloudData({ render: false });
        } else {
          member.services = selectedServices;
          save(data);
        }

        close();
        toast('Service updated.');
        renderMembers();
      } catch (error) {
        toast(error?.message || 'Unable to update services.', 'error');
      }
    }
  );
};

window.gigMember = id => {
  const data = db();

  const member =
    data.members.find(
      item => String(item.id) === String(id)
    );

  if (!member) return;

  if (!canManageOwnChapterMember(data, member)) {
    toast('You can only manage GIG records for members in your assigned chapter.', 'error');
    return;
  }

  const rows =
    data.gig
      .filter(
        item =>
          String(item.memberId) === String(id)
      )
      .sort(
        (a, b) =>
          new Date(b.date) -
          new Date(a.date)
      );

  const history =
    rows.length
      ? `
        <div
          class="mini-list gig-history"
        >
          ${rows
        .map(
          row => `
                <div
                  class="mini-row"
                >
                  <span>
                    ${fmtDate(
            row.date
          )}
                    —
                    ${esc(
            row.note ||
            'Contribution'
          )}
                  </span>

                  <span
                    class="inline-actions"
                  >
                    <strong>
                      ${money(
            row.amount
          )}
                    </strong>

                    <button
                      class="mini-delete"
                      type="button"
                      onclick='deleteGigContribution(${inlineJsArg(id)}, ${inlineJsArg(row.id)})'
                      aria-label="Delete contribution"
                    >
                      ×
                    </button>
                  </span>
                </div>
              `
        )
        .join('')}
        </div>
      `
      : `
        <p class="muted">
          No GIG contributions recorded yet.
        </p>
      `;

  openModal(
    `GIG Tracker - ${esc(
      fullName(member)
    )}`,

    `
      <div class="form-grid">

        ${field(
      'Contribution Date',
      'gDate',
      'date',
      todayISO(),
      `max="${todayISO()}"`
    )}

        ${field(
      'Amount',
      'gAmount',
      'number',
      '',
      'min="0.01" step="0.01" placeholder="0.00"'
    )}

        <div
          class="form-group full"
        >
          <label for="gNote">
            Note (optional)
          </label>

          <input
            class="text-input"
            id="gNote"
            maxlength="120"
          >
        </div>

      </div>

      <div class="modal-section">

        <strong>
          Total Contributions:
          ${money(
      rows.reduce(
        (sum, item) =>
          sum +
          Number(
            item.amount || 0
          ),
        0
      )
    )}
        </strong>

        ${history}

      </div>
    `,

    async close => {
      const amount = Number(document.getElementById('gAmount').value);
      const date = document.getElementById('gDate').value;
      const note = document.getElementById('gNote').value.trim();

      if (!date || amount <= 0) {
        toast('Enter a valid contribution date and amount.', 'error');
        return;
      }

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/gig', {
            method: 'POST',
            body: JSON.stringify({ memberId: id, date, amount, note })
          });
          await refreshAllCloudData({ render: false });
        } else {
          data.gig.push({ id: uid(), memberId: id, date, amount, note });
          save(data);
        }

        close();
        toast('GIG contribution added.');
        renderMembers();
      } catch (error) {
        toast(error?.message || 'Unable to save the GIG contribution.', 'error');
      }
    },

    'Add Contribution'
  );
};

window.deleteGigContribution = async (memberId, contributionId) => {
  const accessData = db();
  const accessMember = accessData.members.find(member => String(member.id) === String(memberId));

  if (!canManageOwnChapterMember(accessData, accessMember)) {
    toast('You can only manage GIG records for members in your assigned chapter.', 'error');
    return;
  }
  if (!confirm('Delete this GIG contribution?')) return;

  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi(`/api/gig?id=${encodeURIComponent(contributionId)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } else {
      const data = db();
      data.gig = data.gig.filter(item => String(item.id) !== String(contributionId));
      save(data);
    }

    toast('Contribution deleted.');
    activeModalCleanup?.();
    window.gigMember(memberId);
  } catch (error) {
    toast(error?.message || 'Unable to delete the contribution.', 'error');
  }
};

// =========================================================
// CHAPTERS
// =========================================================

let chapterSearch = '';


function renderChapterServantDashboard(data) {
  const chapter = scopedChapter(data);

  if (!chapter) {
    content.innerHTML =
      pageHeader(
        'Chapter Dashboard',
        'Your Chapter Servant account is not assigned to a chapter yet.'
      ) +
      emptyState(
        'No chapter assignment',
        'Ask an Area Servant, LIT Servant, Campus Servant, or Couple Coordinator to assign your member record to a chapter.'
      );
    return;
  }

  const members = data.members
    .filter(member => String(member.chapterId) === String(chapter.id))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const activeMembers = members.filter(
    member => String(member.status || 'Active') === 'Active'
  );

  const memberIds = new Set(members.map(member => String(member.id)));

  const gigRows = data.gig.filter(
    item => memberIds.has(String(item.memberId))
  );

  const gigTotal = gigRows.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const chapterReports = data.reports
    .filter(report => report.chapter === chapter.name)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const unassignedCount = data.members.filter(isUnassignedMember).length;
  const unassignedLabel = session?.backendAuth && !session?.demo
    ? 'Unassigned members available on demand'
    : `${unassignedCount} unassigned member${unassignedCount === 1 ? '' : 's'} available`;

  content.innerHTML =
    pageHeader(
      `${esc(chapter.name)} Chapter`,
      'Chapter Servant dashboard. Your access is limited to this assigned chapter.',
      `
        <button
          class="btn blue"
          id="chapterAssignMembers"
          type="button"
        >
          + Add Unassigned Members
        </button>
      `
    ) +
    `
    <div class="chapter-scope-banner">
      <div>
        <span class="member-eyebrow">CHAPTER SERVANT ACCESS</span>
        <strong>${esc(chapter.name)} Chapter</strong>
      </div>
      <span class="scope-chip">${esc(unassignedLabel)}</span>
    </div>

    <div class="stat-grid">
      <section class="card stat-card">
        <span>Chapter Members</span>
        <strong>${members.length}</strong>
      </section>

      <section class="card stat-card">
        <span>Active Members</span>
        <strong>${activeMembers.length}</strong>
      </section>

      <section class="card stat-card">
        <span>Activity Reports</span>
        <strong>${chapterReports.length}</strong>
      </section>

      <section class="card stat-card">
        <span>Total Chapter GIG</span>
        <strong>${esc(money(gigTotal))}</strong>
      </section>
    </div>

    <div class="grid-2 chapter-dashboard-grid">
      <section class="card panel">
        <div class="panel-heading-row">
          <div>
            <span class="member-eyebrow">MEMBERS</span>
            <h3>Chapter Roster</h3>
          </div>
          <span class="scope-chip">${members.length} total</span>
        </div>

        ${members.length
          ? `
            <div class="table-wrap chapter-roster-table">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Services</th>
                    <th>GIG</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${members.map(member => {
                    const total = data.gig
                      .filter(item => String(item.memberId) === String(member.id))
                      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

                    return `
                      <tr>
                        <td>
                          <strong>${esc(fullName(member))}</strong>
                          <div class="muted">${esc(member.email || 'No email')}</div>
                        </td>
                        <td>
                          <span class="badge ${member.status === 'Active' ? 'active' : 'inactive'}">
                            ${esc(member.status || 'Active')}
                          </span>
                        </td>
                        <td>${esc((member.services || []).join(', ') || 'No Service Assigned')}</td>
                        <td>${esc(money(total))}</td>
                        <td class="actions-cell">
                          <button class="btn" onclick='viewMember(${inlineJsArg(member.id)})'>View</button>
                          <button class="btn" onclick='gigMember(${inlineJsArg(member.id)})'>GIG</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `
          : emptyState(
              'No chapter members',
              'Use Add Unassigned Members to assign available members to this chapter.'
            )
        }
      </section>

      <section class="card panel">
        <div class="panel-heading-row">
          <div>
            <span class="member-eyebrow">RECENT</span>
            <h3>Chapter Activity</h3>
          </div>
        </div>

        ${chapterReports.length
          ? `
            <div class="chapter-activity-list">
              ${chapterReports.slice(0, 6).map(report => `
                <div class="chapter-activity-item">
                  <div>
                    <strong>${esc(report.title || report.activity || 'Activity')}</strong>
                    <span>${esc(report.type || 'Activity Report')}</span>
                  </div>
                  <time>${esc(fmtDate(report.date))}</time>
                </div>
              `).join('')}
            </div>
          `
          : emptyState(
              'No chapter activity reports',
              'Reports created for this chapter will appear here.'
            )
        }
      </section>
    </div>
  `;

  document.getElementById('chapterAssignMembers')?.addEventListener('click', () => {
    window.addMembersToChapter(chapter.id);
  });
}

function renderChapters() {
  const data = db();

  if (isChapterServantSession()) {
    renderChapterServantDashboard(data);
    return;
  }

  const list =
    data.chapters.filter(
      chapter =>
        chapter.name
          .toLowerCase()
          .includes(
            chapterSearch.toLowerCase()
          )
    );

  content.innerHTML =
    pageHeader(
      'Chapters',
      'Create and manage MFC Youth chapters and view their assigned members.',
      `
        <button
          class="btn blue"
          id="addChapter"
        >
          + Add Chapter
        </button>
      `
    ) +
    `
    <div class="toolbar">

      <div class="grow">
        <input
          class="search-input"
          id="chapterSearch"
          placeholder="Search chapters..."
          value="${esc(
      chapterSearch
    )}"
        >
      </div>

      <button
        class="btn"
        id="clearChapterSearch"
      >
        Clear
      </button>

    </div>

    <div class="result-count">
      Showing
      ${list.length}
      of
      ${data.chapters.length}
      chapter${data.chapters.length === 1
      ? ''
      : 's'
    }
    </div>

    <section class="card table-wrap">

      ${list.length
      ? `
            <table class="data-table">

              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>Member Count</th>
                  <th>Active Members</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                ${list
        .map(
          chapter => {
            const members =
              data.members.filter(
                member =>
                  String(member.chapterId) ===
                  String(chapter.id)
              );

            return `
                        <tr>

                          <td>
                            <strong>
                              ${esc(
              chapter.name
            )}
                            </strong>
                          </td>

                          <td>
                            ${members.length}
                          </td>

                          <td>
                            ${members.filter(
              member =>
                member.status ===
                'Active'
            ).length
              }
                          </td>

                          <td
                            class="actions-cell"
                          >
                            <button
                              class="btn"
                              onclick='viewChapter(${inlineJsArg(chapter.id)})'
                            >
                              View Members
                            </button>

                            <button
                              class="btn"
                              onclick='window.addMembersToChapter(${inlineJsArg(chapter.id)})'
                            >
                              + Add Members
                            </button>

                            <button
                              class="btn"
                              onclick='editChapter(${inlineJsArg(chapter.id)})'
                            >
                              Rename
                            </button>

                            <button
                              class="btn red"
                              onclick='deleteChapter(${inlineJsArg(chapter.id)})'
                            >
                              Delete
                            </button>
                          </td>

                        </tr>
                      `;
          }
        )
        .join('')}

              </tbody>

            </table>
          `
      : emptyState(
        'No matching chapters',
        data.chapters.length
          ? 'Change or clear your search.'
          : 'Add your first chapter.'
      )
    }

    </section>
  `;

  document.getElementById(
    'addChapter'
  ).onclick = () =>
      chapterModal();

  document.getElementById(
    'chapterSearch'
  ).oninput = event => {
    chapterSearch =
      event.target.value;

    renderChapters();
  };

  document.getElementById(
    'clearChapterSearch'
  ).onclick = () => {
    chapterSearch = '';

    renderChapters();
  };
}

function chapterModal(id = null) {
  if (denyUnlessSuperAdmin()) return;

  const data = db();

  const chapter = id
    ? data.chapters.find(
      item => String(item.id) === String(id)
    )
    : {};

  openModal(
    id
      ? 'Rename Chapter'
      : 'Add Chapter',

    field(
      'Chapter Name',
      'cName',
      'text',
      chapter?.name || '',
      'required maxlength="100"'
    ),

    async close => {
      const name = document.getElementById('cName').value.trim();

      if (!name) {
        toast('Chapter name is required.', 'error');
        return;
      }

      if (data.chapters.some(item =>
        String(item.id) !== String(id || '') &&
        item.name.toLowerCase() === name.toLowerCase()
      )) {
        toast('That chapter already exists.', 'error');
        return;
      }

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/chapters', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(id ? { id, name } : { name })
          });
          await refreshAllCloudData({ render: false });
        } else if (id) {
          const oldName = chapter.name;
          chapter.name = name;
          data.members.filter(member => String(member.chapterId) === String(id)).forEach(member => { member.chapterName = name; });
          data.reports.filter(report => report.chapter === oldName).forEach(report => { report.chapter = name; });
          save(data);
        } else {
          data.chapters.push({ id: uid(), name });
          save(data);
        }

        close();
        toast(id ? 'Chapter renamed.' : 'Chapter added.');
        renderChapters();
      } catch (error) {
        toast(error?.message || 'Unable to save the chapter.', 'error');
      }
    }
  );
}

window.editChapter =
  chapterModal;

window.deleteChapter = async id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();
  if (data.members.some(member => String(member.chapterId) === String(id))) {
    alert('Move or remove members from this chapter before deleting it.');
    return;
  }
  if (!confirm('Delete this chapter?')) return;

  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi(`/api/chapters?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } else {
      data.chapters = data.chapters.filter(chapter => String(chapter.id) !== String(id));
      save(data);
    }
    toast('Chapter deleted.');
    renderChapters();
  } catch (error) {
    toast(error?.message || 'Unable to delete the chapter.', 'error');
  }
};

window.viewChapter = id => {
  const data = db();

  const chapter =
    data.chapters.find(
      item => String(item.id) === String(id)
    );

  if (!chapter) return;

  if (
    isChapterServantSession() &&
    String(scopedChapter(data)?.id) !== String(chapter.id)
  ) {
    toast('You can only view your assigned chapter.', 'error');
    return;
  }

  const members =
    data.members.filter(
      member =>
        String(member.chapterId) === String(id)
    );

  openModal(
    `${esc(
      chapter.name
    )} Members`,

    members.length
      ? `
        <div class="mini-list">

          ${members
        .map(
          member => `
                <div class="mini-row">

                  <strong>
                    ${esc(
            fullName(
              member
            )
          )}
                  </strong>

                  <span>
                    ${esc(
            member.chapterName ||
            'No Chapter'
          )}
                  </span>

                </div>
              `
        )
        .join('')}

        </div>
      `
      : emptyState(
        'No members',
        'This chapter has no assigned members yet.'
      )
  );
};


window.addMembersToChapter = async id => {
  const data = db();

  const chapter = data.chapters.find(
    item => String(item.id) === String(id)
  );

  if (!chapter) {
    toast('Chapter could not be found.', 'error');
    return;
  }

  if (isChapterServantSession()) {
    const assignedChapter = scopedChapter(data);

    if (!assignedChapter || String(assignedChapter.id) !== String(chapter.id)) {
      toast('You can only add unassigned members to your assigned chapter.', 'error');
      return;
    }
  } else if (!isSuperAdminSession()) {
    toast('You do not have permission to assign chapter members.', 'error');
    return;
  }

  let unassigned = [];

  try {
    if (session?.backendAuth && !session?.demo) {
      // Chapter Servants intentionally receive only their own chapter roster from
      // /api/members. Fetch the Area's unassigned-member pool only when this
      // assignment dialog is opened, through the scoped backend endpoint.
      const result = await backendApi(
        `/api/chapters/assign-members?chapterId=${encodeURIComponent(chapter.id)}`,
        { timeoutMs: 8000 }
      );

      unassigned = (Array.isArray(result?.members) ? result.members : [])
        .map(row => ({
          id: row.id,
          firstName: row.first_name || '',
          middleName: row.middle_name || '',
          lastName: row.last_name || '',
          email: row.email || '',
          contact: row.contact_number || '',
          status: row.status || 'Active',
          chapterId: null,
          chapterName: '',
          cloudBacked: true
        }))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    } else {
      unassigned = data.members
        .filter(isUnassignedMember)
        .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    }
  } catch (error) {
    toast(error?.message || 'Unable to load unassigned members.', 'error');
    return;
  }

  if (!unassigned.length) {
    openModal(
      `Add Members to ${esc(chapter.name)}`,
      emptyState(
        'No unassigned members',
        'All registered members are already assigned to a chapter.'
      )
    );
    return;
  }

  const memberRows = unassigned
    .map(member => {
      const searchable = [
        member.firstName,
        member.middleName,
        member.lastName,
        member.email,
        member.contact
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return `
        <label
          class="check-row member-check-row"
          data-member-search="${esc(searchable)}"
        >
          <input
            type="checkbox"
            name="chapterMember"
            value="${esc(member.id)}"
          >

          <span>
            <strong>${esc(fullName(member) || 'Unnamed Member')}</strong>
            <small>
              ${esc(member.email || 'No email')}
              ${member.contact ? ` · ${esc(member.contact)}` : ''}
            </small>
          </span>
        </label>
      `;
    })
    .join('');

  openModal(
    `Add Members to ${esc(chapter.name)}`,
    `
      <p class="muted assignment-help">
        Select one or more unassigned members to add to ${esc(chapter.name)} Chapter.
      </p>

      <input
        class="search-input assignment-search"
        id="chapterMemberSearch"
        type="search"
        placeholder="Search unassigned members..."
        autocomplete="off"
      >

      <div class="assignment-list" id="chapterMemberList">
        ${memberRows}
      </div>

      <p class="muted assignment-empty hidden" id="chapterMemberEmpty">
        No unassigned members match your search.
      </p>
    `,
    async close => {
      const selectedIds = [
        ...document.querySelectorAll('input[name="chapterMember"]:checked')
      ].map(input => String(input.value)).filter(Boolean);

      if (!selectedIds.length) {
        toast('Select at least one member.', 'error');
        return;
      }

      try {
        let assignedCount = 0;
        if (session?.backendAuth && !session?.demo) {
          const result = await backendApi('/api/chapters/assign-members', {
            method: 'POST',
            body: JSON.stringify({ chapterId: chapter.id, memberIds: selectedIds })
          });
          assignedCount = Number(result?.assignedCount || 0);
          await refreshAllCloudData({ render: false });
        } else {
          data.members.forEach(member => {
            if (selectedIds.includes(String(member.id)) && isUnassignedMember(member)) {
              member.chapterId = chapter.id;
              member.chapterName = chapter.name;
              assignedCount += 1;
            }
          });
          save(data);
        }

        if (!assignedCount) {
          toast('The selected members are no longer available for assignment.', 'error');
          return;
        }

        close();
        toast(`${assignedCount} member${assignedCount === 1 ? '' : 's'} added to ${chapter.name} Chapter.`);
        renderChapters();
      } catch (error) {
        toast(error?.message || 'Unable to assign the selected members.', 'error');
      }
    },
    'Add Selected Members'
  );

  const searchInput = document.getElementById('chapterMemberSearch');
  const emptyMessage = document.getElementById('chapterMemberEmpty');
  const rows = [
    ...document.querySelectorAll('[data-member-search]')
  ];

  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;

    rows.forEach(row => {
      const matches = !query ||
        (row.dataset.memberSearch || '').includes(query);

      row.classList.toggle('hidden', !matches);
      if (matches) visible += 1;
    });

    emptyMessage?.classList.toggle('hidden', visible !== 0);
  });
};

// =========================================================
// SERVICES
// =========================================================

function renderServices() {
  const data = db();

  content.innerHTML =
    pageHeader(
      'Services',
      'View the seven built-in MFC Youth service roles and assigned members.'
    ) +
    `
    <div class="service-grid">

      ${data.services
      .map(service => {
        const members =
          data.members.filter(
            member =>
              (
                member.services ||
                []
              ).includes(
                service
              )
          );

        return `
            <section
              class="card service-card"
            >

              <h3>
                ${esc(service)}
              </h3>

              <div class="count">
                ${members.length}
              </div>

              <p>
                Assigned member${members.length ===
            1
            ? ''
            : 's'
          }
              </p>

              <button
                class="btn"
                onclick="viewService('${esc(
            service
          ).replace(
            /'/g,
            "\\'"
          )}')"
              >
                View Members
              </button>

            </section>
          `;
      })
      .join('')}

    </div>
  `;
}

window.removeMemberService = async (memberId, serviceName) => {
  if (denyUnlessSuperAdmin()) return;
  const data = db();
  const member = data.members.find(m => String(m.id) === String(memberId));
  if (!member) return;
  if (!confirm(`Remove "${serviceName}" assignment from ${fullName(member)}?`)) return;

  const updatedServices = (member.services || []).filter(s => s !== serviceName);
  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi('/api/services', {
        method: 'PATCH',
        body: JSON.stringify({ memberId: member.id, serviceNames: updatedServices })
      });
      await refreshAllCloudData({ render: false });
    } else {
      member.services = updatedServices;
      save(data);
    }
    toast(`Removed ${serviceName} from ${fullName(member)}.`);
    activeModalCleanup?.();
    window.viewService(serviceName);
    renderServices();
  } catch (error) {
    toast(error?.message || 'Unable to update service assignment.', 'error');
  }
};

window.viewService = service => {
  const data = db();
  const canManage = isSuperAdminSession();

  const members =
    data.members.filter(
      member =>
        (
          member.services || []
        ).includes(service)
    );

  openModal(
    `${esc(service)} Members`,

    members.length
      ? `
        <div class="mini-list">

          ${members
        .map(
          member => `
                <div class="mini-row" style="align-items: center;">

                  <div>
                    <strong>
                      ${esc(
            fullName(
              member
            )
          )}
                    </strong>

                    <div class="muted">
                      ${esc(
            member.chapterName ||
            'No Chapter'
          )}
                    </div>
                  </div>

                  ${canManage
                    ? `
                      <button
                        class="btn red"
                        type="button"
                        onclick='removeMemberService(${inlineJsArg(member.id)}, ${inlineJsArg(service)})'
                        style="padding: 3px 8px; font-size: 0.76rem;"
                        title="Remove ${esc(service)} assignment"
                      >
                        Remove
                      </button>
                    `
                    : ''
                  }

                </div>
              `
        )
        .join('')}

        </div>
      `
      : emptyState(
        'No assigned members',
        'Assign this service from the Members page.'
      )
  );
};

// =========================================================
// REPORTS
// =========================================================

const REPORT_TYPES = [
  'Core Household',
  'Household',
  'Assembly',
  'Fellowship'
];

let reportFilters = {
  search: '',
  chapter: 'All',
  type: 'All',
  from: '',
  to: ''
};

function reportTypes(data) {
  // Get all unique types from existing reports
  const allTypes = [
    ...new Set(
      data.reports
        .map(report => report.type)
        .filter(Boolean)
    )
  ];

  // Separate standard types from legacy types
  const standardTypes = REPORT_TYPES.filter(
    type => allTypes.includes(type)
  );

  const legacyTypes = allTypes.filter(
    type => !REPORT_TYPES.includes(type)
  ).sort();

  // Return standard types first, then legacy types
  return [...standardTypes, ...legacyTypes];
}

function reportChapters(data) {
  const current = data.chapters
    .map(chapter => chapter.name)
    .filter(Boolean);

  const historical = [
    ...new Set(
      data.reports
        .map(report => report.chapter)
        .filter(Boolean)
    )
  ]
    .filter(name => !current.includes(name))
    .sort();

  return { current, historical };
}

function filteredReports(data) {
  const chapterScope = isChapterServantSession()
    ? scopedChapter(data)
    : null;

  return data.reports
    .filter(report => {
      if (
        isChapterServantSession() &&
        (
          !chapterScope ||
          report.chapter !== chapterScope.name
        )
      ) {
        return false;
      }

      const text = `
        ${report.title || ''}
        ${report.activity || ''}
        ${report.preparedBy || ''}
        ${report.description || ''}
        ${report.location || ''}
      `.toLowerCase();

      if (
        !text.includes(
          reportFilters.search.toLowerCase()
        )
      ) {
        return false;
      }

      if (
        reportFilters.chapter !==
        'All' &&
        report.chapter !==
        reportFilters.chapter
      ) {
        return false;
      }

      if (
        reportFilters.type !==
        'All' &&
        report.type !==
        reportFilters.type
      ) {
        return false;
      }

      if (
        reportFilters.from &&
        report.date <
        reportFilters.from
      ) {
        return false;
      }

      if (
        reportFilters.to &&
        report.date >
        reportFilters.to
      ) {
        return false;
      }

      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.date) -
        new Date(a.date)
    );
}

function calculateTotalParticipants(
  reports
) {
  return reports.reduce(
    (sum, report) =>
      sum +
      Number(
        report.participants || 0
      ),
    0
  );
}

function groupActivitiesByType(
  reports
) {
  const map = {};

  reports.forEach(report => {
    const key =
      report.type ||
      'Unspecified';

    if (!map[key]) {
      map[key] = {
        type: key,
        count: 0,
        participants: 0
      };
    }

    map[key].count++;

    map[key].participants +=
      Number(
        report.participants || 0
      );
  });

  return Object.values(map).sort(
    (a, b) =>
      b.count - a.count ||
      b.participants -
      a.participants
  );
}

function groupActivitiesByChapter(
  reports
) {
  const map = {};

  reports.forEach(report => {
    const key =
      report.chapter ||
      'No Chapter';

    if (!map[key]) {
      map[key] = {
        chapter: key,
        count: 0,
        participants: 0
      };
    }

    map[key].count++;

    map[key].participants +=
      Number(
        report.participants || 0
      );
  });

  return Object.values(map).sort(
    (a, b) =>
      b.count - a.count ||
      b.participants -
      a.participants
  );
}

function calculateReportSummary(
  reports
) {
  const totalActivities =
    reports.length;

  const totalParticipants =
    calculateTotalParticipants(
      reports
    );

  return {
    totalActivities,

    totalParticipants,

    averageAttendance:
      totalActivities
        ? Math.round(
          totalParticipants /
          totalActivities
        )
        : 0,

    chaptersInvolved:
      new Set(
        reports
          .map(
            report =>
              report.chapter
          )
          .filter(Boolean)
      ).size,

    activityTypes:
      new Set(
        reports
          .map(
            report =>
              report.type
          )
          .filter(Boolean)
      ).size
  };
}

function generateReportInsights(
  reports
) {
  if (!reports.length) {
    return [];
  }

  const byChapter =
    groupActivitiesByChapter(
      reports
    );

  const byType =
    groupActivitiesByType(
      reports
    );

  const summary =
    calculateReportSummary(
      reports
    );

  const insights = [];

  if (byChapter.length) {
    insights.push(
      `${byChapter[0].chapter} recorded the highest number of activities (${byChapter[0].count}).`
    );
  }

  if (byType.length) {
    insights.push(
      `${byType[0].type} was the most frequently recorded activity type (${byType[0].count}).`
    );
  }

  insights.push(
    `Total recorded participation was ${summary.totalParticipants} across ${summary.totalActivities} activit${summary.totalActivities === 1
      ? 'y'
      : 'ies'
    }.`
  );

  insights.push(
    `Average attendance per recorded activity was approximately ${summary.averageAttendance} participant${summary.averageAttendance === 1
      ? ''
      : 's'
    }.`
  );

  return insights;
}

function reportScopeText() {
  const parts = [];

  if (
    reportFilters.chapter !==
    'All'
  ) {
    parts.push(
      `Chapter: ${reportFilters.chapter}`
    );
  }

  if (
    reportFilters.type !==
    'All'
  ) {
    parts.push(
      `Type: ${reportFilters.type}`
    );
  }

  if (
    reportFilters.from ||
    reportFilters.to
  ) {
    parts.push(
      `Date: ${reportFilters.from
        ? fmtDate(
          reportFilters.from
        )
        : 'Beginning'
      } to ${reportFilters.to
        ? fmtDate(
          reportFilters.to
        )
        : 'Present'
      }`
    );
  }

  if (
    reportFilters.search
  ) {
    parts.push(
      `Search: ${reportFilters.search}`
    );
  }

  return parts.length
    ? parts.join(' | ')
    : 'All Recorded Activities';
}

function renderReports() {
  const data = db();

  const chapterScope = isChapterServantSession()
    ? scopedChapter(data)
    : null;

  if (isChapterServantSession()) {
    if (!chapterScope) {
      content.innerHTML =
        pageHeader(
          'Activity Reports',
          'Your Chapter Servant account is not assigned to a chapter yet.'
        ) +
        emptyState(
          'No chapter assignment',
          'Ask a Super Admin to assign your account to a chapter before creating activity reports.'
        );
      return;
    }

    reportFilters.chapter = chapterScope.name;
  }

  const list =
    filteredReports(data);

  const types =
    reportTypes(data);

  const chapters =
    reportChapters(data);

  const summary =
    calculateReportSummary(
      list
    );

  const months = [
    ...Array(6)
  ].map((_, index) => {
    const date =
      new Date();

    date.setDate(1);

    date.setMonth(
      date.getMonth() -
      (5 - index)
    );

    const count =
      list.filter(report => {
        const rd =
          new Date(
            `${report.date}T00:00:00`
          );

        return (
          rd.getMonth() ===
          date.getMonth() &&
          rd.getFullYear() ===
          date.getFullYear()
        );
      }).length;

    return {
      label:
        date.toLocaleDateString(
          'en',
          {
            month: 'short'
          }
        ),

      count
    };
  });

  const max =
    Math.max(
      ...months.map(
        item => item.count
      ),
      1
    );

  const typeGroups =
    groupActivitiesByType(
      list
    );

  content.innerHTML =
    pageHeader(
      'Activity Reports',
      isChapterServantSession()
        ? `Manage activity reports for ${esc(chapterScope.name)} Chapter. Your name and chapter are locked to your account scope.`
        : 'Manage activity reports, filter records, review analytics, and export summarized documents.',
      `
        <button
          class="btn blue"
          id="addReport"
        >
          + Add Report
        </button>

        <button
          class="btn"
          id="printReports"
        >
          Print Summary
        </button>

        <button
          class="btn"
          id="exportPdfBtn"
        >
          Export PDF
        </button>
      `
    ) +
    `
    <div class="stat-grid">

      <section
        class="card stat-card"
      >
        <span>
          Matching Reports
        </span>

        <strong>
          ${summary.totalActivities}
        </strong>
      </section>

      <section
        class="card stat-card"
      >
        <span>
          Total Participants
        </span>

        <strong>
          ${summary.totalParticipants}
        </strong>
      </section>

      <section
        class="card stat-card"
      >
        <span>
          Chapters Involved
        </span>

        <strong>
          ${summary.chaptersInvolved}
        </strong>
      </section>

      <section
        class="card stat-card"
      >
        <span>
          Average Attendance
        </span>

        <strong>
          ${summary.averageAttendance}
        </strong>
      </section>

    </div>

    <div
      class="toolbar report-toolbar"
    >

      <div class="grow">
        <input
          class="search-input"
          id="reportSearch"
          placeholder="Search title, activity, preparer, location..."
          value="${esc(
      reportFilters.search
    )}"
        >
      </div>

      <select
        class="select-input compact-filter"
        id="reportChapter"
        ${isChapterServantSession() ? 'disabled' : ''}
      >
        <option>
          All
        </option>

        ${chapters.current
      .map(
        chapterName => `
              <option
                value="${esc(chapterName)}"
                ${reportFilters.chapter ===
            chapterName
            ? 'selected'
            : ''
          }
              >
                ${esc(chapterName)}
              </option>
            `
      )
      .join('')}

        ${chapters.historical
      .map(
        chapterName => `
              <option
                value="${esc(chapterName)}"
                ${reportFilters.chapter ===
            chapterName
            ? 'selected'
            : ''
          }
              >
                ${esc(chapterName)} (Historical)
              </option>
            `
      )
      .join('')}
      </select>

      <select
        class="select-input compact-filter"
        id="reportType"
      >
        <option>
          All
        </option>

        ${REPORT_TYPES
      .map(
        type => `
              <option
                ${reportFilters.type ===
            type
            ? 'selected'
            : ''
          }
              >
                ${esc(type)}
              </option>
            `
      )
      .join('')}

        ${(() => {
        // Add any legacy types that don't match standard types
        const legacyTypes = types.filter(
          type => !REPORT_TYPES.includes(type)
        );

        if (legacyTypes.length === 0) {
          return '';
        }

        return legacyTypes
          .map(
            type => `
              <option
                value="${esc(type)}"
                ${reportFilters.type ===
            type
            ? 'selected'
            : ''
          }
              >
                ${esc(type)} (Legacy)
              </option>
            `
          )
          .join('');
      })()}
      </select>

      <label class="date-filter">
        From

        <input
          class="date-input"
          id="reportFrom"
          type="date"
          value="${esc(
        reportFilters.from
      )}"
        >
      </label>

      <label class="date-filter">
        To

        <input
          class="date-input"
          id="reportTo"
          type="date"
          value="${esc(
        reportFilters.to
      )}"
        >
      </label>

      <button
        class="btn"
        id="clearReportFilters"
      >
        Clear
      </button>

    </div>

    <div class="result-count">
      Report scope:
      ${esc(
        reportScopeText()
      )}
    </div>

    <div class="grid-2">

      <section class="card panel">
        <h3>
          Monthly Activity
        </h3>

        <div class="chart-bars">

          ${months
      .map(
        month => `
                <div
                  class="chart-bar-wrap"
                >

                  <div
                    class="chart-value"
                  >
                    ${month.count}
                  </div>

                  <div
                    class="chart-bar"
                    style="
                      height:
                      ${month.count === 0
          ? 0
          : Math.max(
            8,
            (month.count /
              max) *
            125
          )}px
                    "
                  ></div>

                  <span>
                    ${month.label}
                  </span>

                </div>
              `
      )
      .join('')}

        </div>
      </section>

      <section class="card panel">

        <h3>
          Report Type Mix
        </h3>

        ${typeGroups.length
      ? `
              <div class="bar-list">

                ${typeGroups
        .map(
          group => `
                      <div class="bar-row">

                        <span>
                          ${esc(
            group.type
          )}
                        </span>

                        <div
                          class="bar-track"
                        >
                          <div
                            class="bar-fill"
                            style="
                              width:
                              ${(group.count /
              Math.max(
                list.length,
                1
              )) *
            100
            }%
                            "
                          ></div>
                        </div>

                        <strong>
                          ${group.count}
                        </strong>

                      </div>
                    `
        )
        .join('')}

              </div>
            `
      : emptyState(
        'No analytics yet',
        'Add or adjust report filters to see activity totals.'
      )
    }

      </section>

    </div>

    <section
      class="card table-wrap report-table"
    >

      ${list.length
      ? `
            <table class="data-table">

              <thead>
                <tr>
                  <th>Date</th>
                  <th>Report Title</th>
                  <th>Chapter</th>
                  <th>Type</th>
                  <th>Participants</th>
                  <th>Location</th>
                  <th>Prepared By</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                ${list
        .map(
          report => `
                      <tr>

                        <td>
                          ${fmtDate(
            report.date
          )}
                        </td>

                        <td>
                          <strong>
                            ${esc(
            report.title
          )}
                          </strong>

                          <div
                            class="muted"
                          >
                            ${esc(
            report.activity ||
            '—'
          )}
                          </div>
                        </td>

                        <td>
                          ${esc(
            report.chapter ||
            '—'
          )}
                        </td>

                        <td>
                          ${esc(
            report.type ||
            '—'
          )}
                        </td>

                        <td>
                          ${Number(
            report.participants ||
            0
          )}
                        </td>

                        <td>
                          ${esc(
            report.location ||
            '—'
          )}
                        </td>

                        <td>
                          ${esc(
            report.preparedBy ||
            '—'
          )}
                        </td>

                        <td
                          class="actions-cell"
                        >
                          <button
                            class="btn"
                            onclick='viewReport(${inlineJsArg(report.id)})'
                          >
                            View
                          </button>

                          <button
                            class="btn"
                            onclick='reportModal(${inlineJsArg(report.id)})'
                          >
                            Edit
                          </button>

                          <button
                            class="btn red"
                            onclick='deleteReport(${inlineJsArg(report.id)})'
                          >
                            Delete
                          </button>
                        </td>

                      </tr>
                    `
        )
        .join('')}

              </tbody>

            </table>
          `
      : emptyState(
        'No activity reports',
        data.reports.length
          ? 'No records match the selected filters.'
          : 'Add a report to start your analytics.'
      )
    }

    </section>
  `;

  document.getElementById(
    'addReport'
  ).onclick = () =>
      reportModal();

  document.getElementById(
    'printReports'
  ).onclick = () =>
      printReportSummary(data);

  document.getElementById(
    'exportPdfBtn'
  ).onclick = () =>
      exportReportsPdf(data);

  document.getElementById(
    'reportSearch'
  ).oninput = event => {
    reportFilters.search =
      event.target.value;

    renderReports();
  };

  document.getElementById(
    'reportChapter'
  ).onchange = event => {
    reportFilters.chapter =
      event.target.value;

    renderReports();
  };

  document.getElementById(
    'reportType'
  ).onchange = event => {
    reportFilters.type =
      event.target.value;

    renderReports();
  };

  document.getElementById(
    'reportFrom'
  ).onchange = event => {
    reportFilters.from =
      event.target.value;

    if (
      reportFilters.to &&
      reportFilters.from >
      reportFilters.to
    ) {
      reportFilters.to =
        reportFilters.from;
    }

    renderReports();
  };

  document.getElementById(
    'reportTo'
  ).onchange = event => {
    reportFilters.to =
      event.target.value;

    if (
      reportFilters.from &&
      reportFilters.to <
      reportFilters.from
    ) {
      reportFilters.from =
        reportFilters.to;
    }

    renderReports();
  };

  document.getElementById(
    'clearReportFilters'
  ).onclick = () => {
    reportFilters = {
      search: '',
      chapter: isChapterServantSession() && chapterScope
        ? chapterScope.name
        : 'All',
      type: 'All',
      from: '',
      to: ''
    };

    renderReports();
  };
}

window.viewReport = function (id) {
  const data = db();
  const report = data.reports.find(item => String(item.id) === String(id));
  if (!report) return;

  const linkedEvent = report.eventId
    ? data.events.find(e => String(e.id) === String(report.eventId))
    : null;

  const canEdit = !isChapterServantSession() || report.chapter === scopedChapter(data)?.name;

  const body = `
    <div class="detail-grid">
      <div class="detail-item full">
        <span class="detail-label">Report Title</span>
        <div class="detail-value"><strong>${esc(report.title || 'Untitled Report')}</strong></div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Activity Type</span>
        <div class="detail-value"><span class="badge active">${esc(report.type || 'Activity')}</span></div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Chapter</span>
        <div class="detail-value">${esc(report.chapter || '—')}</div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Activity Date</span>
        <div class="detail-value">${esc(fmtDate(report.date))}</div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Location / Venue</span>
        <div class="detail-value">${esc(report.location || '—')}</div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Prepared By</span>
        <div class="detail-value">${esc(report.preparedBy || '—')}</div>
      </div>

      <div class="detail-item">
        <span class="detail-label">Participants</span>
        <div class="detail-value"><strong>${Number(report.participants || 0)}</strong> attendees</div>
      </div>

      <div class="detail-item full">
        <span class="detail-label">Linked Event</span>
        <div class="detail-value">${linkedEvent ? esc(linkedEvent.name) : '<span class="muted">No Linked Event</span>'}</div>
      </div>

      ${report.activity ? `
        <div class="detail-item full">
          <span class="detail-label">Activity Summary</span>
          <div class="detail-value">${esc(report.activity)}</div>
        </div>
      ` : ''}

      <div class="detail-item full">
        <span class="detail-label">Highlights & Narrative</span>
        <div class="detail-value" style="white-space: pre-wrap; line-height: 1.6;">${esc(report.highlights || 'No additional highlights or narrative recorded for this report.')}</div>
      </div>
    </div>

    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line);">
      ${canEdit ? `
        <button class="btn blue" type="button" onclick='activeModalCleanup?.(); reportModal(${inlineJsArg(report.id)})'>
          Edit Report
        </button>
      ` : ''}
    </div>
  `;

  openModal(
    `Activity Report - ${esc(report.title || 'Details')}`,
    body
  );
};

window.reportModal = function (
  id = null
) {
  const data = db();

  const chapterScope = isChapterServantSession()
    ? scopedChapter(data)
    : null;

  if (isChapterServantSession() && !chapterScope) {
    toast('Your account is not assigned to a chapter.', 'error');
    return;
  }

  const report = id
    ? data.reports.find(
      item => String(item.id) === String(id)
    )
    : {};

  if (
    isChapterServantSession() &&
    id &&
    report?.chapter !== chapterScope?.name
  ) {
    toast('You can only edit activity reports for your assigned chapter.', 'error');
    return;
  }

  const linkedEvent =
    report?.eventId
      ? data.events.find(
        event =>
          String(event.id) ===
          String(report.eventId)
      )
      : null;

  const eventOptions = `
    <option value="">
      No Linked Event
    </option>

    ${data.events
      .map(
        event => `
          <option
            value="${event.id}"
            ${String(report?.eventId || '') ===
            String(event.id)
            ? 'selected'
            : ''
          }
          >
            ${esc(
            event.name
          )}
            —
            ${fmtDate(
            event.date
          )}
          </option>
        `
      )
      .join('')}
  `;

  const body = `
    <div class="form-grid">

      ${field(
    'Report Title',
    'rTitle',
    'text',
    report?.title || '',
    'required maxlength="120"'
  )}

      <div class="form-group">

        <label for="rChapter">
          Chapter
        </label>

        <select
          class="select-input"
          id="rChapter"
          ${isChapterServantSession() ? 'disabled' : ''}
        >

          <option value="">
            No Chapter
          </option>

          ${data.chapters
      .map(
        chapter => `
                <option
                  value="${esc(chapter.name)}"
                  ${reportFilters.chapter ===
            chapter.name
            ? 'selected'
            : ''
          }
                >
                  ${esc(
            chapter.name
          )}
                </option>
              `
      )
      .join('')}

          ${(() => {
        const existingChapter = report?.chapter;
        const isHistorical = existingChapter &&
          !data.chapters.some(chapter => chapter.name === existingChapter);

        return isHistorical
          ? `
              <option value="${esc(existingChapter)}" selected>
                ${esc(existingChapter)} (Historical)
              </option>
            `
          : '';
      })()}

        </select>
      </div>

      <div class="form-group">
        <label for="rType">
          Report Type
        </label>

        <select
          class="select-input"
          id="rType"
        >
          <option value="">
            Select Report Type
          </option>

          ${REPORT_TYPES
      .map(
        type => `
              <option
                ${report?.type === type
            ? 'selected'
            : ''
          }
              >
                ${esc(type)}
              </option>
            `
      )
      .join('')}

          ${(() => {
        // Add legacy types if editing an old report with non-standard type
        const existingType = report?.type;

        if (
          existingType &&
          !REPORT_TYPES.includes(
            existingType
          )
        ) {
          return `
                  <option
                    value="${esc(
            existingType
          )}"
                    selected
                  >
                    ${esc(
            existingType
          )} (Legacy)
                  </option>
                `;
        }

        return '';
      })()}

        </select>
      </div>

      ${field(
        'Activity',
        'rActivity',
        'text',
        report?.activity || '',
        'maxlength="120"'
      )}

      ${field(
        'Report Date',
        'rDate',
        'date',
        report?.date ||
        todayISO(),
        `required max="${todayISO()}"`
      )}

      ${field(
        'Prepared By',
        'rPrepared',
        'text',
        isChapterServantSession()
          ? (session?.name || '')
          : (
              report?.preparedBy ||
              session?.name ||
              ''
            ),
        isChapterServantSession()
          ? 'maxlength="100" readonly'
          : 'maxlength="100"'
      )}

      ${field(
        'Participants / Attendance',
        'rParticipants',
        'number',
        report?.participants ?? '',
        'min="0" step="1"'
      )}

      ${field(
        'Location',
        'rLocation',
        'text',
        report?.location ||
        linkedEvent?.venue ||
        '',
        'maxlength="150"'
      )}

      <div class="form-group full">

        <label for="rEvent">
          Linked Event (optional)
        </label>

        <select
          class="select-input"
          id="rEvent"
        >
          ${eventOptions}
        </select>

        <small
          class="field-help"
        >
          Selecting an event can automatically use its venue and current attendance count.
        </small>

      </div>

      <div
        class="form-group full"
      >

        <label for="rDescription">
          Description / Remarks
        </label>

        <textarea
          class="textarea-input"
          id="rDescription"
          maxlength="1000"
        >${esc(
        report?.description ||
        ''
      )}</textarea>

      </div>

    </div>
  `;

  openModal(
    id
      ? 'Edit Activity Report'
      : 'Add Activity Report',

    body,

    async close => {
      const title = document.getElementById('rTitle').value.trim();
      const date = document.getElementById('rDate').value;
      const reportType = document.getElementById('rType').value.trim();
      const participants = Number(document.getElementById('rParticipants').value || 0);

      if (!title || !date) {
        toast('Report title and date are required.', 'error');
        return;
      }
      if (!reportType) {
        toast('Please select a report type.', 'error');
        return;
      }
      const isLegacyTypeBeingPreserved = Boolean(
        id && report?.type && !REPORT_TYPES.includes(report.type) && reportType === report.type
      );
      if (!REPORT_TYPES.includes(reportType) && !isLegacyTypeBeingPreserved) {
        toast('Please select one of the available report types.', 'error');
        return;
      }
      if (date > todayISO()) {
        toast('Report date cannot be in the future.', 'error');
        return;
      }
      if (!Number.isInteger(participants) || participants < 0) {
        toast('Participants must be a whole number of zero or more.', 'error');
        return;
      }

      const chapterName = isChapterServantSession() && chapterScope
        ? chapterScope.name
        : document.getElementById('rChapter').value;
      const chapterId = chapterName
        ? (data.chapters.find(chapter => chapter.name === chapterName)?.id || null)
        : null;
      const eventId = document.getElementById('rEvent').value || null;
      const record = {
        id: id || uid(),
        title,
        chapter: chapterName,
        chapterId,
        type: reportType,
        activity: document.getElementById('rActivity').value.trim(),
        date,
        preparedBy: isChapterServantSession() ? (session?.name || '') : document.getElementById('rPrepared').value.trim(),
        participants,
        location: document.getElementById('rLocation').value.trim(),
        eventId,
        description: document.getElementById('rDescription').value.trim()
      };

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/reports', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify({ ...record, chapterName, id: id || undefined })
          });
          await refreshAllCloudData({ render: false });
        } else if (id) {
          const target = data.reports.find(item => String(item.id) === String(id));
          if (target) Object.assign(target, record);
          save(data);
        } else {
          data.reports.push(record);
          save(data);
        }

        close();
        toast(id ? 'Report updated.' : 'Report added.');
        renderReports();
      } catch (error) {
        toast(error?.message || 'Unable to save the activity report.', 'error');
      }
    }
  );

  const eventSelect =
    document.getElementById(
      'rEvent'
    );

  eventSelect?.addEventListener(
    'change',
    () => {
      const event = data.events.find(
        item => String(item.id) === String(eventSelect.value)
      );

      if (!event) return;

      const eventParticipants =
        data.participants.filter(
          item =>
            String(item.eventId) ===
            String(event.id)
        );

      const attended =
        eventParticipants.filter(
          item =>
            item.attended
        ).length;

      document.getElementById(
        'rLocation'
      ).value =
        event.venue || '';

      document.getElementById(
        'rParticipants'
      ).value =
        eventParticipants.length
          ? attended
          : Number(
            event.peopleAttended ||
            0
          );

      if (
        !document
          .getElementById(
            'rActivity'
          )
          .value.trim()
      ) {
        document.getElementById(
          'rActivity'
        ).value =
          event.name;
      }
    }
  );
};

window.deleteReport = async id => {
  const data = db();

  if (isChapterServantSession()) {
    const chapter = scopedChapter(data);
    const report = data.reports.find(item => String(item.id) === String(id));
    if (!chapter || !report || report.chapter !== chapter.name) {
      toast('You can only delete activity reports for your assigned chapter.', 'error');
      return;
    }
  } else if (!isSuperAdminSession()) {
    toast('You do not have permission to delete activity reports.', 'error');
    return;
  }
  if (!confirm('Delete this activity report?')) return;

  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi(`/api/reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } else {
      data.reports = data.reports.filter(report => String(report.id) !== String(id));
      save(data);
    }
    toast('Report deleted.');
    renderReports();
  } catch (error) {
    toast(error?.message || 'Unable to delete the activity report.', 'error');
  }
};

// =========================================================
// PRINT REPORT SUMMARY
// =========================================================

function printReportSummary(
  data
) {
  const reports =
    filteredReports(data);

  if (!reports.length) {
    toast(
      'No report data is available for the selected filters.',
      'error'
    );

    return;
  }

  const summary =
    calculateReportSummary(
      reports
    );

  const byType =
    groupActivitiesByType(
      reports
    );

  const byChapter =
    groupActivitiesByChapter(
      reports
    );

  const insights =
    generateReportInsights(
      reports
    );

  const win =
    window.open(
      '',
      '_blank',
      'width=1000,height=800'
    );

  if (!win) {
    toast(
      'Allow pop-ups to open the printable report.',
      'error'
    );

    return;
  }

  try {
    win.opener = null;
  } catch {
    // Some browsers do not allow changing opener; printing can still continue.
  }

  const rows =
    reports
      .map(
        report => `
          <tr>
            <td>
              ${fmtDate(
          report.date
        )}
            </td>

            <td>
              ${esc(
          report.title
        )}
            </td>

            <td>
              ${esc(
          report.chapter ||
          '—'
        )}
            </td>

            <td>
              ${esc(
          report.type ||
          '—'
        )}
            </td>

            <td>
              ${Number(
          report.participants ||
          0
        )}
            </td>

            <td>
              ${esc(
          report.location ||
          '—'
        )}
            </td>
          </tr>
        `
      )
      .join('');

  win.document.write(`
    <!doctype html>

    <html>
      <head>

        <title>
          MFC Youth Activity Summary Report
        </title>

        <style>

          body {
            font-family: Arial, sans-serif;
            color: #17263a;
            margin:  36px;
          }

          h1,
          h2 {
            color: #002847;
          }

          h1 {
            font-size: 20px;
            margin-bottom: 2px;
          }

          .sub {
            color: #687386;
          }

          .meta {
            margin: 18px 0;
            padding: 12px;
            background: #f4f7fb;
          }

          .stats {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            margin: 18px 0;
          }

          .stat {
            border: 1px solid #dce3eb;
            padding: 10px;
          }

          .stat strong {
            display: block;
            font-size: 20px;
            color: #002847;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0 22px;
            font-size: 12px;
          }

          th,
          td {
            border: 1px solid #dce3eb;
            padding: 7px;
            text-align: left;
          }

          th {
            background: #eef4f8;
          }

          li {
            margin-bottom: 6px;
          }

          @media print {
            body {
              margin: 18mm;
            }

            .no-print {
              display: none;
            }
          }

        </style>

      </head>

      <body>

        <h1>
          MFC YOUTH
        </h1>

        <div class="sub">
          Area Management System
        </div>

        <h2>
          Activity Summary Report
        </h2>

        <div class="meta">

          <strong>
            Scope:
          </strong>

          ${esc(
    reportScopeText()
  )}

          <br>

          <strong>
            Generated:
          </strong>

          ${esc(
    new Date().toLocaleString(
      'en-PH'
    )
  )}

        </div>

        <div class="stats">

          <div class="stat">
            Activities
            <strong>
              ${summary.totalActivities}
            </strong>
          </div>

          <div class="stat">
            Participants
            <strong>
              ${summary.totalParticipants}
            </strong>
          </div>

          <div class="stat">
            Average
            <strong>
              ${summary.averageAttendance}
            </strong>
          </div>

          <div class="stat">
            Chapters
            <strong>
              ${summary.chaptersInvolved}
            </strong>
          </div>

          <div class="stat">
            Types
            <strong>
              ${summary.activityTypes}
            </strong>
          </div>

        </div>

        <h2>
          Activity Breakdown
        </h2>

        <table>

          <thead>
            <tr>
              <th>
                Type
              </th>

              <th>
                Activities
              </th>

              <th>
                Participants
              </th>
            </tr>
          </thead>

          <tbody>

            ${byType
      .map(
        item => `
                  <tr>

                    <td>
                      ${esc(
          item.type
        )}
                    </td>

                    <td>
                      ${item.count}
                    </td>

                    <td>
                      ${item.participants}
                    </td>

                  </tr>
                `
      )
      .join('')}

          </tbody>

        </table>

        <h2>
          Chapter Summary
        </h2>

        <table>

          <thead>
            <tr>
              <th>
                Chapter
              </th>

              <th>
                Activities
              </th>

              <th>
                Participants
              </th>
            </tr>
          </thead>

          <tbody>

            ${byChapter
      .map(
        item => `
                  <tr>

                    <td>
                      ${esc(
          item.chapter
        )}
                    </td>

                    <td>
                      ${item.count}
                    </td>

                    <td>
                      ${item.participants}
                    </td>

                  </tr>
                `
      )
      .join('')}

          </tbody>

        </table>

        <h2>
          Activity Details
        </h2>

        <table>

          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              <th>Chapter</th>
              <th>Type</th>
              <th>Participants</th>
              <th>Location</th>
            </tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>

        </table>

        <h2>
          Report Insights
        </h2>

        <ul>
          ${insights
      .map(
        insight => `
                <li>
                  ${esc(
          insight
        )}
                </li>
              `
      )
      .join('')}
        </ul>

        <p class="sub">
          Generated by MFC Youth Area Management System
        </p>

        <script>
          window.onload = () => window.print();
        <\/script>

      </body>

    </html>
  `);

  win.document.close();
}

// =========================================================
// EXPORT PDF
// =========================================================

function exportReportsPdf(
  data
) {
  const reports =
    filteredReports(data);

  if (!reports.length) {
    toast(
      'No report data is available for the selected filters.',
      'error'
    );

    return;
  }

  if (
    !window.jspdf?.jsPDF
  ) {
    toast(
      'PDF library failed to load. Check your internet connection and try again.',
      'error'
    );

    return;
  }

  const { jsPDF } =
    window.jspdf;

  const doc =
    new jsPDF({
      unit: 'pt',
      format: 'letter'
    });

  if (
    typeof doc.autoTable !==
    'function'
  ) {
    toast(
      'PDF table library failed to load. Please try again.',
      'error'
    );

    return;
  }

  const summary =
    calculateReportSummary(
      reports
    );

  const byType =
    groupActivitiesByType(
      reports
    );

  const byChapter =
    groupActivitiesByChapter(
      reports
    );

  const insights =
    generateReportInsights(
      reports
    );

  const now =
    new Date();

  let y = 44;

  const left = 42;

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const pageHeight =
    doc.internal.pageSize.getHeight();

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(15);

  doc.text(
    'MFC YOUTH',
    left,
    y
  );

  y += 18;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(10);

  doc.text(
    'Area Management System',
    left,
    y
  );

  y += 24;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(13);

  doc.text(
    'ACTIVITY SUMMARY REPORT',
    left,
    y
  );

  y += 18;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(9);

  doc.text(
    `Generated: ${now.toLocaleString(
      'en-PH'
    )}`,
    left,
    y
  );

  y += 13;

  const scopeLines =
    doc.splitTextToSize(
      `Report Scope: ${reportScopeText()}`,
      pageWidth - 84
    );

  doc.text(
    scopeLines,
    left,
    y
  );

  y +=
    scopeLines.length *
    11 +
    10;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.text(
    'EXECUTIVE SUMMARY',
    left,
    y
  );

  y += 13;

  doc.setFont(
    'helvetica',
    'normal'
  );

  const summaryLines = [
    `Total Activities: ${summary.totalActivities}`,
    `Total Participants: ${summary.totalParticipants}`,
    `Average Attendance: ${summary.averageAttendance}`,
    `Chapters Involved: ${summary.chaptersInvolved}`,
    `Activity Types: ${summary.activityTypes}`
  ];

  summaryLines.forEach(
    line => {
      doc.text(
        line,
        left + 18,
        y
      );

      y += 12;
    }
  );

  y += 8;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.text(
    'ACTIVITY BREAKDOWN',
    left,
    y
  );

  doc.autoTable({
    startY: y + 8,

    margin: {
      left,
      right: left
    },

    head: [
      [
        'Activity Type',
        'Activities',
        'Participants'
      ]
    ],

    body: byType.map(
      item => [
        item.type,
        String(item.count),
        String(
          item.participants
        )
      ]
    ),

    theme: 'grid',

    styles: {
      fontSize: 8.5
    },

    headStyles: {
      fillColor: [
        0,
        40,
        71
      ]
    }
  });

  y =
    doc.lastAutoTable.finalY +
    16;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.text(
    'CHAPTER SUMMARY',
    left,
    y
  );

  doc.autoTable({
    startY: y + 8,

    margin: {
      left,
      right: left
    },

    head: [
      [
        'Chapter',
        'Activities',
        'Participants'
      ]
    ],

    body: byChapter.map(
      item => [
        item.chapter,
        String(item.count),
        String(
          item.participants
        )
      ]
    ),

    theme: 'grid',

    styles: {
      fontSize: 8.5
    },

    headStyles: {
      fillColor: [
        8,
        120,
        189
      ]
    }
  });

  y =
    doc.lastAutoTable.finalY +
    16;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.text(
    'ACTIVITY DETAILS',
    left,
    y
  );

  doc.autoTable({
    startY: y + 8,

    margin: {
      left,
      right: left,
      bottom: 50
    },

    head: [
      [
        'Date',
        'Activity',
        'Chapter',
        'Type',
        'Participants',
        'Location'
      ]
    ],

    body: reports.map(
      report => [
        fmtDate(
          report.date
        ),

        report.title ||
        report.activity ||
        '—',

        report.chapter ||
        '—',

        report.type ||
        '—',

        String(
          Number(
            report.participants ||
            0
          )
        ),

        report.location ||
        '—'
      ]
    ),

    theme: 'striped',

    styles: {
      fontSize: 7.5,
      cellPadding: 4
    },

    headStyles: {
      fillColor: [
        47,
        140,
        90
      ]
    },

    columnStyles: {
      0: {
        cellWidth: 62
      },

      4: {
        cellWidth: 52
      }
    }
  });

  y =
    doc.lastAutoTable.finalY +
    18;

  if (
    y >
    pageHeight - 120
  ) {
    doc.addPage();

    y = 48;
  }

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(9);

  doc.text(
    'REPORT INSIGHTS',
    left,
    y
  );

  y += 13;

  doc.setFont(
    'helvetica',
    'normal'
  );

  insights.forEach(
    insight => {
      const lines =
        doc.splitTextToSize(
          `• ${insight}`,
          pageWidth - 100
        );

      if (
        y +
        lines.length * 11 >
        pageHeight - 55
      ) {
        doc.addPage();

        y = 48;
      }

      doc.text(
        lines,
        left + 12,
        y
      );

      y +=
        lines.length *
        11 +
        3;
    }
  );

  const totalPages =
    doc.getNumberOfPages();

  for (
    let pageNumber = 1;
    pageNumber <= totalPages;
    pageNumber++
  ) {
    doc.setPage(
      pageNumber
    );

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(8);

    doc.setTextColor(90);

    doc.text(
      'MFC Youth Area Management System',
      left,
      pageHeight - 24
    );

    doc.text(
      `Generated ${now.toLocaleDateString(
        'en-PH'
      )}`,
      pageWidth - 170,
      pageHeight - 24
    );

    doc.text(
      `Page ${pageNumber} of ${totalPages}`,
      pageWidth / 2 - 22,
      pageHeight - 24
    );

    doc.setTextColor(0);
  }

  const suffix =
    reportFilters.from ||
      reportFilters.to
      ? `${reportFilters.from ||
      'start'
      }_to_${reportFilters.to ||
      todayISO()
      }`
      : now
        .toISOString()
        .slice(0, 10);

  doc.save(
    `MFCYouth_Activity_Report_${suffix}.pdf`
  );

  toast(
    'PDF report generated.'
  );
}

// =========================================================
// EVENTS
// =========================================================

let eventFilters = {
  search: '',
  timing: 'All'
};

function filteredEvents(data) {
  const now =
    Date.now();

  const filtered = data.events
    .filter(event => {
      const match = `
        ${event.name || ''}
        ${event.venue || ''}
        ${event.description || ''}
      `
        .toLowerCase()
        .includes(
          eventFilters.search.toLowerCase()
        );

      if (!match) {
        return false;
      }

      const time =
        new Date(
          event.date
        ).getTime();

      if (
        eventFilters.timing ===
        'Upcoming' &&
        time < now
      ) {
        return false;
      }

      if (
        eventFilters.timing ===
        'Past' &&
        time >= now
      ) {
        return false;
      }

      return true;
    });

  return filtered.sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();

    return eventFilters.timing === 'Upcoming'
      ? aTime - bTime
      : bTime - aTime;
  });
}

function eventAttendance(
  data,
  event
) {
  const participants =
    data.participants.filter(
      participant =>
        String(participant.eventId) ===
        String(event.id)
    );

  const attended =
    participants.filter(
      participant =>
        participant.attended
    ).length;

  return participants.length
    ? attended
    : Number(
      event.peopleAttended ||
      0
    );
}

function renderEvents() {
  const data = db();

  const canManage = isSuperAdminSession();

  const list =
    filteredEvents(data);

  const now =
    Date.now();

  content.innerHTML =
    pageHeader(
      'Events',
      canManage
        ? 'Manage Area events, participant registration, payment status, and attendance.'
        : 'View Area events. Chapter Servants have read-only event access.',
      canManage
        ? `
          <button
            class="btn blue"
            id="addEvent"
          >
            + Add Event
          </button>
        `
        : `<span class="scope-chip">View Only</span>`
    ) +
    `
    <div class="toolbar">

      <div class="grow">
        <input
          class="search-input"
          id="eventSearch"
          placeholder="Search events or venues..."
          value="${esc(
      eventFilters.search
    )}"
        >
      </div>

      <select
        class="select-input compact-filter"
        id="eventTiming"
      >
        <option>
          All
        </option>

        <option
          ${eventFilters.timing ===
      'Upcoming'
      ? 'selected'
      : ''
    }
        >
          Upcoming
        </option>

        <option
          ${eventFilters.timing ===
      'Past'
      ? 'selected'
      : ''
    }
        >
          Past
        </option>
      </select>

      <button
        class="btn"
        id="clearEventFilters"
      >
        Clear
      </button>

    </div>

    <div class="result-count">
      Showing
      ${list.length}
      of
      ${data.events.length}
      event${data.events.length === 1
      ? ''
      : 's'
    }
    </div>

    <section
      class="card table-wrap"
    >

      ${list.length
      ? `
            <table class="data-table">

              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Status</th>
                  <th>Fee</th>
                  <th>Registered</th>
                  <th>Attended</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                ${list
        .map(
          event => {
            const participants =
              data.participants.filter(
                participant =>
                  String(participant.eventId) ===
                  String(event.id)
              );

            const upcoming =
              new Date(
                event.date
              ).getTime() >=
              now;

            return `
                        <tr>

                          <td>
                            ${fmtDateTime(
              event.date
            )}
                          </td>

                          <td>
                            <strong>
                              ${esc(
              event.name
            )}
                            </strong>
                          </td>

                          <td>
                            ${esc(
              event.venue ||
              '—'
            )}
                          </td>

                          <td>
                            <span
                              class="badge ${upcoming
                ? 'pending'
                : 'active'
              }"
                            >
                              ${upcoming
                ? 'Upcoming'
                : 'Completed'
              }
                            </span>
                          </td>

                          <td>
                            ${Number(
                event.fee
              ) > 0
                ? money(
                  event.fee
                )
                : 'Free'
              }
                          </td>

                          <td>
                            ${participants.length}
                          </td>

                          <td>
                            ${eventAttendance(
                data,
                event
              )}
                          </td>

                          <td
                            class="actions-cell"
                          >
                            <button
                              class="btn"
                              onclick='viewEvent(${inlineJsArg(event.id)})'
                            >
                              View
                            </button>

                            ${canManage
                              ? `
                                <button
                                  class="btn"
                                  onclick='eventModal(${inlineJsArg(event.id)})'
                                >
                                  Edit
                                </button>

                                <button
                                  class="btn red"
                                  onclick='deleteEvent(${inlineJsArg(event.id)})'
                                >
                                  Delete
                                </button>
                              `
                              : ''
                            }
                          </td>

                        </tr>
                      `;
          }
        )
        .join('')}

              </tbody>

            </table>
          `
      : emptyState(
        'No matching events',
        data.events.length
          ? 'Change or clear the event filters.'
          : 'Add your first Area event.'
      )
    }

    </section>
  `;

  const addEventButton =
    document.getElementById(
      'addEvent'
    );

  if (addEventButton) {
    addEventButton.onclick = () =>
      eventModal();
  }

  document.getElementById(
    'eventSearch'
  ).oninput = event => {
    eventFilters.search =
      event.target.value;

    renderEvents();
  };

  document.getElementById(
    'eventTiming'
  ).onchange = event => {
    eventFilters.timing =
      event.target.value;

    renderEvents();
  };

  document.getElementById(
    'clearEventFilters'
  ).onclick = () => {
    eventFilters = {
      search: '',
      timing: 'All'
    };

    renderEvents();
  };
}

window.eventModal = function (
  id = null
) {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can create or edit Area events.')) return;

  const data = db();

  const event = id
    ? data.events.find(
      item => String(item.id) === String(id)
    )
    : {};

  const body = `
    <div class="form-grid">

      ${field(
    'Event Name',
    'eName',
    'text',
    event?.name || '',
    'required maxlength="120"'
  )}

      ${field(
    'Date & Time',
    'eDate',
    'datetime-local',
    event?.date || '',
    'required'
  )}

      ${field(
    'Registration Fee',
    'eFee',
    'number',
    event?.fee || 0,
    'min="0" step="0.01"'
  )}

      ${field(
    'Venue',
    'eVenue',
    'text',
    event?.venue || '',
    'maxlength="150"'
  )}

      ${field(
    'Manual Attendance (fallback)',
    'eAttended',
    'number',
    event?.peopleAttended ||
    0,
    'min="0" step="1"'
  )}

      <div class="form-group">

        <label for="eDescription">
          Event Description
        </label>

        <textarea
          class="textarea-input"
          id="eDescription"
          maxlength="1000"
        >${esc(
    event?.description ||
    ''
  )}</textarea>

        <small
          class="field-help"
        >
          Manual attendance is used only when the event has no registered participant records.
        </small>

      </div>

    </div>
  `;

  openModal(
    id
      ? 'Edit Event'
      : 'Add Event',

    body,

    async close => {
      const name = document.getElementById('eName').value.trim();
      const date = document.getElementById('eDate').value;
      const attendance = Number(document.getElementById('eAttended').value || 0);

      if (!name || !date) {
        toast('Event name and date are required.', 'error');
        return;
      }
      if (!Number.isInteger(attendance) || attendance < 0) {
        toast('Manual attendance must be a whole number of zero or more.', 'error');
        return;
      }

      const record = {
        id: id || uid(),
        name,
        date,
        fee: Number(document.getElementById('eFee').value || 0),
        venue: document.getElementById('eVenue').value.trim(),
        peopleAttended: attendance,
        description: document.getElementById('eDescription').value.trim()
      };

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/events', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify({ ...record, id: id || undefined })
          });
          await refreshAllCloudData({ render: false });
        } else if (id) {
          const target = data.events.find(item => String(item.id) === String(id));
          if (target) Object.assign(target, record);
          save(data);
        } else {
          data.events.push(record);
          save(data);
        }

        close();
        toast(id ? 'Event updated.' : 'Event added.');
        renderEvents();
      } catch (error) {
        toast(error?.message || 'Unable to save the event.', 'error');
      }
    }
  );
};

window.deleteEvent = async id => {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can delete Area events.')) return;
  if (!confirm('Delete this event and all of its participant records?')) return;

  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi(`/api/events?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } else {
      const data = db();
      data.events = data.events.filter(event => String(event.id) !== String(id));
      data.participants = data.participants.filter(participant => String(participant.eventId) !== String(id));
      data.reports.forEach(report => {
        if (String(report.eventId || '') === String(id)) report.eventId = null;
      });
      save(data);
    }
    toast('Event deleted.');
    renderEvents();
  } catch (error) {
    toast(error?.message || 'Unable to delete the event.', 'error');
  }
};

window.viewEvent = id => {
  const data = db();
  const canManage = isSuperAdminSession();

  const event =
    data.events.find(
      item => String(item.id) === String(id)
    );

  if (!event) return;

  const participants =
    data.participants.filter(
      participant =>
        String(participant.eventId) === String(id)
    );

  const paid =
    participants.filter(
      participant =>
        participant.paymentStatus ===
        'Paid'
    ).length;

  const attended =
    participants.filter(
      participant =>
        participant.attended
    ).length;

  const participantTable =
    participants.length
      ? `
        <div class="table-wrap">

          <table
            class="data-table compact-table"
          >

            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Chapter</th>
                <th>Service</th>
                <th>Payment</th>
                <th>Attendance</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>

              ${participants
        .map(
          participant => {
            const member = participantMember(data, participant);
            const age = member
              ? calculateAge(member.birthDate)
              : participant.age || null;
            const chapter = member
              ? member.chapterName
              : participant.chapter;
            const services = member
              ? (member.services || []).join(', ')
              : participant.service;

            return `
                    <tr>

                      <td>
                        ${esc(participantName(data, participant) || '—')}
                      </td>

                      <td>
                        ${age === null || age === undefined || age === ''
              ? '—'
              : esc(String(age))}
                      </td>

                      <td>
                        ${esc(chapter || '—')}
                      </td>

                      <td>
                        ${esc(services || '—')}
                      </td>

                      <td>
                        <span class="badge ${participant.paymentStatus ===
              'Paid'
              ? 'paid'
              : 'unpaid'
            }">
                          ${esc(
              participant.paymentStatus || 'Unpaid'
            )}
                        </span>
                      </td>

                      <td>
                        <span class="badge ${participant.attended
              ? 'attended'
              : 'pending'
            }">
                          ${participant.attended
              ? 'Attended'
              : 'Not Yet'
            }
                        </span>
                      </td>

                      <td
                        class="actions-cell"
                      >
                        ${canManage
                          ? `
                            <button
                              class="btn"
                              onclick='participantModal(${inlineJsArg(id)}, ${inlineJsArg(participant.id)})'
                            >
                              Edit
                            </button>

                            <button
                              class="btn red"
                              onclick='deleteParticipant(${inlineJsArg(id)}, ${inlineJsArg(participant.id)})'
                            >
                              Delete
                            </button>
                          `
                          : '<span class="muted">View only</span>'
                        }
                      </td>

                    </tr>
                  `;
          }
        )
        .join('')}

            </tbody>

          </table>

        </div>
      `
      : emptyState(
        'No participants yet',
        'Register the first participant for this event.'
      );

  const body = `
    <div class="event-summary">

      <div>
        <span>
          Date & Time
        </span>

        <strong>
          ${fmtDateTime(
    event.date
  )}
        </strong>
      </div>

      <div>
        <span>
          Venue
        </span>

        <strong>
          ${esc(
    event.venue ||
    '—'
  )}
        </strong>
      </div>

      <div>
        <span>
          Registration Fee
        </span>

        <strong>
          ${Number(
    event.fee
  ) > 0
      ? money(
        event.fee
      )
      : 'Free'
    }
        </strong>
      </div>

      <div>
        <span>
          Registered
        </span>

        <strong>
          ${participants.length}
        </strong>
      </div>

      <div>
        <span>
          Paid
        </span>

        <strong>
          ${paid}
        </strong>
      </div>

      <div>
        <span>
          Attended
        </span>

        <strong>
          ${participants.length
      ? attended
      : Number(
        event.peopleAttended ||
        0
      )
    }
        </strong>
      </div>

    </div>

    ${event.description
      ? `
          <p class="event-description">
            ${esc(
        event.description
      )}
          </p>
        `
      : ''
    }

    <div class="modal-section-heading">

      <h3>
        Participants
        (${participants.length})
      </h3>

      ${canManage
        ? `
          <button
            class="btn blue"
            type="button"
            onclick='participantModal(${inlineJsArg(id)})'
          >
            + Register Participant
          </button>
        `
        : '<span class="scope-chip">View Only</span>'
      }

    </div>

    ${participantTable}
  `;

  openModal(
    esc(event.name),
    body
  );
};

window.participantModal = (
  eventId,
  id = null
) => {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can manage event participants.')) return;

  const data = db();

  const participant = id
    ? data.participants.find(
      item => String(item.id) === String(id)
    )
    : null;

  const linkedMember = participant
    ? participantMember(data, participant)
    : null;

  const registeredMemberIds = new Set(
    data.participants
      .filter(item =>
        String(item.eventId) === String(eventId) &&
        String(item.id) !== String(id || '') &&
        item.memberId !== null &&
        item.memberId !== undefined
      )
      .map(item => String(item.memberId))
  );

  const availableMembers = data.members
    .filter(member => !registeredMemberIds.has(String(member.id)))
    .sort((a, b) =>
      fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' })
    );

  const memberSummary = member => `
    <div class="participant-member-summary">
      <strong>${esc(fullName(member) || 'Unnamed Member')}</strong>
      <span>${esc(member.chapterName || 'No Chapter')} · ${esc(member.contact || 'No Contact')}</span>
      <small>${esc(member.status || 'Active')}${(member.services || []).length
        ? ` · ${esc((member.services || []).join(', '))}`
        : ''}</small>
    </div>
  `;

  let memberSection = '';

  if (id) {
    if (linkedMember) {
      memberSection = `
        <div class="form-group full">
          <label>Registered Member</label>
          <div class="participant-selected-member">
            ${memberSummary(linkedMember)}
          </div>
        </div>
      `;
    } else {
      memberSection = `
        <div class="form-group full">
          <label>Registered Member</label>
          <div class="participant-selected-member legacy">
            <div class="participant-member-summary">
              <strong>${esc(participantName(data, participant) || 'Legacy Participant')}</strong>
              <span>Historical participant record</span>
              <small>The original member record is no longer available. Payment and attendance can still be updated.</small>
            </div>
          </div>
        </div>
      `;
    }
  } else if (availableMembers.length) {
    memberSection = `
      <div class="form-group full">
        <label for="participantMemberSearch">Registered Member</label>
        <input
          class="search-input participant-member-search"
          id="participantMemberSearch"
          type="search"
          placeholder="Search registered members..."
          autocomplete="off"
        >

        <div class="participant-member-list" id="participantMemberList">
          ${availableMembers
            .map(
              member => `
                <label
                  class="participant-member-option"
                  data-participant-member-search="${esc(`
                    ${fullName(member)}
                    ${member.chapterName || ''}
                    ${member.contact || ''}
                    ${(member.services || []).join(' ')}
                    ${member.status || ''}
                  `.toLowerCase().replace(/\s+/g, ' ').trim())}"
                >
                  <input
                    type="radio"
                    name="pMember"
                    value="${member.id}"
                  >
                  ${memberSummary(member)}
                </label>
              `
            )
            .join('')}
        </div>

        <p class="muted participant-member-empty hidden" id="participantMemberEmpty">
          No registered members match your search.
        </p>
      </div>
    `;
  } else {
    memberSection = `
      <div class="form-group full">
        <label>Registered Member</label>
        <div class="participant-member-notice">
          ${data.members.length
            ? 'All registered members are already participants in this event.'
            : 'There are no registered members yet. Add a member in the Members tab first.'}
        </div>
      </div>
    `;
  }

  const body = `
    <div class="form-grid">

      ${memberSection}

      ${selectField(
        'Mode of Payment',
        'pMode',
        [
          'Cash',
          'GCash',
          'Bank Transfer',
          'Other'
        ],
        participant?.paymentMode ||
        'Cash'
      )}

      ${selectField(
        'Payment Status',
        'pPay',
        [
          'Unpaid',
          'Paid'
        ],
        participant?.paymentStatus ||
        'Unpaid'
      )}

      <div
        class="form-group full"
      >

        <label
          class="check-row"
        >
          <input
            type="checkbox"
            id="pAttended"
            ${participant?.attended
      ? 'checked'
      : ''
    }
          >

          Mark as attended
        </label>

      </div>

    </div>
  `;

  openModal(
    id
      ? 'Edit Participant'
      : 'Register Participant',

    body,

    async close => {
      let member = linkedMember;

      if (!id) {
        const selectedMember = document.querySelector('input[name="pMember"]:checked');
        if (!selectedMember) {
          toast(data.members.length ? 'Select a registered member.' : 'Add a member in the Members tab before registering a participant.', 'error');
          return;
        }
        member = data.members.find(item => String(item.id) === String(selectedMember.value));
        if (!member) {
          toast('The selected member could not be found. Refresh and try again.', 'error');
          return;
        }
        if (data.participants.some(item =>
          String(item.eventId) === String(eventId) &&
          String(item.id) !== String(id || '') &&
          String(item.memberId) === String(member.id)
        )) {
          toast('That member is already registered for this event.', 'error');
          return;
        }
      }

      const record = {
        id: id || uid(),
        eventId,
        memberId: member?.id ?? participant?.memberId ?? null,
        first: member?.firstName ?? participant?.first ?? '',
        last: member?.lastName ?? participant?.last ?? '',
        mi: member?.middleName ? String(member.middleName).trim().charAt(0).toUpperCase() : participant?.mi ?? '',
        age: member ? calculateAge(member.birthDate) || 0 : participant?.age || 0,
        contact: member?.contact ?? participant?.contact ?? '',
        address: member?.address ?? participant?.address ?? '',
        chapter: member?.chapterName ?? participant?.chapter ?? '',
        service: member ? (member.services || []).join(', ') : participant?.service ?? '',
        paymentMode: document.getElementById('pMode').value,
        paymentStatus: document.getElementById('pPay').value,
        attended: document.getElementById('pAttended').checked
      };

      try {
        if (session?.backendAuth && !session?.demo) {
          await backendApi('/api/participants', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify({ ...record, id: id || undefined })
          });
          await refreshAllCloudData({ render: false });
        } else if (id) {
          const target = data.participants.find(item => String(item.id) === String(id));
          if (!target) {
            toast('Participant record could not be found.', 'error');
            return;
          }
          Object.assign(target, record);
          save(data);
        } else {
          data.participants.push(record);
          save(data);
        }

        close();
        toast(id ? 'Participant updated.' : 'Participant registered.');
        window.viewEvent(eventId);
      } catch (error) {
        toast(error?.message || 'Unable to save the participant.', 'error');
      }
    }
  );

  if (!id) {
    const searchInput = document.getElementById('participantMemberSearch');
    const emptyMessage = document.getElementById('participantMemberEmpty');
    const rows = [
      ...document.querySelectorAll('[data-participant-member-search]')
    ];

    searchInput?.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      let visible = 0;

      rows.forEach(row => {
        const matches = !query ||
          (row.dataset.participantMemberSearch || '').includes(query);

        row.classList.toggle('hidden', !matches);
        if (matches) visible += 1;
      });

      emptyMessage?.classList.toggle('hidden', visible !== 0);
    });
  }
};

window.deleteParticipant = async (eventId, id) => {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can manage event participants.')) return;
  if (!confirm('Delete this participant?')) return;

  try {
    if (session?.backendAuth && !session?.demo) {
      await backendApi(`/api/participants?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAllCloudData({ render: false });
    } else {
      const data = db();
      data.participants = data.participants.filter(participant => String(participant.id) !== String(id));
      save(data);
    }
    toast('Participant deleted.');
    activeModalCleanup?.();
    window.viewEvent(eventId);
  } catch (error) {
    toast(error?.message || 'Unable to delete the participant.', 'error');
  }
};


// =========================================================
// AREA ONBOARDING FOR NEW SERVANT LEADER ACCOUNTS
// =========================================================

function isLeadershipSession() {
  return ['couple_coordinator', 'area_servant', 'lit_servant', 'campus_servant', 'chapter_servant'].includes(
    String(session?.role || '').trim().toLowerCase()
  );
}

async function showAreaOnboarding() {
  if (
    page !== 'dashboard' ||
    session?.demo ||
    !session?.backendAuth ||
    !isLeadershipSession() ||
    (session?.areaId && !session?.needsAreaSetup)
  ) {
    return;
  }

  const root = document.getElementById('modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop area-onboarding-backdrop" id="areaOnboardingBackdrop">
      <section class="modal area-onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="areaOnboardingTitle">
        <header class="modal-header area-onboarding-header">
          <div>
            <span class="area-onboarding-kicker">Account Setup</span>
            <h2 id="areaOnboardingTitle">Select Your MFC Youth Area</h2>
          </div>
        </header>
        <div class="modal-body">
          <p class="area-onboarding-intro">
            Your Servant Leader account was created successfully. Before entering the management system, connect it to the Area you serve.
          </p>
          <div id="areaOnboardingMessage"></div>

          <div class="area-setup-panel" id="existingAreaPanel">
            <label class="form-group" for="onboardingAreaSelect">
              <span>Existing Area</span>
              <select class="text-input" id="onboardingAreaSelect" disabled>
                <option value="">Loading Areas…</option>
              </select>
            </label>
            <button class="btn blue" id="confirmAreaButton" type="button" disabled>Continue with Selected Area</button>
          </div>

          <div class="area-onboarding-divider"><span>or</span></div>

          <button class="btn area-create-toggle" id="showCreateAreaButton" type="button">Create Area-Based Account</button>

          <div class="area-setup-panel hidden" id="createAreaPanel">
            <label class="form-group" for="newAreaName">
              <span>Area Name</span>
              <input class="text-input" id="newAreaName" type="text" maxlength="120" placeholder="e.g. MFC Youth NCR East">
            </label>
            <p class="field-help">The backend will create the Area in Supabase and connect this account to it. Standard service records will also be prepared for the new Area.</p>
            <div class="area-create-actions">
              <button class="btn" id="cancelCreateAreaButton" type="button">Cancel</button>
              <button class="btn blue" id="createAreaButton" type="button">Create Area-Based Account</button>
            </div>
          </div>

          ${session?.role === 'chapter_servant' ? `
            <p class="area-chapter-note">Chapter Servant accounts will still need a Chapter assignment inside this Area before chapter-scoped tools become available.</p>
          ` : ''}
        </div>
      </section>
    </div>
  `;

  const message = document.getElementById('areaOnboardingMessage');
  const select = document.getElementById('onboardingAreaSelect');
  const confirmButton = document.getElementById('confirmAreaButton');
  const showCreateButton = document.getElementById('showCreateAreaButton');
  const createPanel = document.getElementById('createAreaPanel');
  const existingPanel = document.getElementById('existingAreaPanel');
  const createButton = document.getElementById('createAreaButton');
  const cancelCreateButton = document.getElementById('cancelCreateAreaButton');
  const newAreaName = document.getElementById('newAreaName');

  const showAreaMessage = (text, type = 'error') => {
    if (!message) return;
    message.innerHTML = `<div class="message ${type}" role="status">${esc(text)}</div>`;
  };

  const finishAreaSetup = (area, profile = null, member = null) => {
    const updated = {
      ...session,
      areaId: area.id,
      areaName: area.name,
      memberId: profile?.member_id ?? member?.id ?? session?.memberId ?? null,
      chapterId: profile?.chapter_id ?? session?.chapterId ?? null,
      needsAreaSetup: false
    };
    updateStoredSession(updated);

    if (session.role === 'chapter_servant') {
      navigateWithLoader('/chapters', true);
    } else {
      navigateWithLoader('/dashboard', true);
    }
  };

  try {
    const payload = await backendApi('/api/areas');
    const areas = Array.isArray(payload?.areas) ? payload.areas : [];
    select.innerHTML = `
      <option value="">Select your Area</option>
      ${areas.map(area => `<option value="${esc(area.id)}">${esc(area.name)}</option>`).join('')}
    `;
    select.disabled = false;
    confirmButton.disabled = false;

    if (!areas.length) {
      showAreaMessage('No Area records are available yet. Create the first Area-Based Account below.', 'success');
    }
  } catch (error) {
    select.innerHTML = '<option value="">Unable to load Areas</option>';
    showAreaMessage(error?.message || 'Unable to retrieve Areas from the backend.');
  }

  confirmButton?.addEventListener('click', async () => {
    const areaId = select?.value || '';
    if (!areaId) {
      showAreaMessage('Select an Area before continuing.');
      return;
    }

    const original = confirmButton.textContent;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Connecting…';
    try {
      const payload = await backendApi('/api/areas/select', {
        method: 'POST',
        body: JSON.stringify({ areaId })
      });
      showAreaMessage(`Connected to ${payload.area.name}.`, 'success');
      setTimeout(() => finishAreaSetup(payload.area, payload.profile, payload.member), 350);
    } catch (error) {
      confirmButton.disabled = false;
      confirmButton.textContent = original;
      showAreaMessage(error?.message || 'Unable to connect this account to the selected Area.');
    }
  });

  showCreateButton?.addEventListener('click', () => {
    createPanel?.classList.remove('hidden');
    existingPanel?.classList.add('area-setup-muted');
    showCreateButton.classList.add('hidden');
    newAreaName?.focus();
  });

  cancelCreateButton?.addEventListener('click', () => {
    createPanel?.classList.add('hidden');
    existingPanel?.classList.remove('area-setup-muted');
    showCreateButton?.classList.remove('hidden');
    if (newAreaName) newAreaName.value = '';
  });

  createButton?.addEventListener('click', async () => {
    const name = String(newAreaName?.value || '').trim();
    if (name.length < 3) {
      showAreaMessage('Enter a valid Area name.');
      return;
    }

    const original = createButton.textContent;
    createButton.disabled = true;
    createButton.textContent = 'Creating Area…';
    try {
      const payload = await backendApi('/api/areas', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      showAreaMessage(`${payload.area.name} was created and linked to your account.`, 'success');
      setTimeout(() => finishAreaSetup(payload.area, payload.profile, payload.member), 400);
    } catch (error) {
      createButton.disabled = false;
      createButton.textContent = original;
      const existing = error?.body?.existingArea;
      if (existing?.id) {
        showAreaMessage('That Area already exists. Select it from the Existing Area list instead.');
      } else {
        showAreaMessage(error?.message || 'Unable to create the Area.');
      }
    }
  });
}

// =========================================================
// PAGE RENDER
// =========================================================

const renderers = {
  dashboard: renderDashboard,
  members: renderMembers,
  chapters: renderChapters,
  services: renderServices,
  reports: renderReports,
  events: renderEvents
};

function renderPageFailure(error) {
  console.error('Page render failed:', error);

  if (!content) return;

  content.removeAttribute('aria-busy');
  content.innerHTML = `
    <section class="card page-load-error" role="alert">
      <h2>We couldn't finish loading this page.</h2>
      <p>Your data was not changed. You can safely try loading the page again.</p>
      <button class="btn blue" id="retryPageLoad" type="button">Try Again</button>
    </section>
  `;

  document.getElementById('retryPageLoad')?.addEventListener('click', () => {
    try {
      window.location.reload();
    } catch (reloadError) {
      console.error('Reload failed:', reloadError);
    }
  });
}

function renderPageSafely() {
  try {
    const renderer = renderers[page] || renderDashboard;
    renderer();
    content?.removeAttribute('aria-busy');
    window.MFCPageSkeleton?.clear?.();
    return true;
  } catch (error) {
    renderPageFailure(error);
    return false;
  }
}

async function refreshCloudDataInBackground() {
  try {
    await refreshAllCloudData({ render: true });
  } catch (error) {
    // Cached data remains usable when the network is unavailable. Supabase is
    // still the source of truth and will reconcile on the next successful sync.
    console.warn('Background cloud sync skipped:', error?.message || error);
  }
}

function scheduleBackgroundSync() {
  const run = () => {
    refreshCloudDataInBackground().catch(error => {
      console.warn('Background refresh failed:', error?.message || error);
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 450 });
  } else {
    window.setTimeout(run, 80);
  }
}

async function bootstrapApplication() {
  try {
    // Render immediately from cached/browser data so page switching never waits
    // for Supabase/network synchronization.
    const rendered = renderPageSafely();
    if (!rendered) return;

    try {
      await showAreaOnboarding();
    } catch (error) {
      console.warn('Area onboarding check skipped:', error?.message || error);
    }

    scheduleBackgroundSync();
  } catch (error) {
    renderPageFailure(error);
  }
}

window.addEventListener('error', event => {
  console.error('Unhandled page error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled async error:', event.reason);
});

bootstrapApplication().catch(error => {
  renderPageFailure(error);
});
