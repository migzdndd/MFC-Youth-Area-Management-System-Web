// =========================================================
// MFC Youth Area Management System - Frontend Application
// Browser-only data layer currently active. Backend Phase 6.1 lives under /api; page-by-page migration will replace db()/save().
// =========================================================

const DB_KEY = 'mfc_web_database_v1';
const SESSION_KEY = 'mfc_demo_session';
const USER_KEY = 'mfc_demo_users';
const DB_VERSION = 6;
let activeModalCleanup = null;

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
  const response = await fetch(path, {
    ...options,
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

function denyUnlessSuperAdmin(message = 'Only Couple Coordinators, Area Servants, and LIT Servants can perform this action.') {
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


// =========================================================
// FRONTEND ACCOUNT PROVISIONING
// Member records are the source of truth. Adding a member creates a linked
// linked account with a one-time temporary password. In production this must be
// moved to the backend and passwords must be hashed, never stored in plaintext.
// =========================================================

function getAuthUsers() {
  const users = safeParse(localStorage.getItem(USER_KEY) || '[]', []);
  return Array.isArray(users) ? users : [];
}

function saveAuthUsers(users) {
  localStorage.setItem(USER_KEY, JSON.stringify(users));
}

function authEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function findMemberAccount(member, users = getAuthUsers()) {
  if (!member) return null;

  const byMemberId = users.find(
    user => user.memberId !== null && user.memberId !== undefined && String(user.memberId) === String(member.id)
  );
  if (byMemberId) return byMemberId;

  const email = authEmail(member.email);
  if (!email) return null;

  return users.find(
    user =>
      authEmail(user.email) === email &&
      (
        ACCESS_ROLE_VALUES.has(String(user.role || '').trim().toLowerCase()) ||
        String(user.role || '').trim().toLowerCase() === 'area_admin' ||
        (user.role || 'legacy') === 'legacy'
      )
  ) || null;
}

function accountEmailConflict(email, memberId = null) {
  const normalized = authEmail(email);
  if (!normalized) return null;

  if (normalized === 'admin@mfcyouth.local') {
    return 'That email is reserved for the built-in administrator account.';
  }

  const conflict = getAuthUsers().find(user => {
    if (authEmail(user.email) !== normalized) return false;

    // The account already linked to this member is allowed.
    if (
      memberId !== null &&
      memberId !== undefined &&
      user.memberId !== null &&
      user.memberId !== undefined &&
      String(user.memberId) === String(memberId)
    ) {
      return false;
    }

    // Old unlinked public-signup accounts can be claimed by an administrator
    // when the matching member is added. Their password will be reset.
    if ((user.role || 'legacy') === 'legacy' && (user.memberId === null || user.memberId === undefined)) {
      return false;
    }

    return true;
  });

  return conflict ? 'That email address is already being used by another login account.' : null;
}

function generateTemporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const randomInt = max => {
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] % max;
    }
    return Math.floor(Math.random() * max);
  };

  let password = `M${letters[randomInt(letters.length)]}${digits[randomInt(digits.length)]}`;
  for (let i = 0; i < 7; i += 1) {
    password += all[randomInt(all.length)];
  }
  return password;
}

function provisionMemberAccount(member, { resetPassword = false } = {}) {
  if (!member?.email) {
    throw new Error('A valid email address is required to create an account login.');
  }

  const users = getAuthUsers();
  let account = findMemberAccount(member, users);
  const wasUnlinked = !account || account.memberId === null || account.memberId === undefined || account.role === 'legacy';
  const issueTemporaryPassword = resetPassword || wasUnlinked;
  const temporaryPassword = issueTemporaryPassword ? generateTemporaryPassword() : null;
  const now = new Date().toISOString();

  if (!account) {
    account = {
      id: uid(),
      createdAt: now
    };
    users.push(account);
  }

  Object.assign(account, {
    memberId: member.id,
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    name: fullName(member),
    email: authEmail(member.email),
    role: normalizeAccessRole(member.accessLevel),
    chapterId: member.chapterId ?? null,
    isActive: String(member.status || 'Active') !== 'Inactive',
    updatedAt: now
  });

  if (temporaryPassword) {
    account.password = temporaryPassword;
    account.mustChangePassword = true;
    account.temporaryPasswordIssuedAt = now;
  } else if (account.mustChangePassword === undefined) {
    account.mustChangePassword = false;
  }

  saveAuthUsers(users);
  return { account, temporaryPassword, created: wasUnlinked };
}

