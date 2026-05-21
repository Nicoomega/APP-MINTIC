/* public/js/admin.js – panel de gestión de credenciales (vanilla, sin Bootstrap) */
'use strict';

// ── Modal helpers (vanilla) ───────────────────────────────────────────────────
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('d-none');
  const box = overlay.querySelector('.modal-box');
  if (box && window.gsap) {
    gsap.fromTo(box,
      { scale: 0.92, opacity: 0, y: 16 },
      { scale: 1,    opacity: 1, y: 0, duration: 0.25, ease: 'back.out(1.5)' }
    );
  }
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  const box = overlay.querySelector('.modal-box');
  const hide = () => overlay.classList.add('d-none');
  if (box && window.gsap) {
    gsap.to(box, { scale: 0.94, opacity: 0, y: 8, duration: 0.18, ease: 'power2.in', onComplete: hide });
  } else {
    hide();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function formatDate(str) {
  return new Date(str).toLocaleString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function showModalAlert(msg, type = 'danger') {
  const box = document.getElementById('modal-alert');
  box.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:0.75rem;">${escapeHtml(msg)}</div>`;
}
function showEditAlert(msg, type = 'danger') {
  const box = document.getElementById('modal-editar-alert');
  box.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:0.75rem;">${escapeHtml(msg)}</div>`;
}

// ── Verificar que sea administrador ──────────────────────────────────────────
async function requireAdmin() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.replace('/index.html'); return null; }
    const { user } = await res.json();
    if (user.role !== 'admin') { window.location.replace('/index.html'); return null; }
    return user;
  } catch {
    window.location.replace('/index.html');
    return null;
  }
}

// ── Renderizar tabla de usuarios ──────────────────────────────────────────────
const ROLE_LABEL_PLURAL = { admin: 'administradores', revisor: 'revisores', operador: 'operadores' };

