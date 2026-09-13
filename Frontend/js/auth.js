// =========================================================
// MFC Youth Area Management System - Frontend Auth Prototype
// Accounts are provisioned by administrators from the Members database.
// Browser-only prototype: replace plaintext/localStorage auth with server-side
// authentication + password hashing before production.
// =========================================================

const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function getMembers() {
  const data = safeParse(localStorage.getItem(DB_KEY) || '{}', {});
  return Array.isArray(data.members) ? data.members : [];
}

function getUsers() {
  const users = safeParse(localStorage.getItem(USER_KEY) || '[]', []);
  if (!Array.isArray(users)) return [];

  // Best-effort migration for accounts created by the old public sign-up flow.
  // If an old account matches exactly one member by email, convert it to a
  // member account. Unlinked legacy accounts are intentionally not granted
  // management access.
  const members = getMembers();
  let changed = false;
  const normalized = users.map(raw => {
    const user = { ...raw, email: normalizeEmail(raw.email) };

    if (!user.role) {
      const matches = members.filter(
        member => normalizeEmail(member.email) && normalizeEmail(member.email) === user.email
      );

      if (matches.length === 1) {
        user.role = 'member';
        user.memberId = matches[0].id;
        user.isActive = String(matches[0].status || 'Active') !== 'Inactive';
        if (user.mustChangePassword === undefined) user.mustChangePassword = true;
      } else {
        user.role = 'legacy';
      }
      changed = true;
    }

    if (user.role === 'member' && user.isActive === undefined) {
      const member = members.find(item => String(item.id) === String(user.memberId));
      user.isActive = member ? String(member.status || 'Active') !== 'Inactive' : true;
      changed = true;
    }

    return user;
  });

  if (changed) saveUsers(normalized);
  return normalized;
}

function saveUsers(users) {
  localStorage.setItem(USER_KEY, JSON.stringify(users));
}

function getSession() {
  return safeParse(localStorage.getItem(SESSION_KEY), null) || safeParse(sessionStorage.getItem(SESSION_KEY), null);
}

function saveSession(session, remember) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
}

function updateSession(session) {
  if (localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

function destinationFor(session) {
  if (session?.mustChangePassword) return '/change-password';
  if (session?.role === 'member') return '/member';
  return '/dashboard';
}

function showMessage(id, text, type = 'error') {
  const box = document.getElementById(id);
  if (!box) return;
  box.innerHTML = `<div class="message ${type}" role="status">${escapeHtml(text)}</div>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordError(password) {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
  return '';
}

function setButtonBusy(button, busy, busyText = 'Please wait…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function attachPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      button.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} password`);
    });
  });
}

// Signed-in users who revisit the sign-in page go to the correct portal.
const currentSession = getSession();
if (currentSession && document.body.dataset.allowAuthenticated !== 'true') {
  location.replace(destinationFor(currentSession));
}

// ---------------- LOGIN ----------------
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    const submit = loginForm.querySelector('[type="submit"]');
    const email = normalizeEmail(document.getElementById('loginEmail').value);
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('rememberMe')?.checked === true;

    if (!isValidEmail(email)) {
      showMessage('loginMessage', 'Enter a valid email address.');
      return;
    }

    setButtonBusy(submit, true, 'Signing In…');

    // Built-in management demo account remains available for the prototype.
    const demoOk = email === 'admin@mfcyouth.local' && password === 'admin123';
    if (demoOk) {
      const session = {
        email,
        name: 'Area Administrator',
        role: 'area_admin',
        loginAt: new Date().toISOString(),
        mustChangePassword: false,
        demo: true
      };
      saveSession(session, remember);
      location.href = '/dashboard';
      return;
    }

    const users = getUsers();
    const user = users.find(item => item.email === email && item.password === password);

    if (!user) {
      setButtonBusy(submit, false);
      showMessage('loginMessage', 'Account not found or password is incorrect.');
      return;
    }

    if (user.role === 'legacy') {
      setButtonBusy(submit, false);
      showMessage('loginMessage', 'This older account is not linked to a member record. Ask an Area Admin to add or link you from the Members page.');
      return;
    }

    if (user.isActive === false) {
      setButtonBusy(submit, false);
      showMessage('loginMessage', 'This member account is currently inactive. Contact your Area Admin.');
      return;
    }

    const session = {
      userId: user.id,
      memberId: user.memberId ?? null,
      email: user.email,
      name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      role: user.role || 'member',
      loginAt: new Date().toISOString(),
      mustChangePassword: user.mustChangePassword === true,
      demo: false
    };

    saveSession(session, remember);
    location.href = destinationFor(session);
  });
}

// ---------------- CHANGE PASSWORD ----------------
const forcePasswordForm = document.getElementById('forcePasswordForm');
if (forcePasswordForm) {
  const session = getSession();
  const accountEmail = document.getElementById('passwordAccountEmail');
  const pageTitle = document.getElementById('passwordPageTitle');
  const pageIntro = document.getElementById('passwordPageIntro');

  if (!session) {
    location.replace('/');
  } else if (session.demo) {
    showMessage('passwordMessage', 'The built-in demo administrator password cannot be changed from this prototype.', 'error');
    forcePasswordForm.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
  } else {
    if (accountEmail) accountEmail.textContent = session.email;
    if (session.mustChangePassword) {
      if (pageTitle) pageTitle.textContent = 'Secure Your Account';
      if (pageIntro) pageIntro.textContent = 'Your administrator issued a temporary password. Create your own password before continuing.';
    }

    forcePasswordForm.addEventListener('submit', event => {
      event.preventDefault();
      const currentPassword = document.getElementById('currentPassword').value;
      const password = document.getElementById('newPassword').value;
      const confirmation = document.getElementById('newPasswordConfirm').value;
      const pError = passwordError(password);

      if (!currentPassword) {
        showMessage('passwordMessage', 'Enter your current password.');
        return;
      }
      if (pError) {
        showMessage('passwordMessage', pError);
        return;
      }
      if (password !== confirmation) {
        showMessage('passwordMessage', 'New passwords do not match.');
        return;
      }
      if (password === currentPassword) {
        showMessage('passwordMessage', 'Choose a new password that is different from your temporary/current password.');
        return;
      }

      const users = getUsers();
      const user = users.find(item => String(item.id) === String(session.userId)) || users.find(item => item.email === session.email);
      if (!user || user.password !== currentPassword) {
        showMessage('passwordMessage', 'Your current password is incorrect.');
        return;
      }

      user.password = password;
      user.mustChangePassword = false;
      user.passwordUpdatedAt = new Date().toISOString();
      saveUsers(users);

      const updatedSession = { ...session, mustChangePassword: false };
      updateSession(updatedSession);
      showMessage('passwordMessage', 'Password updated successfully. Redirecting…', 'success');
      setTimeout(() => { location.href = destinationFor(updatedSession); }, 650);
    });
  }
}

attachPasswordToggles();
