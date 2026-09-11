// This file handles the simple demo account system.
const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';
const PENDING_VERIFICATION_KEY = 'mfc_pending_verification';

// Reads saved demo users from the browser.
function getUsers() { return JSON.parse(localStorage.getItem(USER_KEY) || '[]'); }

function getPendingVerification() {
  return JSON.parse(localStorage.getItem(PENDING_VERIFICATION_KEY) || 'null');
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Shows a small message inside an auth form.
function showMessage(id, text, type = 'error') {
  const box = document.getElementById(id); if (!box) return;
  box.innerHTML = `<div class="message ${type}">${text}</div>`;
}

// Login page logic.
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const users = getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    // A demo account lets the first-time prototype open quickly.
    const demoOk = email === 'admin@mfcyouth.local' && password === 'admin123';
    if (!user && !demoOk) { showMessage('loginMessage', 'Account not found or password is incorrect.'); return; }
    const name = user?.name || 'Area Administrator';
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email, name, loginAt: new Date().toISOString() }));
    location.href = 'dashboard.html';
  });
}

// Register page logic.
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;
    if (!name || !email || !password) {
      showMessage('registerMessage', 'Please complete all required fields.');
      return;
    }
    if (password !== confirm) { showMessage('registerMessage', 'Passwords do not match.'); return; }
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters long.'); return; }
    const users = getUsers();
    if (users.some(u => u.email === email)) { showMessage('registerMessage', 'That email is already registered.'); return; }

    const verificationCode = generateVerificationCode();
    const pending = {
      id: Date.now(),
      name,
      email,
      password,
      code: verificationCode,
      createdAt: new Date().toISOString()
    };

    localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(pending));
    showMessage('registerMessage', 'Verification code generated. Redirecting to confirmation…', 'success');
    setTimeout(() => location.href = 'confirm.html', 600);
  });
}

// Confirmation page logic.
const confirmForm = document.getElementById('confirmForm');
if (confirmForm) {
  const pending = getPendingVerification();
  const emailEl = document.getElementById('confirmEmail');
  const codeDisplay = document.getElementById('demoVerificationCode');
  const resendBtn = document.getElementById('resendCodeBtn');

  if (!pending) {
    showMessage('confirmMessage', 'No pending verification found. Please register again.', 'error');
    setTimeout(() => location.href = 'register.html', 1200);
  } else {
    if (emailEl) emailEl.textContent = pending.email;
    if (codeDisplay) codeDisplay.textContent = pending.code;

    confirmForm.addEventListener('submit', e => {
      e.preventDefault();
      const enteredCode = document.getElementById('confirmCode').value.trim();
      if (!enteredCode) {
        showMessage('confirmMessage', 'Please enter the verification code.');
        return;
      }

      if (enteredCode !== pending.code) {
        showMessage('confirmMessage', 'The confirmation code is incorrect. Please try again.');
        return;
      }

      const users = getUsers();
      if (users.some(u => u.email === pending.email)) {
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
        showMessage('confirmMessage', 'This email is already registered. Please sign in instead.', 'success');
        setTimeout(() => location.href = 'login.html', 1200);
        return;
      }

      users.push({
        id: pending.id,
        name: pending.name,
        email: pending.email,
        password: pending.password
      });
      localStorage.setItem(USER_KEY, JSON.stringify(users));
      localStorage.removeItem(PENDING_VERIFICATION_KEY);
      showMessage('confirmMessage', 'Email verified successfully. Redirecting to sign in…', 'success');
      setTimeout(() => location.href = 'login.html', 1300);
    });

    if (resendBtn) {
      resendBtn.addEventListener('click', () => {
        const updated = { ...pending, code: generateVerificationCode() };
        localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(updated));
        if (codeDisplay) codeDisplay.textContent = updated.code;
        showMessage('confirmMessage', 'A new confirmation code has been sent to the demo email.', 'success');
      });
    }
  }
}

// Recovery page logic. This does not send a real email yet.
const recoverForm = document.getElementById('recoverForm');
if (recoverForm) {
  recoverForm.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('recoverEmail').value.trim().toLowerCase();
    const user = getUsers().find(u => u.email === email);
    if (user) { showMessage('recoverMessage', 'Demo account found. Real email recovery will be connected to the backend later.', 'success'); }
    else { showMessage('recoverMessage', 'No demo account was found with that email.'); }
  });
}