function renderTable(users, role) {
  const containerId = `table-${role}`;
  const countId     = `count-${role}`;
  const container   = document.getElementById(containerId);
  const countBadge  = document.getElementById(countId);

  countBadge.textContent = users.length;

  if (!users.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:2rem 1rem;">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg>
        <p>No hay ${ROLE_LABEL_PLURAL[role] ?? role + 's'} registrados aún.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Correo</th>
            <th>Creado</th>
            <th style="text-align:right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td style="font-weight:600;">${escapeHtml(u.username)}</td>
              <td style="color:#64748b;font-size:0.83rem;">${escapeHtml(u.email)}</td>
              <td style="color:#94a3b8;font-size:0.8rem;">${formatDate(u.created_at)}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:0.4rem;justify-content:flex-end;">
                  <button class="btn btn-ghost btn-sm btn-editar"
                          data-id="${u.id}"
                          data-username="${escapeHtml(u.username)}"
                          data-email="${escapeHtml(u.email)}"
                          data-role="${escapeHtml(u.role ?? role)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    Editar
                  </button>
                  <button class="btn btn-danger btn-sm btn-eliminar"
                          data-id="${u.id}"
                          data-username="${escapeHtml(u.username)}"
                          data-email="${escapeHtml(u.email)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Cargar usuarios de un rol ─────────────────────────────────────────────────
async function loadUsers(role) {
  try {
    const res = await fetch(`/api/admin/users?role=${role}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Error al cargar usuarios.');
    const { users } = await res.json();
    renderTable(users, role);
  } catch (err) {
    document.getElementById(`table-${role}`).innerHTML = `
      <div class="alert alert-danger small">${escapeHtml(err.message)}</div>`;
  }
}

// ── Estado del modal de eliminación ──────────────────────────────────────────
let pendingDeleteId   = null;
let pendingDeleteRole = null;

// ── Asignación de revisiones ─────────────────────────────────────────────────
async function loadAssignmentOverview() {
  const container = document.getElementById('asignar-list-container');
  try {
    const res = await fetch('/api/admin/assignment-overview', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('No se pudo cargar la información de asignación.');
    const { reviewers, pending_unassigned } = await res.json();

    document.getElementById('stat-pendientes').textContent = pending_unassigned;
    document.getElementById('stat-revisores').textContent  = reviewers.length;
    document.getElementById('count-pending').textContent   = pending_unassigned;

    if (!reviewers.length) {
      container.innerHTML = `
        <div class="empty-state" style="padding:1.5rem 1rem;">
          <p style="margin:0;font-size:0.85rem;color:#94a3b8;">No hay revisores registrados. Crea al menos uno en la pestaña "Revisores MINTIC".</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:42px;"></th>
              <th>Revisor</th>
              <th>Correo</th>
              <th style="text-align:right;">Asignados pendientes</th>
              <th style="text-align:right;">Total revisados</th>
              <th style="text-align:right;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${reviewers.map(r => `
              <tr>
                <td><input type="checkbox" class="asignar-check" data-id="${r.id}" checked /></td>
                <td style="font-weight:600;">${escapeHtml(r.username)}</td>
                <td style="color:#64748b;font-size:0.83rem;">${escapeHtml(r.email)}</td>
                <td style="text-align:right;font-weight:700;color:#92400e;">${r.assigned_pending}</td>
                <td style="text-align:right;color:#1e40af;font-weight:700;">${r.reviewed_total}</td>
                <td style="text-align:right;">
                  <button class="btn btn-ghost btn-sm btn-liberar"
                          data-id="${r.id}"
                          data-username="${escapeHtml(r.username)}"
                          data-count="${r.assigned_pending}"
                          ${r.assigned_pending === 0 ? 'disabled' : ''}
                          title="Liberar todos los envíos pendientes asignados a este revisor">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 13l-7 7-7-7m14-8l-7 7-7-7"/></svg>
                    Liberar
                  </button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger small">${escapeHtml(err.message)}</div>`;
  }
}

async function handleAssignReviews() {
  const checks = [...document.querySelectorAll('.asignar-check:checked')];
  const reviewerIds = checks.map(c => Number(c.dataset.id));
  const resultBox = document.getElementById('asignar-result');
  resultBox.classList.add('d-none');

  if (!reviewerIds.length) {
    resultBox.innerHTML = '<div class="alert alert-danger" style="margin:0;">Selecciona al menos un revisor.</div>';
    resultBox.classList.remove('d-none');
    return;
  }

  const spinner = document.getElementById('spinner-asignar');
  const btn     = document.getElementById('btn-asignar-confirmar');
  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const res  = await fetch('/api/admin/assign-reviews', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ reviewerIds }),
    });
    const data = await res.json();

    if (res.ok) {
      const rows = (data.distribution ?? [])
        .map(d => `<li><strong>${escapeHtml(d.username)}</strong>: ${d.count} envío(s)</li>`)
        .join('');
      resultBox.innerHTML = `
        <div class="alert alert-success" style="margin:0;">
          <div style="font-weight:700;margin-bottom:0.35rem;">${escapeHtml(data.message)}</div>
          <ul style="margin:0;padding-left:1.1rem;font-size:0.85rem;">${rows}</ul>
        </div>`;
      resultBox.classList.remove('d-none');
      await loadAssignmentOverview();
    } else {
      resultBox.innerHTML = `<div class="alert alert-danger" style="margin:0;">${escapeHtml(data.error ?? data.errors?.[0]?.msg ?? 'Error al asignar.')}</div>`;
      resultBox.classList.remove('d-none');
    }
  } catch {
    resultBox.innerHTML = '<div class="alert alert-danger" style="margin:0;">Error de conexión. Intenta nuevamente.</div>';
    resultBox.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
  }
}

