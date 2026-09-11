// =========================================================
// MFC Youth Area Management System - Frontend Auth Prototype
// Browser-only authentication flow. Replace with server auth later.
// =========================================================

const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';
const PENDING_VERIFICATION_KEY = 'mfc_pending_verification';
const RECOVERY_KEY = 'mfc_recovery_email';
const VERIFICATION_TTL_MS = 10 * 60 * 1000;

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function getUsers() {
  const users = safeParse(localStorage.getItem(USER_KEY) || '[]', []);
  return Array.isArray(users) ? users : [];
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

function getPendingVerification() {
  return safeParse(localStorage.getItem(PENDING_VERIFICATION_KEY) || 'null', null);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

function normalizeEmail(value) {
  return value.trim().toLowerCase();
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

// Signed-in users who revisit auth pages go straight to the dashboard.
if (getSession() && document.body.dataset.allowAuthenticated !== 'true') {
  location.replace('/dashboard');
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
    const users = getUsers();
    const user = users.find(item => item.email === email && item.password === password);
    const demoOk = email === 'admin@mfcyouth.local' && password === 'admin123';

    if (!user && !demoOk) {
      setButtonBusy(submit, false);
      showMessage('loginMessage', 'Account not found or password is incorrect.');
      return;
    }

    const session = {
      email,
      name: user?.name || 'Area Administrator',
      loginAt: new Date().toISOString(),
      demo: demoOk
    };
    saveSession(session, remember);
    location.href = '/dashboard';
  });
}

// ---------------- REGISTER ----------------
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', event => {
    event.preventDefault();
    const firstName = document.getElementById('regFirst').value.trim();
    const lastName = document.getElementById('regLast').value.trim();
    const name = `${firstName} ${lastName}`.trim();
    const email = normalizeEmail(document.getElementById('regEmail').value);
    const password = document.getElementById('regPassword').value;
    const confirmation = document.getElementById('regConfirm').value;

    if (!firstName || !lastName || !email || !password) {
      showMessage('registerMessage', 'Please complete all required fields.');
      return;
    }
    if (!isValidEmail(email)) {
      showMessage('registerMessage', 'Enter a valid email address.');
      return;
    }
    if (email === 'admin@mfcyouth.local') {
      showMessage('registerMessage', 'That email is reserved for the built-in demo account.');
      return;
    }
    const pError = passwordError(password);
    if (pError) {
      showMessage('registerMessage', pError);
      return;
    }
    if (password !== confirmation) {
      showMessage('registerMessage', 'Passwords do not match.');
      return;
    }
    if (getUsers().some(user => user.email === email)) {
      showMessage('registerMessage', 'That email is already registered.');
      return;
    }

    const pending = {
      id: Date.now(),
      firstName,
      lastName,
      name,
      email,
      password,
      code: generateVerificationCode(),
      createdAt: new Date().toISOString()
    };

    localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(pending));
    showMessage('registerMessage', 'Account details saved. Continue to verification.', 'success');
    setTimeout(() => { location.href = '/confirm'; }, 450);
  });
}

