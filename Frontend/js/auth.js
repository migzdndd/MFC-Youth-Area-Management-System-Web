// =========================================================
// MFC Youth Area Management System - Authentication
// Member records remain the source of truth. Admins can provision login access
// from the Members dashboard. login access is managed through provisioned accounts and passwords.
// =========================================================

const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';

const ACCESS_ROLE_VALUES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'chapter_servant',
  'member'
]);

function normalizeAccessRole(value) {
  const role = String(value || 'member').trim().toLowerCase();
  if (role === 'area_admin') return 'area_servant';
  return ACCESS_ROLE_VALUES.has(role) ? role : 'member';
}

function roleForMember(member) {
  return normalizeAccessRole(member?.accessLevel || 'member');
}

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

  const members = getMembers();
  let changed = false;

  const normalized = users.map(raw => {
    const user = {
      ...raw,
      email: normalizeEmail(raw.email)
    };

    let linkedMember = null;

    if (
      user.memberId !== null &&
      user.memberId !== undefined
    ) {
      linkedMember = members.find(
        member => String(member.id) === String(user.memberId)
      ) || null;
    }

    if (!linkedMember && user.email) {
      const matches = members.filter(
        member =>
          normalizeEmail(member.email) &&
          normalizeEmail(member.email) === user.email
      );

      if (matches.length === 1) {
        linkedMember = matches[0];
      }
    }

    if (!user.role) {
      if (linkedMember) {
        user.role = roleForMember(linkedMember);
        user.memberId = linkedMember.id;
        user.mustChangePassword = user.mustChangePassword !== false;
      } else {
        user.role = 'legacy';
      }
      changed = true;
    }

    if (linkedMember && user.role !== 'legacy') {
      const desiredRole = roleForMember(linkedMember);
      const desiredChapterId = linkedMember.chapterId ?? null;
      const desiredActive = String(linkedMember.status || 'Active') !== 'Inactive';
      const desiredName = [
        linkedMember.firstName,
        linkedMember.middleName,
        linkedMember.lastName
      ].filter(Boolean).join(' ');

      if (user.role !== desiredRole) {
        user.role = desiredRole;
        changed = true;
      }

      if (String(user.memberId) !== String(linkedMember.id)) {
        user.memberId = linkedMember.id;
        changed = true;
      }

      if (String(user.chapterId ?? '') !== String(desiredChapterId ?? '')) {
        user.chapterId = desiredChapterId;
        changed = true;
      }

      if (user.isActive !== desiredActive) {
        user.isActive = desiredActive;
        changed = true;
      }

      if (desiredName && user.name !== desiredName) {
        user.name = desiredName;
        user.firstName = linkedMember.firstName || '';
        user.lastName = linkedMember.lastName || '';
        changed = true;
      }
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

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function destinationFor(session) {
  if (session?.role !== 'member' && session?.mustChangePassword) return '/change-password';
  if (session?.needsAreaSetup) return '/dashboard';
  if (session?.role === 'member') return '/member';
  if (session?.role === 'chapter_servant') return '/chapters';
  return '/dashboard';
}

let authPageRefreshPromise = null;

async function refreshStoredBackendSession() {
  const current = getSession();
  if (!current?.backendAuth || current?.demo || !current?.refreshToken) return null;
  if (authPageRefreshPromise) return authPageRefreshPromise;

  authPageRefreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.session?.accessToken) return null;

      const refreshed = {
        ...current,
        accessToken: payload.session.accessToken,
        refreshToken: payload.session.refreshToken || current.refreshToken,
        expiresAt: payload.session.expiresAt || null,
        userId: payload.user?.id ?? current.userId,
        memberId: payload.user?.memberId ?? current.memberId,
        email: payload.user?.email || current.email,
        name: payload.user?.name || current.name,
        role: normalizeAccessRole(payload.user?.role || current.role),
        areaId: payload.user?.areaId ?? current.areaId,
        chapterId: payload.user?.chapterId ?? current.chapterId,
        mustChangePassword: payload.user?.mustChangePassword === true,
        needsAreaSetup: payload.user?.role !== 'member' && !(payload.user?.areaId ?? current.areaId)
      };

      updateSession(refreshed);
      return refreshed;
    } catch {
      return null;
    }
  })();

  try {
    return await authPageRefreshPromise;
  } finally {
    authPageRefreshPromise = null;
  }
}

