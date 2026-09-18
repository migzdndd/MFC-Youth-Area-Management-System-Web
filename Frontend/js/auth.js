/**
 * ============================================================================
 * MFC Youth Area Management System - Frontend Authentication
 * ============================================================================
 * Purpose:
 * Manages client authentication, session storage, and account provisioning.
 * - Handles sign-in (Cloud Supabase API with local demo fallback).
 * - Routes authenticated users according to role (Dashboard, Chapters, Member Portal).
 * - Handles servant leader registration and member self-service account claiming.
 * - Handles password changes and email update workflows.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. Storage Keys & Access Level Configuration
// ----------------------------------------------------------------------------
const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';
const DB_KEY = 'mfc_web_database_v1';

/** Set of valid access roles within the system */
const ACCESS_ROLE_VALUES = new Set([
  'national_coordinator',
  'couple_coordinator',
  'area_servant',
  'lit_servant',
  'campus_servant',
  'area_kids_servant',
  'chapter_servant',
  'member'
]);

/** Normalizes role string to canonical enum value */
function normalizeAccessRole(value) {
  const role = String(value || 'member').trim().toLowerCase();
  if (role === 'area_admin') return 'area_servant';
  return ACCESS_ROLE_VALUES.has(role) ? role : 'member';
}

/** Extracts the normalized role for a member record */
function roleForMember(member) {
  return normalizeAccessRole(member?.accessLevel || 'member');
}

/** Safely parses JSON with fallback */
function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Normalizes email for case-insensitive lookup */
function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

// ----------------------------------------------------------------------------
// 2. Local Storage Cache: Members & Prototype Users
// ----------------------------------------------------------------------------

/** Reads cached member records from localStorage */
function getMembers() {
  const data = safeParse(localStorage.getItem(DB_KEY) || '{}', {});
  return Array.isArray(data.members) ? data.members : [];
}

/** Reconciles and returns prototype demo users from localStorage */
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

/** Saves user accounts to local storage */
function saveUsers(users) {
  localStorage.setItem(USER_KEY, JSON.stringify(users));
}

// ----------------------------------------------------------------------------
// 3. Session Management & Navigation Helpers
// ----------------------------------------------------------------------------

/** Reads current active session from localStorage or sessionStorage */
function getSession() {
  return safeParse(localStorage.getItem(SESSION_KEY), null) || safeParse(sessionStorage.getItem(SESSION_KEY), null);
}

/** Persists session data to either localStorage (remember me) or sessionStorage */
function saveSession(session, remember) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
}

/** Updates the active session in-place in whichever storage it was saved */
function updateSession(session) {
  if (localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

/** Clears session storage on logout */
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

/** Determines landing route based on session state, permissions, and roles */
function destinationFor(session) {
  if (session?.mustChangePassword) return '/change-password';
  if (session?.needsAreaSetup) return '/dashboard';
  if (session?.role === 'member') return '/member';
  if (session?.role === 'chapter_servant') return '/chapters';
  return '/dashboard';
}

// ----------------------------------------------------------------------------
// 4. API Request Client & Backend Session Mapping
// ----------------------------------------------------------------------------

/** Performs authenticated JSON HTTP fetch requests to backend endpoints */
async function apiJson(path, options = {}) {
  const activeSession = getSession();
  const accessToken = activeSession?.backendAuth && !activeSession?.demo
    ? String(activeSession.accessToken || '')
    : '';

  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
    error.code = body?.code;
    throw error;
  }

  return body;
}

/** Transforms backend login/register response into a standard client session object */
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

// ----------------------------------------------------------------------------
// 5. UI Helpers: Alerts, Validation & Motion Effects
// ----------------------------------------------------------------------------

/** Displays an alert box message in the specified container element */
function showMessage(id, text, type = 'error') {
  const box = document.getElementById(id);
  if (!box) return;
  box.innerHTML = `<div class="message ${type}" role="status">${escapeHtml(text)}</div>`;
}

/** Escapes special HTML characters */
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/** Checks for standard email address syntax */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Validates password complexity: minimum 8 characters with at least one letter and number */
function passwordError(password) {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
  return '';
}

/** Toggles loading/busy status and label on form submission buttons */
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

/** Connects show/hide password toggle buttons */
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

/** Sets up entry reveal animations with stagger */
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

// Redirect already signed-in users attempting to access public login/register pages
const currentSession = getSession();
if (currentSession && document.body.dataset.allowAuthenticated !== 'true') {
  navigateWithLoader(destinationFor(currentSession), true);
}

// ----------------------------------------------------------------------------
// 6. Login Flow (Demo & Cloud)
// ----------------------------------------------------------------------------

/** Starts a pre-configured offline demo session for testing */
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

// One-click demo login button
const demoLoginButton = document.getElementById('demoLoginButton');
if (demoLoginButton) {
  demoLoginButton.addEventListener('click', () => {
    setButtonBusy(demoLoginButton, true, 'Opening Demo…');
    startDemoLogin(false);
  });
}

// Main sign-in form handler
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

    setButtonBusy(submit, true, 'Signing In…');

    // Built-in demo credentials check
    const demoOk = email === 'admin@mfcyouth.local' && password === 'admin123';
    if (demoOk) {
      startDemoLogin(remember);
      return;
    }

    // Authenticate via cloud backend with prototype fallback
    try {
      const payload = await apiJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      const session = backendSessionFromResponse(payload, remember);
      navigateWithLoader(destinationFor(session));
      return;
    } catch (backendError) {
      const users = getUsers();
      const user = users.find(item => item.email === email && item.password === password);

      if (!user) {
        setButtonBusy(submit, false);
        showMessage('loginMessage', backendError?.message || 'Account not found or password is incorrect.');
        return;
      }

      if (user.role === 'legacy') {
        setButtonBusy(submit, false);
        showMessage('loginMessage', 'This older account is not linked to a member record. Ask an Area-level servant to add or link you from the Members page.');
        return;
      }

      if (user.isActive === false) {
        setButtonBusy(submit, false);
        showMessage('loginMessage', 'This account is currently inactive. Contact an Area-level servant.');
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
        mustChangePassword: user.mustChangePassword === true,
        needsAreaSetup: false,
        demo: false
      };

      saveSession(session, remember);
      navigateWithLoader(destinationFor(session));
    }
  });
}