// ---------------- CONFIRM ACCOUNT ----------------
const confirmForm = document.getElementById('confirmForm');
if (confirmForm) {
  let pending = getPendingVerification();
  const emailEl = document.getElementById('confirmEmail');
  const codeDisplay = document.getElementById('demoVerificationCode');
  const expiryDisplay = document.getElementById('verificationExpiry');
  const resendBtn = document.getElementById('resendCodeBtn');
  const codeInput = document.getElementById('confirmCode');

  function isExpired(item) {
    return !item?.createdAt || Date.now() - new Date(item.createdAt).getTime() > VERIFICATION_TTL_MS;
  }

  function refreshConfirmationView() {
    pending = getPendingVerification();
    if (!pending) return;
    if (emailEl) emailEl.textContent = pending.email;
    if (codeDisplay) codeDisplay.textContent = pending.code;
    if (expiryDisplay) expiryDisplay.textContent = 'Demo code expires 10 minutes after it is generated.';
  }

  if (!pending) {
    showMessage('confirmMessage', 'No pending verification was found. Please register again.');
    confirmForm.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    setTimeout(() => { location.href = '/register'; }, 1200);
  } else {
    refreshConfirmationView();

    codeInput?.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    confirmForm.addEventListener('submit', event => {
      event.preventDefault();
      pending = getPendingVerification();
      if (!pending) {
        showMessage('confirmMessage', 'Verification session is missing. Please register again.');
        return;
      }
      if (isExpired(pending)) {
        showMessage('confirmMessage', 'The verification code expired. Generate a new code and try again.');
        return;
      }

      const enteredCode = codeInput.value.trim();
      if (enteredCode.length !== 6) {
        showMessage('confirmMessage', 'Enter the complete 6-digit verification code.');
        return;
      }
      if (enteredCode !== pending.code) {
        showMessage('confirmMessage', 'The verification code is incorrect. Please try again.');
        return;
      }

      const users = getUsers();
      if (users.some(user => user.email === pending.email)) {
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
        showMessage('confirmMessage', 'This email is already registered. Please sign in instead.', 'success');
        setTimeout(() => { location.href = '/'; }, 900);
        return;
      }

      users.push({
        id: pending.id,
        firstName: pending.firstName,
        lastName: pending.lastName,
        name: pending.name,
        email: pending.email,
        password: pending.password,
        createdAt: new Date().toISOString()
      });
      saveUsers(users);
      localStorage.removeItem(PENDING_VERIFICATION_KEY);
      showMessage('confirmMessage', 'Account verified successfully. Redirecting to sign in…', 'success');
      setTimeout(() => { location.href = '/'; }, 900);
    });

    resendBtn?.addEventListener('click', () => {
      pending = getPendingVerification();
      if (!pending) {
        showMessage('confirmMessage', 'Verification session is missing. Please register again.');
        return;
      }
      pending = { ...pending, code: generateVerificationCode(), createdAt: new Date().toISOString() };
      localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(pending));
      refreshConfirmationView();
      if (codeInput) codeInput.value = '';
      showMessage('confirmMessage', 'A new demo verification code was generated.', 'success');
    });
  }
}

// ---------------- RECOVERY / FRONTEND RESET DEMO ----------------
const recoverLookupForm = document.getElementById('recoverLookupForm');
const resetPasswordForm = document.getElementById('resetPasswordForm');

if (recoverLookupForm) {
  recoverLookupForm.addEventListener('submit', event => {
    event.preventDefault();
    const email = normalizeEmail(document.getElementById('recoverEmail').value);
    if (!isValidEmail(email)) {
      showMessage('recoverMessage', 'Enter a valid email address.');
      return;
    }
    const user = getUsers().find(item => item.email === email);
    if (!user) {
      showMessage('recoverMessage', 'No registered demo account was found with that email.');
      return;
    }

    sessionStorage.setItem(RECOVERY_KEY, email);
    recoverLookupForm.classList.add('hidden');
    resetPasswordForm?.classList.remove('hidden');
    const resetEmail = document.getElementById('resetEmail');
    if (resetEmail) resetEmail.textContent = email;
    showMessage('resetMessage', 'Demo account confirmed. Set a new local password below.', 'success');
  });
}

if (resetPasswordForm) {
  resetPasswordForm.addEventListener('submit', event => {
    event.preventDefault();
    const email = sessionStorage.getItem(RECOVERY_KEY);
    const password = document.getElementById('resetPassword').value;
    const confirmation = document.getElementById('resetConfirm').value;
    const pError = passwordError(password);
    if (!email) {
      showMessage('resetMessage', 'Recovery session expired. Start the recovery process again.');
      return;
    }
    if (pError) {
      showMessage('resetMessage', pError);
      return;
    }
    if (password !== confirmation) {
      showMessage('resetMessage', 'Passwords do not match.');
      return;
    }

    const users = getUsers();
    const user = users.find(item => item.email === email);
    if (!user) {
      showMessage('resetMessage', 'Account could not be found. Start recovery again.');
      return;
    }
    user.password = password;
    user.passwordUpdatedAt = new Date().toISOString();
    saveUsers(users);
    sessionStorage.removeItem(RECOVERY_KEY);
    showMessage('resetMessage', 'Password updated for this browser prototype. Redirecting to sign in…', 'success');
    setTimeout(() => { location.href = '/'; }, 1000);
  });
}

attachPasswordToggles();