async function apiJson(path, options = {}) {
  const { _retriedAfterRefresh = false, ...fetchOptions } = options;
  const response = await fetch(path, {
    ...fetchOptions,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers || {})
    }
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, error: 'The server returned an invalid response.' };
  }

  if (!response.ok) {
    const authHeader = String(fetchOptions.headers?.Authorization || fetchOptions.headers?.authorization || '');
    const current = getSession();
    const canRefresh =
      response.status === 401 &&
      !_retriedAfterRefresh &&
      path !== '/api/auth/refresh' &&
      authHeader.startsWith('Bearer ') &&
      current?.backendAuth &&
      !current?.demo &&
      Boolean(current?.refreshToken) &&
      ['INVALID_SESSION', 'AUTH_REQUIRED'].includes(String(body?.code || ''));

    if (canRefresh) {
      const refreshed = await refreshStoredBackendSession();
      if (refreshed?.accessToken) {
        return apiJson(path, {
          ...fetchOptions,
          _retriedAfterRefresh: true,
          headers: {
            ...(fetchOptions.headers || {}),
            Authorization: `Bearer ${refreshed.accessToken}`
          }
        });
      }
    }

    const error = new Error(body?.error || 'Request failed.');
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }

  return body;
}

function backendSessionFromResponse(payload, remember = false) {
  const user = payload?.user || {};
  const serverSession = payload?.session || {};
  const session = {
    userId: user.id ?? null,
    memberId: user.memberId ?? null,
    email: user.email || '',
    name: user.name || user.email || 'Area User',
    role: normalizeAccessRole(user.role || 'member'),
    areaId: user.areaId ?? null,
    chapterId: user.chapterId ?? null,
    loginAt: new Date().toISOString(),
    mustChangePassword: user.mustChangePassword === true,
    needsAreaSetup: user.role !== 'member' && !user.areaId,
    accessToken: serverSession.accessToken || '',
    refreshToken: serverSession.refreshToken || '',
    expiresAt: serverSession.expiresAt || null,
    backendAuth: true,
    demo: false
  };
  saveSession(session, remember);
  return session;
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

function initializeRevealAnimations() {
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

window.addEventListener('DOMContentLoaded', initializeRevealAnimations);

// Signed-in users who revisit the sign-in page go to the correct portal.
const currentSession = getSession();
if (currentSession && document.body.dataset.allowAuthenticated !== 'true') {
  navigateWithLoader(destinationFor(currentSession), true);
}

// ---------------- LOGIN ----------------
function startDemoLogin(remember = false) {
  const session = {
    email: 'admin@mfcyouth.local',
    name: 'Area Servant (Demo)',
    role: 'area_servant',
    loginAt: new Date().toISOString(),
    mustChangePassword: false,
    demo: true
  };

  saveSession(session, remember);
  navigateWithLoader('/dashboard');
}

const demoLoginButton = document.getElementById('demoLoginButton');
if (demoLoginButton) {
  demoLoginButton.addEventListener('click', () => {
    setButtonBusy(demoLoginButton, true, 'Opening Demo…');
    startDemoLogin(false);
  });
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();

    const submit = loginForm.querySelector('[type="submit"]');
    const email = normalizeEmail(document.getElementById('loginEmail').value);
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('rememberMe')?.checked === true;

    if (!isValidEmail(email)) {
      showMessage('loginMessage', 'Enter a valid email address.');
      return;
    }

    if (!password) {
      showMessage(
        'loginMessage',
        'Enter your account password. Regular Member records do not require a login account; an Admin can enable optional Member Portal access from Members → Access.'
      );
      return;
    }

    setButtonBusy(submit, true, 'Signing In…');

    // Built-in management demo credentials remain available in addition to
    // the one-click Demo Login button on the sign-in page.
    const demoOk = email === 'admin@mfcyouth.local' && password === 'admin123';
    if (demoOk) {
      startDemoLogin(remember);
      return;
    }

    try {
      const payload = await apiJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      const session = backendSessionFromResponse(payload, remember);
      navigateWithLoader(destinationFor(session));
      return;
    } catch (backendError) {
      // Local demo/prototype fallback remains for offline presentation data.
      const users = getUsers();
      const user = users.find(item => item.email === email && item.password === password);

      if (!user) {
        setButtonBusy(submit, false);
        showMessage('loginMessage', backendError?.message || 'Account not found or password is incorrect.');
        return;
      }

      if (user.role === 'legacy') {
        setButtonBusy(submit, false);
        showMessage('loginMessage', 'This older account is not linked to a Member record. Ask an Admin to link or recreate access from the Members page.');
        return;
      }

      if (user.isActive === false) {
        setButtonBusy(submit, false);
        showMessage('loginMessage', 'This account is currently inactive. Contact your Admin.');
        return;
      }

      const session = {
        userId: user.id,
        memberId: user.memberId ?? null,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: normalizeAccessRole(user.role || 'member'),
        chapterId: user.chapterId ?? null,
        loginAt: new Date().toISOString(),
        mustChangePassword: user.role === 'member' ? false : user.mustChangePassword === true,
        needsAreaSetup: false,
        demo: false
      };

      saveSession(session, remember);
      navigateWithLoader(destinationFor(session));
    }
  });
}