// ----------------------------------------------------------------------------
// 7. Servant Leader Registration Flow
// ----------------------------------------------------------------------------
const adminRegistrationForm = document.getElementById('adminRegistrationForm');
if (adminRegistrationForm) {
  adminRegistrationForm.addEventListener('submit', async event => {
    event.preventDefault();

    const submit = document.getElementById('adminRegisterButton') || adminRegistrationForm.querySelector('[type="submit"]');
    const displayName = String(document.getElementById('adminDisplayName')?.value || '').trim();
    const email = normalizeEmail(document.getElementById('adminEmail')?.value || '');
    const role = String(document.getElementById('adminRole')?.value || '').trim();
    const verificationCode = String(document.getElementById('adminVerificationCode')?.value || '');
    const password = String(document.getElementById('adminPassword')?.value || '');
    const confirmPassword = String(document.getElementById('adminPasswordConfirm')?.value || '');

    if (!displayName) {
      showMessage('adminRegistrationMessage', 'Enter your full name.');
      return;
    }
    if (!isValidEmail(email)) {
      showMessage('adminRegistrationMessage', 'Enter a valid email address.');
      return;
    }
    if (!['national_coordinator', 'couple_coordinator', 'area_servant', 'lit_servant', 'campus_servant', 'area_kids_servant', 'chapter_servant'].includes(role)) {
      showMessage('adminRegistrationMessage', 'Select your System Access Level.');
      return;
    }
    if (!verificationCode) {
      showMessage('adminRegistrationMessage', 'Enter the administrator registration password.');
      return;
    }

    const pError = passwordError(password);
    if (pError) {
      showMessage('adminRegistrationMessage', pError);
      return;
    }
    if (password !== confirmPassword) {
      showMessage('adminRegistrationMessage', 'Passwords do not match.');
      return;
    }

    setButtonBusy(submit, true, 'Creating Account…');

    try {
      const payload = await apiJson('/api/auth/admin-register', {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          email,
          role,
          verificationCode,
          password,
          confirmPassword
        })
      });

      const session = backendSessionFromResponse(payload, true);
      session.needsAreaSetup = true;
      updateSession(session);
      showMessage('adminRegistrationMessage', 'Account created with your chosen password. Redirecting to Area setup…', 'success');
      setTimeout(() => { navigateWithLoader('/dashboard'); }, 550);
    } catch (error) {
      setButtonBusy(submit, false);
      showMessage('adminRegistrationMessage', error?.message || 'Unable to create the account.');
    }
  });
}