function syncMemberAccount(member) {
  const users = getAuthUsers();
  const account = findMemberAccount(member, users);
  if (!account) return false;

  Object.assign(account, {
    memberId: member.id,
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    name: fullName(member),
    email: authEmail(member.email),
    role: normalizeAccessRole(member.accessLevel),
    chapterId: member.chapterId ?? null,
    isActive: String(member.status || 'Active') !== 'Inactive',
    updatedAt: new Date().toISOString()
  });
  saveAuthUsers(users);
  return true;
}

function removeMemberAccount(memberId) {
  const users = getAuthUsers().filter(
    user => String(user.memberId) !== String(memberId)
  );
  saveAuthUsers(users);
}

function memberAccountState(member) {
  const account = findMemberAccount(member);
  if (!account) return { label: 'Not Provisioned', className: 'inactive' };
  if (account.isActive === false) return { label: 'Disabled', className: 'inactive' };
  if (account.mustChangePassword) return { label: 'Temporary Password', className: 'pending' };
  return { label: 'Active', className: 'active' };
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
        const eventId = report.eventId
          ? Number(report.eventId)
          : null;

        const linkedParticipants = eventId
          ? participants.filter(
            item => Number(item.eventId) === eventId
          )
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
      : []
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

function uid() {
  return Date.now() + Math.floor(Math.random() * 10000);
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

function showTemporaryCredentials(member, temporaryPassword) {
  if (!member || !temporaryPassword) return;

  openModal(
    'Account Login Created',
    `
      <div class="credential-panel">
        <div class="credential-notice">
          <strong>Give these temporary credentials to ${esc(fullName(member))}.</strong>
          <p>The member must change this password immediately after the first successful login.</p>
        </div>

        <div class="credential-row">
          <span>Email</span>
          <code>${esc(member.email)}</code>
        </div>

        <div class="credential-row">
          <span>Access Level</span>
          <code>${esc(accessRoleLabel(member.accessLevel))}</code>
        </div>

        <div class="credential-row">
          <span>Temporary Password</span>
          <code>${esc(temporaryPassword)}</code>
        </div>

        <button class="btn blue" id="copyMemberCredentials" type="button">
          Copy Credentials
        </button>

        <p class="field-help">
          Frontend prototype only: credentials are stored locally in this browser. Production authentication must use a secure backend and hashed passwords.
        </p>
      </div>
    `
  );

  const copyButton = document.getElementById('copyMemberCredentials');
  if (copyButton) {
    copyButton.onclick = async () => {
      const text = `MFC Youth Account Login\nEmail: ${member.email}\nAccess Level: ${accessRoleLabel(member.accessLevel)}\nTemporary Password: ${temporaryPassword}\n\nPlease change your password after signing in.`;
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = 'Copied!';
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        copyButton.textContent = 'Copied!';
      }
    };
  }
}

window.manageMemberLogin = id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();
  const member = data.members.find(item => item.id === id);
  if (!member) return;

  if (!member.email || !validEmail(member.email)) {
    toast('Add a valid email address to this member before creating a login.', 'error');
    return;
  }

  const conflict = accountEmailConflict(member.email, member.id);
  if (conflict) {
    toast(conflict, 'error');
    return;
  }

  const existing = findMemberAccount(member);
  const action = existing ? 'reset' : 'create';
  const prompt = existing
    ? `Reset the account login for ${fullName(member)}? Their current password will stop working and a new temporary password will be issued.`
    : `Create an account login for ${fullName(member)}? A temporary password will be issued.`;

  if (!confirm(prompt)) return;

  const result = provisionMemberAccount(member, { resetPassword: true });
  renderMembers();
  toast(action === 'reset' ? 'Account login reset.' : 'Account login created.');
  showTemporaryCredentials(member, result.temporaryPassword);
};

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

  const cards = [
    [
      'members',
      'Total Members',
      data.members.length,
      'People currently on record'
    ],

    [
      'chapters',
      'Chapters',
      data.chapters.length,
      'Registered chapters'
    ],

    [
      'services',
      'Services',
      data.services.length,
      'Available service roles'
    ],

    [
      'reports',
      'Activity Reports',
      data.reports.length,
      'Reports currently filed'
    ],

    [
      'events',
      'Events',
      data.events.length,
      'Events currently recorded'
    ]
  ];

  const chapterCounts =
    data.chapters
      .map(chapter => ({
        name: chapter.name,

        count: data.members.filter(
          member =>
            member.chapterId ===
            chapter.id
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

  const activeMembers =
    data.members.filter(
      member =>
        member.status === 'Active'
    ).length;

  const attended =
    data.participants.filter(
      participant =>
        participant.attended
    ).length;

  content.innerHTML =
    pageHeader(
      'Dashboard',
      `Welcome, ${esc(
        session?.name || 'Area User'
      )}. Here is a quick overview of your Area records.`
    ) +
    `
    <section>
      <div class="section-heading">
        <h2>Area Summary</h2>

        <p>
          Current totals across your browser records
        </p>

        <div class="section-line"></div>
      </div>

      <div class="summary-card card">
        ${cards
      .map(
        card => `
              <article
                class="summary-item ${card[0]}"
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
              </article>
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
          ${data.participants.length}
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

                        <span>
                          ${fmtDateTime(
            event.date
          )}
                        </span>

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

                        <span>
                          ${fmtDate(
            event.date
          )}
                        </span>

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
        'Ask an Area Servant, LIT Servant, or Couple Coordinator to assign your account to a chapter.'
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
                    <button class="btn" onclick="viewMember(${member.id})">View</button>
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
                  <th>Account</th>
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
                          <span class="badge ${memberAccountState(member).className}">
                            ${esc(memberAccountState(member).label)}
                          </span>
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
                            onclick="viewMember(${member.id})"
                          >
                            View
                          </button>

                          <button
                            class="btn"
                            onclick="editMember(${member.id})"
                          >
                            Edit
                          </button>

                          <button
                            class="btn"
                            onclick="serviceMember(${member.id})"
                          >
                            Services
                          </button>

                          <button
                            class="btn"
                            onclick="gigMember(${member.id})"
                          >
                            GIG
                          </button>

                          <button
                            class="btn"
                            onclick="manageMemberLogin(${member.id})"
                          >
                            Login
                          </button>

                          <button
                            class="btn red"
                            onclick="deleteMember(${member.id})"
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
    item => item.id === id
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
    .filter(item => item.memberId === id)
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
          <span class="detail-label">Login Account</span>
          <div class="detail-value">
            <span class="badge ${memberAccountState(member).className}">${esc(memberAccountState(member).label)}</span>
          </div>
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
      item => item.id === id
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
                  ${member.chapterId ===
            chapter.id
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

    close => {
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

      const loginConflict = accountEmailConflict(email, id);

      if (loginConflict) {
        toast(loginConflict, 'error');
        return;
      }

      if (
        data.members.some(
          item =>
            item.id !== id &&
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
            item.id !== id &&
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

      const chapterId =
        Number(
          document.getElementById(
            'mChapter'
          ).value
        ) || null;

      const chapter =
        data.chapters.find(
          item =>
            item.id === chapterId
        );

      if (
        !id &&
        isChapterServantSession() &&
        (!chapterServantChapter || chapterId !== chapterServantChapter.id)
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

      let provisionResult = null;

      if (id) {
        Object.assign(
          data.members.find(
            item =>
              item.id === id
          ),
          record
        );

        // Existing linked accounts follow member profile/email/status changes.
        // Older member records without an account are provisioned the first
        // time an administrator saves them.
        if (findMemberAccount(record)) {
          syncMemberAccount(record);
        } else {
          provisionResult = provisionMemberAccount(record);
        }
      } else {
        data.members.push(
          record
        );

        // New member = new login account. This removes the old conflict where
        // a person could exist separately in Members and public registration.
        provisionResult = provisionMemberAccount(record);
      }

      save(data);

      close();

      toast(
        id
          ? 'Member updated.'
          : 'Member added and login account created.'
      );

      renderMembers();

      if (provisionResult?.temporaryPassword) {
        showTemporaryCredentials(record, provisionResult.temporaryPassword);
      }
    }
  );
}

window.editMember =
  memberModal;

window.deleteMember = id => {
  if (denyUnlessSuperAdmin()) return;

  if (
    !confirm(
      'Delete this member, their linked login account, and their GIG contribution records?'
    )
  ) {
    return;
  }

  const data = db();

  data.members =
    data.members.filter(
      item => item.id !== id
    );

  data.gig =
    data.gig.filter(
      item =>
        item.memberId !== id
    );

  removeMemberAccount(id);

  save(data);

  toast(
    'Member deleted.'
  );

  renderMembers();
};

window.serviceMember = id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();

  const member =
    data.members.find(
      item => item.id === id
    );

  if (!member) return;

  const checks =
    data.services
      .map(
        service => `
          <label
            class="check-row"
          >
            <input
              type="checkbox"
              value="${esc(
          service
        )}"
              ${(
            member.services ||
            []
          ).includes(
            service
          )
            ? 'checked'
            : ''
          }
            >

            ${esc(service)}
          </label>
        `
      )
      .join('');

  openModal(
    `Assign Services - ${esc(
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

    close => {
      member.services = [
        ...document.querySelectorAll(
          '#serviceChecks input:checked'
        )
      ].map(
        input =>
          input.value
      );

      save(data);

      close();

      toast(
        'Services updated.'
      );

      renderMembers();
    }
  );
};

window.gigMember = id => {
  const data = db();

  const member =
    data.members.find(
      item => item.id === id
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
          item.memberId === id
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
                      onclick="deleteGigContribution(${id}, ${row.id})"
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

    close => {
      const amount =
        Number(
          document.getElementById(
            'gAmount'
          ).value
        );

      const date =
        document.getElementById(
          'gDate'
        ).value;

      if (
        !date ||
        amount <= 0
      ) {
        toast(
          'Enter a valid contribution date and amount.',
          'error'
        );

        return;
      }

      data.gig.push({
        id: uid(),

        memberId: id,

        date,

        amount,

        note:
          document
            .getElementById(
              'gNote'
            )
            .value.trim()
      });

      save(data);

      close();

      toast(
        'GIG contribution added.'
      );

      renderMembers();
    },

    'Add Contribution'
  );
};

window.deleteGigContribution = (
  memberId,
  contributionId
) => {
  const accessData = db();
  const accessMember = accessData.members.find(
    member => String(member.id) === String(memberId)
  );

  if (!canManageOwnChapterMember(accessData, accessMember)) {
    toast('You can only manage GIG records for members in your assigned chapter.', 'error');
    return;
  }

  if (
    !confirm(
      'Delete this GIG contribution?'
    )
  ) {
    return;
  }

  const data = db();

  data.gig =
    data.gig.filter(
      item =>
        item.id !==
        contributionId
    );

  save(data);

  toast(
    'Contribution deleted.'
  );

  activeModalCleanup?.();

  window.gigMember(
    memberId
  );
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
        'Ask an Area Servant, LIT Servant, or Couple Coordinator to assign your member record to a chapter.'
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
      <span class="scope-chip">${unassignedCount} unassigned member${unassignedCount === 1 ? '' : 's'} available</span>
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
                          <button class="btn" onclick="viewMember(${member.id})">View</button>
                          <button class="btn" onclick="gigMember(${member.id})">GIG</button>
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
                  member.chapterId ===
                  chapter.id
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
                              onclick="viewChapter(${chapter.id})"
                            >
                              View Members
                            </button>

                            <button
                              class="btn"
                              onclick="window.addMembersToChapter(${chapter.id})"
                            >
                              + Add Members
                            </button>

                            <button
                              class="btn"
                              onclick="editChapter(${chapter.id})"
                            >
                              Rename
                            </button>

                            <button
                              class="btn red"
                              onclick="deleteChapter(${chapter.id})"
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
      item => item.id === id
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

    close => {
      const name =
        document
          .getElementById('cName')
          .value.trim();

      if (!name) {
        toast(
          'Chapter name is required.',
          'error'
        );

        return;
      }

      if (
        data.chapters.some(
          item =>
            item.id !== id &&
            item.name.toLowerCase() ===
            name.toLowerCase()
        )
      ) {
        toast(
          'That chapter already exists.',
          'error'
        );

        return;
      }

      if (id) {
        const oldName =
          chapter.name;

        chapter.name =
          name;

        data.members
          .filter(
            member =>
              member.chapterId === id
          )
          .forEach(member => {
            member.chapterName =
              name;
          });

        data.reports
          .filter(
            report =>
              report.chapter ===
              oldName
          )
          .forEach(report => {
            report.chapter =
              name;
          });

        data.participants
          .filter(
            participant =>
              participant.chapter ===
              oldName
          )
          .forEach(participant => {
            participant.chapter =
              name;
          });
      } else {
        data.chapters.push({
          id: uid(),
          name
        });
      }

      save(data);

      close();

      toast(
        id
          ? 'Chapter renamed.'
          : 'Chapter added.'
      );

      renderChapters();
    }
  );
}

window.editChapter =
  chapterModal;

window.deleteChapter = id => {
  if (denyUnlessSuperAdmin()) return;

  const data = db();

  if (
    data.members.some(
      member =>
        member.chapterId === id
    )
  ) {
    alert(
      'Move or remove members from this chapter before deleting it.'
    );

    return;
  }

  if (
    confirm(
      'Delete this chapter?'
    )
  ) {
    data.chapters =
      data.chapters.filter(
        chapter =>
          chapter.id !== id
      );

    save(data);

    toast(
      'Chapter deleted.'
    );

    renderChapters();
  }
};

window.viewChapter = id => {
  const data = db();

  const chapter =
    data.chapters.find(
      item => item.id === id
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
        member.chapterId === id
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


window.addMembersToChapter = id => {
  const data = db();

  const chapter = data.chapters.find(
    item => item.id === id
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

  const unassigned = data.members
    .filter(isUnassignedMember)
    .sort((a, b) =>
      fullName(a).localeCompare(fullName(b))
    );

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
            value="${member.id}"
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
    close => {
      const selectedIds = [
        ...document.querySelectorAll(
          'input[name="chapterMember"]:checked'
        )
      ]
        .map(input => Number(input.value))
        .filter(Number.isFinite);

      if (!selectedIds.length) {
        toast('Select at least one member.', 'error');
        return;
      }

      let assignedCount = 0;

      data.members.forEach(member => {
        if (
          selectedIds.includes(member.id) &&
          isUnassignedMember(member)
        ) {
          member.chapterId = chapter.id;
          member.chapterName = chapter.name;
          syncMemberAccount(member);
          assignedCount += 1;
        }
      });

      if (!assignedCount) {
        toast('The selected members are no longer available for assignment.', 'error');
        return;
      }

      save(data);
      close();

      toast(
        `${assignedCount} member${assignedCount === 1 ? '' : 's'} added to ${chapter.name} Chapter.`
      );

      renderChapters();
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

window.viewService = service => {
  const data = db();

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
                            onclick="reportModal(${report.id})"
                          >
                            Edit
                          </button>

                          <button
                            class="btn red"
                            onclick="deleteReport(${report.id})"
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
      item => item.id === id
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
          event.id ===
          report.eventId
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
            ${report?.eventId ===
            event.id
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
                  ${(report?.chapter || chapterScope?.name) ===
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

    close => {
      const title =
        document
          .getElementById('rTitle')
          .value.trim();

      const date =
        document.getElementById(
          'rDate'
        ).value;

      const reportType =
        document
          .getElementById('rType')
          .value.trim();

      const participants =
        Number(
          document.getElementById(
            'rParticipants'
          ).value || 0
        );

      if (
        !title ||
        !date
      ) {
        toast(
          'Report title and date are required.',
          'error'
        );

        return;
      }

      if (!reportType) {
        toast(
          'Please select a report type.',
          'error'
        );

        return;
      }

      const isLegacyTypeBeingPreserved =
        Boolean(
          id &&
          report?.type &&
          !REPORT_TYPES.includes(report.type) &&
          reportType === report.type
        );

      if (
        !REPORT_TYPES.includes(reportType) &&
        !isLegacyTypeBeingPreserved
      ) {
        toast(
          'Please select one of the available report types.',
          'error'
        );

        return;
      }

      if (
        date > todayISO()
      ) {
        toast(
          'Report date cannot be in the future.',
          'error'
        );

        return;
      }

      if (
        !Number.isInteger(
          participants
        ) ||
        participants < 0
      ) {
        toast(
          'Participants must be a whole number of zero or more.',
          'error'
        );

        return;
      }

      const eventId =
        Number(
          document.getElementById(
            'rEvent'
          ).value
        ) || null;

      const record = {
        id:
          id ||
          uid(),

        title,

        chapter:
          isChapterServantSession() && chapterScope
            ? chapterScope.name
            : document.getElementById(
                'rChapter'
              ).value,

        type:
          document
            .getElementById(
              'rType'
            )
            .value.trim(),

        activity:
          document
            .getElementById(
              'rActivity'
            )
            .value.trim(),

        date,

        preparedBy:
          isChapterServantSession()
            ? (session?.name || '')
            : document
                .getElementById(
                  'rPrepared'
                )
                .value.trim(),

        participants,

        location:
          document
            .getElementById(
              'rLocation'
            )
            .value.trim(),

        eventId,

        description:
          document
            .getElementById(
              'rDescription'
            )
            .value.trim()
      };

      if (id) {
        Object.assign(
          data.reports.find(
            item =>
              item.id === id
          ),
          record
        );
      } else {
        data.reports.push(
          record
        );
      }

      save(data);

      close();

      toast(
        id
          ? 'Report updated.'
          : 'Report added.'
      );

      renderReports();
    }
  );

  const eventSelect =
    document.getElementById(
      'rEvent'
    );

  eventSelect?.addEventListener(
    'change',
    () => {
      const event =
        data.events.find(
          item =>
            item.id ===
            Number(
              eventSelect.value
            )
        );

      if (!event) return;

      const eventParticipants =
        data.participants.filter(
          item =>
            item.eventId ===
            event.id
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

window.deleteReport = id => {
  const data = db();

  if (isChapterServantSession()) {
    const chapter = scopedChapter(data);
    const report = data.reports.find(item => item.id === id);

    if (!chapter || !report || report.chapter !== chapter.name) {
      toast('You can only delete activity reports for your assigned chapter.', 'error');
      return;
    }
  } else if (!isSuperAdminSession()) {
    toast('You do not have permission to delete activity reports.', 'error');
    return;
  }

  if (
    !confirm(
      'Delete this activity report?'
    )
  ) {
    return;
  }

  data.reports =
    data.reports.filter(
      report =>
        report.id !== id
    );

  save(data);

  toast(
    'Report deleted.'
  );

  renderReports();
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
        participant.eventId ===
        event.id
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
                  participant.eventId ===
                  event.id
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
                              onclick="viewEvent(${event.id})"
                            >
                              View
                            </button>

                            ${canManage
                              ? `
                                <button
                                  class="btn"
                                  onclick="eventModal(${event.id})"
                                >
                                  Edit
                                </button>

                                <button
                                  class="btn red"
                                  onclick="deleteEvent(${event.id})"
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
      item => item.id === id
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

    close => {
      const name =
        document
          .getElementById('eName')
          .value.trim();

      const date =
        document.getElementById(
          'eDate'
        ).value;

      const attendance =
        Number(
          document.getElementById(
            'eAttended'
          ).value || 0
        );

      if (
        !name ||
        !date
      ) {
        toast(
          'Event name and date are required.',
          'error'
        );

        return;
      }

      if (
        !Number.isInteger(
          attendance
        ) ||
        attendance < 0
      ) {
        toast(
          'Manual attendance must be a whole number of zero or more.',
          'error'
        );

        return;
      }

      const record = {
        id:
          id ||
          uid(),

        name,

        date,

        fee:
          Number(
            document.getElementById(
              'eFee'
            ).value || 0
          ),

        venue:
          document
            .getElementById(
              'eVenue'
            )
            .value.trim(),

        peopleAttended:
          attendance,

        description:
          document
            .getElementById(
              'eDescription'
            )
            .value.trim()
      };

      if (id) {
        Object.assign(
          data.events.find(
            item =>
              item.id === id
          ),
          record
        );
      } else {
        data.events.push(
          record
        );
      }

      save(data);

      close();

      toast(
        id
          ? 'Event updated.'
          : 'Event added.'
      );

      renderEvents();
    }
  );
};

window.deleteEvent = id => {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can delete Area events.')) return;

  if (
    !confirm(
      'Delete this event and all of its participant records?'
    )
  ) {
    return;
  }

  const data = db();

  data.events =
    data.events.filter(
      event =>
        event.id !== id
    );

  data.participants =
    data.participants.filter(
      participant =>
        participant.eventId !== id
    );

  data.reports.forEach(
    report => {
      if (
        report.eventId === id
      ) {
        report.eventId =
          null;
      }
    }
  );

  save(data);

  toast(
    'Event deleted.'
  );

  renderEvents();
};

window.viewEvent = id => {
  const data = db();
  const canManage = isSuperAdminSession();

  const event =
    data.events.find(
      item => item.id === id
    );

  if (!event) return;

  const participants =
    data.participants.filter(
      participant =>
        participant.eventId === id
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
                        <span
                          class="badge ${participant.paymentStatus ===
              'Paid'
              ? 'paid'
              : 'unpaid'
            }"
                        >
                          ${esc(
              participant.paymentStatus || 'Unpaid'
            )}
                        </span>
                      </td>

                      <td>
                        <span
                          class="badge ${participant.attended
              ? 'attended'
              : 'pending'
            }"
                        >
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
                              onclick="participantModal(${id}, ${participant.id})"
                            >
                              Edit
                            </button>

                            <button
                              class="btn red"
                              onclick="deleteParticipant(${id}, ${participant.id})"
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
            onclick="participantModal(${id})"
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
      item => item.id === id
    )
    : null;

  const linkedMember = participant
    ? participantMember(data, participant)
    : null;

  const registeredMemberIds = new Set(
    data.participants
      .filter(item =>
        item.eventId === eventId &&
        item.id !== id &&
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

    close => {
      let member = linkedMember;

      if (!id) {
        const selectedMember = document.querySelector(
          'input[name="pMember"]:checked'
        );

        if (!selectedMember) {
          toast(
            data.members.length
              ? 'Select a registered member.'
              : 'Add a member in the Members tab before registering a participant.',
            'error'
          );

          return;
        }

        member = data.members.find(
          item => String(item.id) === String(selectedMember.value)
        );

        if (!member) {
          toast(
            'The selected member could not be found. Refresh and try again.',
            'error'
          );

          return;
        }

        if (
          data.participants.some(
            item =>
              item.eventId === eventId &&
              item.id !== id &&
              String(item.memberId) === String(member.id)
          )
        ) {
          toast(
            'That member is already registered for this event.',
            'error'
          );

          return;
        }
      }

      const record = {
        id:
          id ||
          uid(),

        eventId,

        memberId:
          member?.id ??
          participant?.memberId ??
          null,

        // Keep a compact participant snapshot for historical compatibility.
        first:
          member?.firstName ??
          participant?.first ??
          '',

        last:
          member?.lastName ??
          participant?.last ??
          '',

        mi:
          member?.middleName
            ? String(member.middleName).trim().charAt(0).toUpperCase()
            : participant?.mi ?? '',

        age:
          member
            ? calculateAge(member.birthDate) || 0
            : participant?.age || 0,

        contact:
          member?.contact ??
          participant?.contact ??
          '',

        address:
          member?.address ??
          participant?.address ??
          '',

        chapter:
          member?.chapterName ??
          participant?.chapter ??
          '',

        service:
          member
            ? (member.services || []).join(', ')
            : participant?.service ?? '',

        paymentMode:
          document.getElementById(
            'pMode'
          ).value,

        paymentStatus:
          document.getElementById(
            'pPay'
          ).value,

        attended:
          document.getElementById(
            'pAttended'
          ).checked
      };

      if (id) {
        const target = data.participants.find(
          item => item.id === id
        );

        if (!target) {
          toast(
            'Participant record could not be found.',
            'error'
          );

          return;
        }

        Object.assign(
          target,
          record
        );
      } else {
        data.participants.push(
          record
        );
      }

      save(data);

      close();

      toast(
        id
          ? 'Participant updated.'
          : 'Participant registered.'
      );

      window.viewEvent(
        eventId
      );
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

window.deleteParticipant = (
  eventId,
  id
) => {
  if (denyUnlessSuperAdmin('Only Super Admin access levels can manage event participants.')) return;

  if (
    !confirm(
      'Delete this participant?'
    )
  ) {
    return;
  }

  const data = db();

  data.participants =
    data.participants.filter(
      participant =>
        participant.id !== id
    );

  save(data);

  toast(
    'Participant deleted.'
  );

  activeModalCleanup?.();

  window.viewEvent(
    eventId
  );
};


// =========================================================
// AREA ONBOARDING FOR NEW SERVANT LEADER ACCOUNTS
// =========================================================

function isLeadershipSession() {
  return ['couple_coordinator', 'area_servant', 'lit_servant', 'chapter_servant'].includes(
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

  const finishAreaSetup = area => {
    const updated = {
      ...session,
      areaId: area.id,
      areaName: area.name,
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
      setTimeout(() => finishAreaSetup(payload.area), 350);
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
      setTimeout(() => finishAreaSetup(payload.area), 400);
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

(
  renderers[page] ||
  renderDashboard
)();

showAreaOnboarding();