// ---------------- SERVANT LEADER REGISTRATION ----------------
// This remains as a controlled bootstrap/registration-code path. Day-to-day
// leadership accounts should normally be created from an existing Member
// record through the Members dashboard.
function adminRegistrationValues() {
  return {
    displayName: String(document.getElementById('adminDisplayName')?.value || '').trim(),
    email: normalizeEmail(document.getElementById('adminEmail')?.value || ''),
    role: String(document.getElementById('adminRole')?.value || '').trim(),
    verificationCode: String(document.getElementById('adminVerificationCode')?.value || ''),
    password: String(document.getElementById('adminPassword')?.value || ''),
    confirmPassword: String(document.getElementById('adminPasswordConfirm')?.value || '')
  };
}

function validateAdminRegistration(values) {
  if (!values.displayName) return 'Enter your full name.';
  if (!isValidEmail(values.email)) return 'Enter a valid email address.';
  if (!['couple_coordinator', 'area_servant', 'lit_servant', 'chapter_servant'].includes(values.role)) {
    return 'Select your System Access Level.';
  }
  if (!values.verificationCode) return 'Enter the Administrator Registration Code.';
  const pError = passwordError(values.password);
  if (pError) return pError;
  if (values.password !== values.confirmPassword) return 'Passwords do not match.';
  return '';
}

const adminRegistrationForm = document.getElementById('adminRegistrationForm');
if (adminRegistrationForm) {
  adminRegistrationForm.addEventListener('submit', async event => {
    event.preventDefault();

    const submit = document.getElementById('adminRegisterButton') || adminRegistrationForm.querySelector('[type="submit"]');
    const values = adminRegistrationValues();
    const validationError = validateAdminRegistration(values);

    if (validationError) {
      showMessage('adminRegistrationMessage', validationError);
      return;
    }

    setButtonBusy(submit, true, 'Creating Account…');

    try {
      const payload = await apiJson('/api/auth/admin-register', {
        method: 'POST',
        body: JSON.stringify(values)
      });

      const session = backendSessionFromResponse(payload, true);
      session.needsAreaSetup = payload?.requiresAreaSelection === true;
      updateSession(session);

      showMessage(
        'adminRegistrationMessage',
        payload?.linkedMember
          ? 'Account created and linked to the matching Member record. Redirecting…'
          : 'Account created. Redirecting to Area setup…',
        'success'
      );

      setTimeout(() => {
        navigateWithLoader(destinationFor(session));
      }, 450);
    } catch (error) {
      setButtonBusy(submit, false);
      showMessage('adminRegistrationMessage', error?.message || 'Unable to create the Servant Leader account.');
    }
  });
}

// ---------------- CHANGE / SET PASSWORD ----------------
function passwordLinkSession() {
  const params = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const accessToken = params.get('access_token') || '';
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: params.get('refresh_token') || '',
    type: params.get('type') || 'invite'
  };
}

const backToLoginButton = document.getElementById('backToLoginButton');
if (backToLoginButton) {
  const existingSession = getSession();
  if (existingSession?.role === 'member') backToLoginButton.textContent = 'Back to Member Portal';
  backToLoginButton.addEventListener('click', () => {
    const current = getSession();
    history.replaceState(null, '', window.location.pathname);
    if (current?.role === 'member') {
      navigateWithLoader('/member');
      return;
    }
    clearSession();
    navigateWithLoader('/index.html');
  });
}