// ----------------------------------------------------------------------------
// 8. Member Portal Account Claim Flow
// ----------------------------------------------------------------------------
const memberClaimForm = document.getElementById('memberClaimForm');
if (memberClaimForm) {
  memberClaimForm.addEventListener('submit', async event => {
    event.preventDefault();

    const submit = document.getElementById('memberClaimButton');
    const email = normalizeEmail(document.getElementById('memberClaimEmail')?.value || '');
    const password = String(document.getElementById('memberClaimPassword')?.value || '');
    const confirmation = String(document.getElementById('memberClaimPasswordConfirm')?.value || '');

    if (!isValidEmail(email)) {
      showMessage('memberClaimMessage', 'Enter the email address stored in your Member record.');
      return;
    }
    const pError = passwordError(password);
    if (pError) {
      showMessage('memberClaimMessage', pError);
      return;
    }
    if (password !== confirmation) {
      showMessage('memberClaimMessage', 'Passwords do not match.');
      return;
    }

    setButtonBusy(submit, true, 'Creating Account…');
    try {
      const payload = await apiJson('/api/auth/member-claim', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (payload.verificationRequired) {
        setButtonBusy(submit, false);
        showMessage('memberClaimMessage', payload.message || 'Check your email to verify your account, then sign in.', 'success');
        return;
      }

      const session = backendSessionFromResponse(payload, false);
      showMessage('memberClaimMessage', 'Your Member Portal account is ready. Redirecting…', 'success');
      setTimeout(() => navigateWithLoader(destinationFor(session)), 550);
    } catch (error) {
      setButtonBusy(submit, false);
      showMessage('memberClaimMessage', error?.message || 'Unable to create your Member Portal account. Please try again.');
    }
  });
}

// ----------------------------------------------------------------------------
// 9. Password Update & Force Change Flow
// ----------------------------------------------------------------------------
const backToLoginButton = document.getElementById('backToLoginButton');
if (backToLoginButton) {
  backToLoginButton.addEventListener('click', async () => {
    const activeSession = getSession();
    backToLoginButton.disabled = true;
    backToLoginButton.textContent = 'Signing Out…';

    if (activeSession?.backendAuth && !activeSession?.demo && activeSession?.accessToken) {
      try {
        await apiJson('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ scope: 'local' })
        });
      } catch {
        // Local browser state is still cleared so the user is not left signed in on this device.
      }
    }

    clearSession();
    navigateWithLoader('/');
  });
}

const forcePasswordForm = document.getElementById('forcePasswordForm');
if (forcePasswordForm) {
  const session = getSession();
  const accountEmail = document.getElementById('passwordAccountEmail');
  const pageTitle = document.getElementById('passwordPageTitle');
  const pageIntro = document.getElementById('passwordPageIntro');

  if (!session) {
    navigateWithLoader('/', true);
  } else if (session.demo) {
    showMessage('passwordMessage', 'The built-in demo administrator password cannot be changed from this prototype.', 'error');
    forcePasswordForm.querySelectorAll('input, button[type="submit"]').forEach(el => { el.disabled = true; });
  } else {
    if (accountEmail) accountEmail.textContent = session.email;
    if (session.mustChangePassword) {
      if (pageTitle) pageTitle.textContent = 'Secure Your Account';
      if (pageIntro) pageIntro.textContent = 'Your account requires a password update before continuing.';
    }

    forcePasswordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = forcePasswordForm.querySelector('[type="submit"]');
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
        showMessage('passwordMessage', 'Choose a new password that is different from your current password.');
        return;
      }

      // Backend-authenticated users: call the Supabase change-password API
      if (session.backendAuth && !session.demo) {
        setButtonBusy(submit, true, 'Updating…');
        try {
          await apiJson('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword: password })
          });

          const updatedSession = { ...session, mustChangePassword: false };
          updateSession(updatedSession);
          showMessage('passwordMessage', 'Password updated successfully. Redirecting…', 'success');
          setTimeout(() => { navigateWithLoader(destinationFor(updatedSession)); }, 650);
        } catch (error) {
          setButtonBusy(submit, false);
          showMessage('passwordMessage', error?.message || 'Unable to update your password. Please try again.');
        }
        return;
      }

      // Local prototype fallback for browser-only demo accounts
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
      setTimeout(() => { navigateWithLoader(destinationFor(updatedSession)); }, 650);
    });
  }
}

// ----------------------------------------------------------------------------
// 10. Email Address Change Flow
// ----------------------------------------------------------------------------
const changeEmailForm = document.getElementById('changeEmailForm');
if (changeEmailForm) {
  const emailSession = getSession();
  const newEmailInput = document.getElementById('newAccountEmail');

  if (!emailSession || emailSession.demo || !emailSession.backendAuth) {
    changeEmailForm.querySelectorAll('input, button').forEach(element => { element.disabled = true; });
    showMessage('emailChangeMessage', 'Email changes are available only for signed-in cloud accounts.');
  } else {
    changeEmailForm.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = changeEmailForm.querySelector('[type="submit"]');
      const newEmail = normalizeEmail(newEmailInput?.value || '');

      if (!isValidEmail(newEmail)) {
        showMessage('emailChangeMessage', 'Enter a valid new email address.');
        newEmailInput?.focus();
        return;
      }
      if (newEmail === normalizeEmail(emailSession.email || '')) {
        showMessage('emailChangeMessage', 'Enter an email address different from your current email.');
        newEmailInput?.focus();
        return;
      }

      setButtonBusy(submit, true, 'Requesting…');
      try {
        const payload = await apiJson('/api/auth/change-email', {
          method: 'POST',
          body: JSON.stringify({ newEmail })
        });

        showMessage(
          'emailChangeMessage',
          payload?.message || 'Email change requested. Complete the confirmation email process before the new address becomes active.',
          'success'
        );
        changeEmailForm.reset();
      } catch (error) {
        showMessage('emailChangeMessage', error?.message || 'Unable to request the email change. Please try again.');
      } finally {
        setButtonBusy(submit, false);
      }
    });
  }
}

// Initialize show/hide password toggle buttons
attachPasswordToggles();
