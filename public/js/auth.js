/* public/js/auth.js – lógica de login y registro */
'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function showAlert(message, type = 'danger') {
  const box = document.getElementById('alert-box');
  box.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  box.classList.remove('d-none');
  box.firstElementChild.style.display = 'flex';
}

// ── Redirección según rol ────────────────────────────────────────────────────
function redirectByRole(role) {
  if (role === 'admin')    return window.location.replace('/admin.html');
  if (role === 'revisor')  return window.location.replace('/revisor.html');
  return window.location.replace('/operador.html');
}

// ── Redirigir si ya tiene sesión ─────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) {
      const { user } = await res.json();
      redirectByRole(user.role);
    }
  } catch { /* sin sesión activa */ }
})();

// ── Toggle visibilidad de contraseña ─────────────────────────────────────────
const toggleBtn = document.getElementById('toggle-password');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    const pwd     = document.getElementById('password');
    const eyeOpen = document.getElementById('eye-open');
    const eyeClose = document.getElementById('eye-closed');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      eyeOpen?.classList.add('d-none');
      eyeClose?.classList.remove('d-none');
    } else {
      pwd.type = 'password';
      eyeOpen?.classList.remove('d-none');
      eyeClose?.classList.add('d-none');
    }
  });
}

// ── Formulario de LOGIN ───────────────────────────────────────────────────────
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const spinner   = document.getElementById('spinner');
    const submitBtn = document.getElementById('submit-btn');
    spinner.classList.remove('d-none');
    submitBtn.disabled = true;

    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email:    document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        const { user } = data;
        redirectByRole(user?.role ?? 'operador');
      } else {
        showAlert(data.errors?.[0]?.msg ?? data.error ?? 'Error al iniciar sesión.');
      }
    } catch {
      showAlert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      submitBtn.disabled = false;
    }
  });
}

// ── Formulario de REGISTRO ────────────────────────────────────────────────────
const registerForm = document.getElementById('register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password    = document.getElementById('password').value;
    const confirmPwd  = document.getElementById('confirm-password').value;
    if (password !== confirmPwd) {
      showAlert('Las contraseñas no coinciden.');
      return;
    }

    const spinner   = document.getElementById('spinner');
    const submitBtn = document.getElementById('submit-btn');
    spinner.classList.remove('d-none');
    submitBtn.disabled = true;

    try {
      const res  = await fetch('/api/auth/register', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          email:    document.getElementById('email').value.trim(),
          password,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        showAlert(
          `Cuenta creada${data.role === 'admin' ? ' (administrador)' : ''}. Redirigiendo...`,
          'success'
        );
        setTimeout(() => window.location.replace('/index.html'), 1600);
      } else {
        showAlert(data.errors?.[0]?.msg ?? data.error ?? 'Error al registrarse.');
      }
    } catch {
      showAlert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      submitBtn.disabled = false;
    }
  });
}