// ── Inicialización ────────────────────────────────────────────────────────────
(async () => {
  const user = await requireAdmin();
  if (!user) return;

  document.getElementById('user-greeting').textContent = `Hola, ${user.username}`;

  // GSAP entrance
  if (window.gsap) {
    gsap.from('.page-content > *', { opacity: 0, y: 22, stagger: 0.07, duration: 0.45, ease: 'power2.out' });
  }

  // Cargar listas y resumen de asignación
  await Promise.all([
    loadUsers('admin'),
    loadUsers('revisor'),
    loadUsers('operador'),
    loadAssignmentOverview(),
  ]);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.target)?.classList.add('active');
      // Refrescar la vista de asignación al entrar en ella
      if (btn.dataset.target === 'panel-asignar') loadAssignmentOverview();
    });
  });

  // ── Asignación de revisiones ──────────────────────────────────────────────
  document.getElementById('btn-refrescar-asignacion')?.addEventListener('click', loadAssignmentOverview);
  document.getElementById('btn-asignar-confirmar')?.addEventListener('click', handleAssignReviews);
  document.getElementById('btn-asignar-todos')?.addEventListener('click', () => {
    document.querySelectorAll('.asignar-check').forEach(c => { c.checked = true; });
  });
  document.getElementById('btn-asignar-ninguno')?.addEventListener('click', () => {
    document.querySelectorAll('.asignar-check').forEach(c => { c.checked = false; });
  });

  // ── Liberar asignaciones pendientes de un revisor (delegado) ──────────────
  document.getElementById('asignar-list-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-liberar');
    if (!btn || btn.disabled) return;
    const reviewerId = Number(btn.dataset.id);
    const username   = btn.dataset.username;
    const count      = Number(btn.dataset.count);
    if (!confirm(`¿Liberar los ${count} envío(s) pendientes asignados a ${username}? Volverán al pool de pendientes sin asignar.`)) return;

    const resultBox = document.getElementById('asignar-result');
    resultBox.classList.add('d-none');
    btn.disabled = true;
    try {
      const res  = await fetch('/api/admin/clear-reviewer-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reviewerId }),
      });
      const data = await res.json();
      if (res.ok) {
        resultBox.innerHTML = `<div class="alert alert-success" style="margin:0;">${escapeHtml(data.message)}</div>`;
        resultBox.classList.remove('d-none');
        await loadAssignmentOverview();
      } else {
        resultBox.innerHTML = `<div class="alert alert-danger" style="margin:0;">${escapeHtml(data.error ?? 'Error al liberar.')}</div>`;
        resultBox.classList.remove('d-none');
      }
    } catch {
      resultBox.innerHTML = '<div class="alert alert-danger" style="margin:0;">Error de conexión. Intenta nuevamente.</div>';
      resultBox.classList.remove('d-none');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/index.html');
  });

  // ── Abrir modal crear ─────────────────────────────────────────────────────
  const ROLE_LABEL_MODAL = {
    admin:    'Nuevo administrador',
    revisor:  'Nuevo revisor MINTIC',
    operador: 'Nuevo operador',
  };
  document.querySelectorAll('.btn-abrir-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role ?? 'revisor';
      document.getElementById('crear-role').value = role;
      document.getElementById('modal-crear-label').textContent = ROLE_LABEL_MODAL[role] ?? 'Crear usuario';
      document.getElementById('form-crear').reset();
      document.getElementById('modal-alert').innerHTML = '';
      openModal('modal-crear');
    });
  });

  // ── Cerrar modales ────────────────────────────────────────────────────────
  ['modal-crear-close', 'modal-crear-cancel'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('modal-crear'))
  );
  ['modal-eliminar-close', 'modal-eliminar-cancel'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('modal-eliminar'))
  );
  ['modal-editar-close', 'modal-editar-cancel'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('modal-editar'))
  );
  ['modal-crear', 'modal-eliminar', 'modal-editar'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    })
  );

  // ── Toggle contraseña editar ─────────────────────────────────────────────
  document.getElementById('toggle-editar-pwd')?.addEventListener('click', () => {
    const pwd  = document.getElementById('editar-password');
    const eyeO = document.getElementById('ep-eye-open');
    const eyeC = document.getElementById('ep-eye-closed');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      eyeO?.classList.add('d-none');
      eyeC?.classList.remove('d-none');
    } else {
      pwd.type = 'password';
      eyeO?.classList.remove('d-none');
      eyeC?.classList.add('d-none');
    }
  });

  // ── Delegación: abrir modal editar ───────────────────────────────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-editar');
    if (!btn) return;

    document.getElementById('editar-id').value            = btn.dataset.id;
    document.getElementById('editar-role-original').value = btn.dataset.role ?? '';
    document.getElementById('editar-username').value      = btn.dataset.username ?? '';
    document.getElementById('editar-email').value         = btn.dataset.email ?? '';
    document.getElementById('editar-role').value          = btn.dataset.role ?? '';
    document.getElementById('editar-password').value      = '';
    document.getElementById('modal-editar-alert').innerHTML = '';

    // Bloquear cambio de rol si el usuario edita su propia cuenta
    const isSelf = Number(btn.dataset.id) === user.id;
    document.getElementById('editar-role').disabled = isSelf;

    openModal('modal-editar');
  });

  // ── Confirmar edición ─────────────────────────────────────────────────────
  document.getElementById('btn-editar-confirmar').addEventListener('click', async () => {
    const id          = document.getElementById('editar-id').value;
    const username    = document.getElementById('editar-username').value.trim();
    const email       = document.getElementById('editar-email').value.trim();
    const password    = document.getElementById('editar-password').value;
    const role        = document.getElementById('editar-role').value;
    const roleOrig    = document.getElementById('editar-role-original').value;
    const isSelf      = Number(id) === user.id;

    if (!username || !email) {
      showEditAlert('Nombre de usuario y correo son obligatorios.');
      return;
    }

    const body = {};
    if (username) body.username = username;
    if (email)    body.email    = email;
    if (password) body.password = password;
    if (!isSelf && role !== roleOrig) body.role = role;

    const spinner = document.getElementById('spinner-editar');
    const btn     = document.getElementById('btn-editar-confirmar');
    spinner.classList.remove('d-none');
    btn.disabled = true;

    try {
      const res  = await fetch(`/api/admin/users/${id}`, {
        method:      'PATCH',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        closeModal('modal-editar');
        await Promise.all([
          loadUsers('admin'),
          loadUsers('revisor'),
          loadUsers('operador'),
          loadAssignmentOverview(),
        ]);
      } else {
        showEditAlert(data.errors?.[0]?.msg ?? data.error ?? 'Error al guardar.');
      }
    } catch {
      showEditAlert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      btn.disabled = false;
    }
  });

  // ── Toggle contraseña crear ───────────────────────────────────────────────
  document.getElementById('toggle-crear-pwd')?.addEventListener('click', () => {
    const pwd  = document.getElementById('crear-password');
    const eyeO = document.getElementById('cp-eye-open');
    const eyeC = document.getElementById('cp-eye-closed');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      eyeO?.classList.add('d-none');
      eyeC?.classList.remove('d-none');
    } else {
      pwd.type = 'password';
      eyeO?.classList.remove('d-none');
      eyeC?.classList.add('d-none');
    }
  });

  // ── Crear usuario ─────────────────────────────────────────────────────────
  document.getElementById('btn-crear-confirmar').addEventListener('click', async () => {
    const username = document.getElementById('crear-username').value.trim();
    const email    = document.getElementById('crear-email').value.trim();
    const password = document.getElementById('crear-password').value;
    const role     = document.getElementById('crear-role').value;

    if (!username || !email || !password) {
      showModalAlert('Todos los campos son obligatorios.');
      return;
    }

    const spinner = document.getElementById('spinner-crear');
    const btn     = document.getElementById('btn-crear-confirmar');
    spinner.classList.remove('d-none');
    btn.disabled = true;

    try {
      const res  = await fetch('/api/admin/users', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, email, password, role }),
      });
      const data = await res.json();

      if (res.ok) {
        closeModal('modal-crear');
        await loadUsers(role);
        // Cambiar a la pestaña del rol creado
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`tab-${role}`)?.classList.add('active');
        document.getElementById(`panel-${role}`)?.classList.add('active');
      } else {
        showModalAlert(data.errors?.[0]?.msg ?? data.error ?? 'Error al crear el usuario.');
      }
    } catch {
      showModalAlert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      btn.disabled = false;
    }
  });

  // ── Delegación: abrir modal eliminar ─────────────────────────────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-eliminar');
    if (!btn) return;

    pendingDeleteId   = btn.dataset.id;
    pendingDeleteRole = btn.closest('[id^="table-"]')?.id?.replace('table-', '') ?? null;

    document.getElementById('eliminar-nombre').textContent = btn.dataset.username;
    document.getElementById('eliminar-email').textContent  = btn.dataset.email;
    openModal('modal-eliminar');
  });

  // ── Confirmar eliminación ─────────────────────────────────────────────────
  document.getElementById('btn-eliminar-confirmar').addEventListener('click', async () => {
    if (!pendingDeleteId) return;

    const spinner = document.getElementById('spinner-eliminar');
    const btn     = document.getElementById('btn-eliminar-confirmar');
    spinner.classList.remove('d-none');
    btn.disabled = true;

    try {
      const res = await fetch(`/api/admin/users/${pendingDeleteId}`, {
        method:      'DELETE',
        credentials: 'same-origin',
      });

      if (res.ok) {
        closeModal('modal-eliminar');
        // Recargar las tres listas + overview por si se borró un revisor con asignaciones
        await Promise.all([
          loadUsers('admin'),
          loadUsers('revisor'),
          loadUsers('operador'),
          loadAssignmentOverview(),
        ]);
      } else {
        const data = await res.json();
        alert(data.error ?? 'Error al eliminar.');
      }
    } catch {
      alert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      btn.disabled = false;
      pendingDeleteId   = null;
      pendingDeleteRole = null;
    }
  });

})();