const forcePasswordForm = document.getElementById('forcePasswordForm');
if (forcePasswordForm) {
  const session = getSession();
  const linkSession = passwordLinkSession();
  const accountEmail = document.getElementById('passwordAccountEmail');
  const pageTitle = document.getElementById('passwordPageTitle');
  const pageIntro = document.getElementById('passwordPageIntro');
  const currentPassword = document.getElementById('currentPassword');
  const currentPasswordGroup = document.getElementById('currentPasswordGroup');
  const submit = forcePasswordForm.querySelector('[type="submit"]');

  if (!session && !linkSession) {
    navigateWithLoader('/', true);
  } else if (session?.demo && !linkSession) {
    showMessage('passwordMessage', 'The built-in demo administrator password cannot be changed from this prototype.', 'error');
    forcePasswordForm.querySelectorAll('input, button[type="submit"]').forEach(el => { el.disabled = true; });
  } else {
    if (linkSession) {
      if (pageTitle) pageTitle.textContent = linkSession.type === 'recovery' ? 'Create a New Password' : 'Set Up Your Password';
      if (pageIntro) pageIntro.textContent = 'Choose a password for this account.';
      if (currentPasswordGroup) currentPasswordGroup.hidden = true;
      if (currentPassword) currentPassword.required = false;

      apiJson('/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${linkSession.accessToken}` }
      }).then(payload => {
        if (accountEmail) accountEmail.textContent = payload?.user?.email || 'Verified account';
      }).catch(error => {
        showMessage('passwordMessage', error?.message || 'This password setup link is invalid or expired. Ask a Servant Leader to send a new setup email.');
        if (submit) submit.disabled = true;
      });
    } else {
      if (accountEmail) accountEmail.textContent = session.email;
      if (session.role === 'member') {
        if (pageTitle) pageTitle.textContent = 'Member Portal Password';
        if (pageIntro) pageIntro.textContent = 'Member records do not require a login account. If Portal access is enabled, you can change the password for that optional account here.';
        if (submit) submit.textContent = 'Update Portal Password';
      } else if (session.mustChangePassword) {
        if (pageTitle) pageTitle.textContent = 'Create Your Servant Leader Password';
        if (pageIntro) pageIntro.textContent = 'Create the password you want to use for future Servant Leader sign-ins.';
        if (currentPasswordGroup) currentPasswordGroup.hidden = true;
        if (currentPassword) currentPassword.required = false;
        if (submit) submit.textContent = 'Create Account Password';
      }
    }

    forcePasswordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const current = currentPassword?.value || '';
      const password = document.getElementById('newPassword').value;
      const confirmation = document.getElementById('newPasswordConfirm').value;
      const pError = passwordError(password);

      if (!linkSession && !session?.mustChangePassword && !current) {
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
      if (!linkSession && !session?.mustChangePassword && password === current) {
        showMessage('passwordMessage', 'Choose a new password that is different from your current password.');
        return;
      }

      setButtonBusy(submit, true, linkSession ? 'Setting Password…' : 'Updating Password…');

      try {
        if (linkSession) {
          await apiJson('/api/auth/change-password', {
            method: 'POST',
            headers: { Authorization: `Bearer ${linkSession.accessToken}` },
            body: JSON.stringify({ newPassword: password })
          });

          clearSession();
          history.replaceState(null, '', window.location.pathname);
          showMessage('passwordMessage', 'Password created successfully. You can now sign in with your email and new password.', 'success');
          setTimeout(() => { navigateWithLoader('/'); }, 800);
          return;
        }

        if (session?.backendAuth) {
          let accessToken = session.accessToken;

          // Existing signed-in accounts verify the current password before a
          // password change. First-time setup links do not require an old password.
          if (!session.mustChangePassword) {
            const verification = await apiJson('/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email: session.email, password: current })
            });
            accessToken = verification?.session?.accessToken;
            if (!accessToken) throw new Error('Unable to verify your current password.');
          }

          await apiJson('/api/auth/change-password', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ newPassword: password })
          });

          if (session.role === 'member') {
            clearSession();
            showMessage('passwordMessage', 'Member Portal password updated successfully. Sign in again with your new password.', 'success');
            setTimeout(() => { navigateWithLoader('/'); }, 800);
            return;
          }

          clearSession();
          showMessage('passwordMessage', 'Password updated successfully. Sign in again with your new password.', 'success');
          setTimeout(() => { navigateWithLoader('/'); }, 800);
          return;
        }

        // Browser-only demo/prototype account fallback.
        const users = getUsers();
        const user = users.find(item => String(item.id) === String(session.userId)) || users.find(item => item.email === session.email);
        if (!user) throw new Error('Account not found.');
        if (!session.mustChangePassword && user.password !== current) {
          throw new Error('Your current password is incorrect.');
        }

        user.password = password;
        user.mustChangePassword = false;
        user.passwordSetupRequired = false;
        user.passwordUpdatedAt = new Date().toISOString();
        saveUsers(users);

        const updatedSession = { ...session, mustChangePassword: false };
        updateSession(updatedSession);
        showMessage('passwordMessage', 'Password updated successfully. Redirecting…', 'success');
        setTimeout(() => { navigateWithLoader(destinationFor(updatedSession)); }, 650);
      } catch (error) {
        setButtonBusy(submit, false);
        showMessage('passwordMessage', error?.message || 'Unable to update the password.');
      }
    });
  }
}
attachPasswordToggles();
