/* public/js/admin.js – panel de gestión de credenciales (vanilla, sin Bootstrap) */
'use strict';

// ── Toasts ────────────────────────────────────────────────────────────────────
function ensureToastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}
function toast(message, type = 'info', duration = 3500) {
  const stack = ensureToastStack();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#059669" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#d97706" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12.25a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#2563eb" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  };
  t.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-body">${String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
    <button class="toast-close" aria-label="Cerrar">×</button>
  `;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const remove = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); };
  t.querySelector('.toast-close').addEventListener('click', remove);
  if (duration > 0) setTimeout(remove, duration);
  return t;
}

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
function updatePoolCounter() {
  const checked = document.querySelectorAll('.asignar-check:checked').length;
  const num = document.getElementById('stat-pool-num');
  if (num) num.textContent = checked;
}

function flashPoolSaved() {
  const tag = document.getElementById('stat-pool-saved');
  if (!tag) return;
  tag.classList.remove('d-none');
  clearTimeout(flashPoolSaved._t);
  flashPoolSaved._t = setTimeout(() => tag.classList.add('d-none'), 1800);
}

// Debounce + cancelación: si el admin marca/desmarca varias veces seguidas,
// solo se guarda el estado final.
let savePoolTimer = null;
let savePoolAbort = null;
async function savePoolDebounced() {
  updatePoolCounter();
  clearTimeout(savePoolTimer);
  savePoolTimer = setTimeout(async () => {
    const ids = [...document.querySelectorAll('.asignar-check:checked')].map(c => Number(c.dataset.id));
    if (savePoolAbort) savePoolAbort.abort();
    savePoolAbort = new AbortController();
    try {
      const res = await fetch('/api/admin/auto-assign-pool', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ reviewerIds: ids }),
        signal:      savePoolAbort.signal,
      });
      if (res.ok) {
        flashPoolSaved();
        toast(`Pool de asignación automática actualizado (${ids.length} revisor${ids.length !== 1 ? 'es' : ''}).`, 'success', 2500);
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('No se pudo guardar el pool:', e);
    }
  }, 400);
}

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
      document.getElementById('stat-pool-num').textContent = '0';
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
              <th style="width:42px;" title="Marca para incluir al revisor en el pool de asignación automática">Auto</th>
              <th>Revisor</th>
              <th>Correo</th>
              <th style="text-align:right;">Asignados pendientes</th>
              <th style="text-align:right;">Total revisados</th>
              <th style="text-align:right;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${reviewers.map(r => `
              <tr${r.auto_assign ? ' style="background:#f0fdf4;"' : ''}>
                <td><input type="checkbox" class="asignar-check" data-id="${r.id}" ${r.auto_assign ? 'checked' : ''} /></td>
                <td style="font-weight:600;">
                  ${escapeHtml(r.username)}
                  ${r.auto_assign ? '<span style="display:inline-block;margin-left:0.4rem;background:#dcfce7;color:#15803d;font-size:0.65rem;font-weight:700;padding:0.1rem 0.4rem;border-radius:99px;border:1px solid #86efac;">AUTO</span>' : ''}
                </td>
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

    updatePoolCounter();

    // Auto-guardar el pool cuando cambia cualquier checkbox
    container.querySelectorAll('.asignar-check').forEach(cb => {
      cb.addEventListener('change', () => {
        // Sombrear/desombrear la fila inmediatamente para feedback visual
        const row = cb.closest('tr');
        if (row) row.style.background = cb.checked ? '#f0fdf4' : '';
        savePoolDebounced();
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger small">${escapeHtml(err.message)}</div>`;
  }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const dashState = { initialized: false, charts: {}, lastTimelineDays: 30 };

function fmtN(n) {
  if (typeof n === 'string') return n;                  // strings (ej. "75%", "3 / 5") se devuelven tal cual
  return Number(n ?? 0).toLocaleString('es-CO');
}
function fmtDateShort(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderKpis(k) {
  const cards = [
    { label: 'Envíos totales',         value: k.envios_total,        accent: '#0ea5e9', hint: `${fmtN(k.envios_aprobados)} aprobados · ${fmtN(k.envios_rechazados)} rechazados` },
    { label: 'Pendientes',             value: k.envios_pendientes,   accent: '#d97706', hint: `${fmtN(k.envios_sin_asignar)} sin asignar` },
    { label: 'Tasa de aprobación',     value: `${k.tasa_aprobacion}%`, accent: '#059669', hint: 'Sobre el total de envíos' },
    { label: 'Revisiones realizadas',  value: k.revisiones_total,    accent: '#7c3aed', hint: `${fmtN(k.revisores_activos)} revisores activos` },
    { label: 'Revisores en pool auto', value: `${k.revisores_en_pool} / ${k.revisores_total}`, accent: '#10b981', hint: 'Reciben envíos nuevos automáticamente' },
    { label: 'Operadores activos',     value: `${k.operadores_activos} / ${k.operadores_total}`, accent: '#f59e0b', hint: 'Que han hecho al menos un envío' },
  ];
  document.getElementById('kpi-grid').innerHTML = cards.map(c => `
    <div class="kpi-card" style="--kpi-accent:${c.accent};">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${fmtN(c.value)}</div>
      <div class="kpi-hint">${c.hint}</div>
    </div>
  `).join('');
  if (window.gsap) gsap.from('.kpi-card', { y: 14, opacity: 0, stagger: 0.06, duration: 0.4, ease: 'power2.out' });
}

function chartFontDefaults() {
  if (window.Chart) {
    Chart.defaults.font.family = "'Satoshi', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#475569';
  }
}

function destroyChart(id) {
  if (dashState.charts[id]) { dashState.charts[id].destroy(); delete dashState.charts[id]; }
}

function renderStatusChart(k) {
  destroyChart('status');
  const ctx = document.getElementById('chart-status');
  dashState.charts.status = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Aprobados', 'Rechazados', 'Pendientes'],
      datasets: [{
        data: [k.envios_aprobados, k.envios_rechazados, k.envios_pendientes],
        backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 14, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${fmtN(ctx.parsed)} (${(ctx.parsed / (k.envios_total || 1) * 100).toFixed(1)}%)`,
          },
        },
      },
      animation: { animateRotate: true, animateScale: true, duration: 800 },
    },
  });
}

function renderReviewersChart(reviewers) {
  destroyChart('reviewers');
  const top = reviewers.slice(0, 10);
  const ctx = document.getElementById('chart-reviewers');
  dashState.charts.reviewers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(r => r.username),
      datasets: [
        { label: 'Aprobadas', data: top.map(r => r.aprobadas_historico), backgroundColor: '#10b981', stack: 's1' },
        { label: 'Rechazadas', data: top.map(r => r.rechazadas_historico), backgroundColor: '#ef4444', stack: 's1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { stacked: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0 } },
        y: { stacked: true, grid: { display: false } },
      },
      animation: { duration: 600, easing: 'easeOutQuart' },
    },
  });
}

function renderOperatorsChart(operators) {
  destroyChart('operators');
  const top = operators.slice(0, 10);
  const ctx = document.getElementById('chart-operators');
  dashState.charts.operators = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(o => o.username),
      datasets: [
        { label: 'Aprobados', data: top.map(o => o.envios_aprobados), backgroundColor: '#10b981', stack: 's1' },
        { label: 'Pendientes', data: top.map(o => o.envios_pendientes), backgroundColor: '#f59e0b', stack: 's1' },
        { label: 'Rechazados', data: top.map(o => o.envios_rechazados), backgroundColor: '#ef4444', stack: 's1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45, minRotation: 30, font: { size: 10 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0 } },
      },
      animation: { duration: 600, easing: 'easeOutQuart' },
    },
  });
}

function renderTimelineChart(timeline) {
  destroyChart('timeline');
  // Construir todas las fechas del rango para evitar huecos
  const dias = timeline.dias || 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels = [];
  const map = {};
  for (let i = dias; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    labels.push(iso);
    map[iso] = { envios: 0, aprobados: 0, rechazados: 0 };
  }
  for (const r of (timeline.envios || []))      if (map[r.dia]) map[r.dia].envios = r.cnt;
  for (const r of (timeline.decisiones || []))  if (map[r.dia]) {
    if (r.status === 'aprobado')  map[r.dia].aprobados  = r.cnt;
    if (r.status === 'rechazado') map[r.dia].rechazados = r.cnt;
  }
  const labelsShort = labels.map(d => {
    const dd = new Date(d);
    return dd.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  });

  const ctx = document.getElementById('chart-timeline');
  dashState.charts.timeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labelsShort,
      datasets: [
        { label: 'Envíos nuevos',     data: labels.map(d => map[d].envios),     borderColor: '#0ea5e9', backgroundColor: '#0ea5e933', fill: true, tension: 0.35, pointRadius: 2, pointHoverRadius: 5 },
        { label: 'Decisiones aprobadas',  data: labels.map(d => map[d].aprobados),  borderColor: '#10b981', backgroundColor: '#10b98122', fill: false, tension: 0.35, pointRadius: 2, pointHoverRadius: 5 },
        { label: 'Decisiones rechazadas', data: labels.map(d => map[d].rechazados), borderColor: '#ef4444', backgroundColor: '#ef444422', fill: false, tension: 0.35, pointRadius: 2, pointHoverRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 12 } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0 } },
      },
      animation: { duration: 600, easing: 'easeOutQuart' },
    },
  });
}

function renderRecentActivity(data) {
  const cont = document.getElementById('actividad-reciente');
  const items = [];
  for (const s of (data.recent_submissions || [])) {
    const st = s.status;
    const cls = st === 'aprobado' ? 'bg-success' : st === 'rechazado' ? 'bg-danger' : 'bg-warning';
    const icon = st === 'aprobado'
      ? '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
      : st === 'rechazado'
      ? '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
      : '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    items.push({
      when: s.submitted_at,
      html: `<div class="activity-item">
        <div class="activity-icon ${cls}">${icon}</div>
        <div>
          <div class="activity-body">Envío #${s.id} de <strong>${escapeHtml(s.operador)}</strong> · ${st === 'pendiente_revision' ? 'pendiente' : st}</div>
          <div class="activity-meta">${fmtDateShort(s.submitted_at)}</div>
        </div>
      </div>`,
    });
  }
  items.sort((a, b) => new Date(b.when) - new Date(a.when));
  cont.innerHTML = items.length ? items.slice(0, 15).map(i => i.html).join('') : '<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:0.85rem;">Sin actividad reciente.</div>';
}

function renderReviewersTable(reviewers) {
  const cont = document.getElementById('tabla-revisores');
  if (!reviewers.length) { cont.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;">Sin revisores registrados.</p>'; return; }
  cont.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead><tr>
          <th>Revisor</th>
          <th style="text-align:right;">Histórico</th>
          <th style="text-align:right;">Aprob. hist.</th>
          <th style="text-align:right;">Rech. hist.</th>
          <th style="text-align:right;">Pendientes</th>
          <th>Última revisión</th>
          <th style="text-align:center;">Auto</th>
        </tr></thead>
        <tbody>
          ${reviewers.map(r => `
            <tr${r.auto_assign ? ' style="background:#f0fdf4;"' : ''}>
              <td>
                <div style="font-weight:600;">${escapeHtml(r.username)}</div>
                <div style="font-size:0.75rem;color:#94a3b8;">${escapeHtml(r.email)}</div>
              </td>
              <td style="text-align:right;font-weight:800;color:#0f172a;">${fmtN(r.revisiones_historico)}</td>
              <td style="text-align:right;color:#059669;font-weight:700;">${fmtN(r.aprobadas_historico)}</td>
              <td style="text-align:right;color:#dc2626;font-weight:700;">${fmtN(r.rechazadas_historico)}</td>
              <td style="text-align:right;color:#d97706;font-weight:700;">${fmtN(r.pendientes_asignadas)}</td>
              <td style="font-size:0.78rem;color:#64748b;">${fmtDateShort(r.ultima_revision)}</td>
              <td style="text-align:center;">${r.auto_assign ? '<span style="background:#dcfce7;color:#15803d;font-size:0.65rem;font-weight:700;padding:0.1rem 0.45rem;border-radius:99px;border:1px solid #86efac;">AUTO</span>' : '<span style="color:#cbd5e1;">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderOperatorsTable(operators) {
  const cont = document.getElementById('tabla-operadores');
  if (!operators.length) { cont.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;">Sin operadores registrados.</p>'; return; }
  cont.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead><tr>
          <th>Operador</th>
          <th style="text-align:right;">Total envíos</th>
          <th style="text-align:right;">Aprobados</th>
          <th style="text-align:right;">Pendientes</th>
          <th style="text-align:right;">Rechazados</th>
          <th style="text-align:right;">% Aprobación</th>
          <th>Último envío</th>
        </tr></thead>
        <tbody>
          ${operators.map(o => {
            const tasa = o.envios_total ? (o.envios_aprobados / o.envios_total * 100).toFixed(0) : 0;
            return `
              <tr>
                <td>
                  <div style="font-weight:600;">${escapeHtml(o.username)}</div>
                  <div style="font-size:0.75rem;color:#94a3b8;">${escapeHtml(o.email)}</div>
                </td>
                <td style="text-align:right;font-weight:800;">${fmtN(o.envios_total)}</td>
                <td style="text-align:right;color:#059669;font-weight:700;">${fmtN(o.envios_aprobados)}</td>
                <td style="text-align:right;color:#d97706;font-weight:700;">${fmtN(o.envios_pendientes)}</td>
                <td style="text-align:right;color:#dc2626;font-weight:700;">${fmtN(o.envios_rechazados)}</td>
                <td style="text-align:right;">
                  <span style="font-weight:700;color:${tasa >= 75 ? '#059669' : tasa >= 50 ? '#d97706' : '#dc2626'};">${tasa}%</span>
                </td>
                <td style="font-size:0.78rem;color:#64748b;">${fmtDateShort(o.ultimo_envio)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadDashboard() {
  chartFontDefaults();
  try {
    const [kpiR, revR, opR, tlR, actR] = await Promise.all([
      fetch('/api/admin/dashboard/kpis',            { credentials: 'same-origin' }),
      fetch('/api/admin/dashboard/reviewers',       { credentials: 'same-origin' }),
      fetch('/api/admin/dashboard/operators',       { credentials: 'same-origin' }),
      fetch(`/api/admin/dashboard/timeline?dias=${dashState.lastTimelineDays}`, { credentials: 'same-origin' }),
      fetch('/api/admin/dashboard/recent-activity', { credentials: 'same-origin' }),
    ]);
    const kpi = await kpiR.json();
    const rev = await revR.json();
    const op  = await opR.json();
    const tl  = await tlR.json();
    const act = await actR.json();

    renderKpis(kpi);
    renderStatusChart(kpi);
    renderReviewersChart(rev.reviewers || []);
    renderOperatorsChart(op.operators || []);
    renderTimelineChart(tl);
    renderRecentActivity(act);
    renderReviewersTable(rev.reviewers || []);
    renderOperatorsTable(op.operators || []);
  } catch (e) {
    console.error('[dashboard] Error:', e);
    toast('No se pudo cargar el dashboard.', 'error');
  }
}

// ── Respaldo de datos ────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

async function loadBackupSummary() {
  try {
    const res = await fetch('/api/admin/backup-summary', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('No se pudo obtener el resumen.');
    const data = await res.json();

    document.getElementById('stat-bk-envios').textContent        = data.counts.submissions ?? 0;
    document.getElementById('stat-bk-archivos').textContent      = data.files_on_disk ?? 0;
    document.getElementById('stat-bk-observaciones').textContent = data.counts.review_fields ?? 0;
    document.getElementById('stat-bk-usuarios').textContent      = data.counts.users ?? 0;
    document.getElementById('stat-bk-tamano').textContent        = formatBytes((data.uploads_bytes || 0) + (data.db_bytes || 0));
  } catch {
    ['stat-bk-envios','stat-bk-archivos','stat-bk-observaciones','stat-bk-usuarios','stat-bk-tamano'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'Error';
    });
  }
}

function showRespaldoAlert(msg, type = 'danger') {
  const box = document.getElementById('respaldo-alert');
  if (!box) return;
  box.innerHTML = `<div class="alert alert-${type}" style="margin:0;">${escapeHtml(msg)}</div>`;
  box.classList.remove('d-none');
}

async function handleDownloadBackup() {
  const btn     = document.getElementById('btn-descargar-respaldo');
  const spinner = document.getElementById('spinner-respaldo');
  const alertBox = document.getElementById('respaldo-alert');
  alertBox?.classList.add('d-none');

  if (!confirm('Se descargará un archivo ZIP con TODA la base de datos, los documentos PDF, imágenes y observaciones. Puede pesar varios MB. ¿Continuar?')) {
    return;
  }

  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/backup-completo.zip', { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = 'No se pudo generar el respaldo.';
      try { const data = await res.json(); msg = data.error ?? msg; } catch { /* ignore */ }
      showRespaldoAlert(msg);
      return;
    }

    const blob = await res.blob();
    const today = new Date().toISOString().slice(0, 10);
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `backup-mintic-${today}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    showRespaldoAlert(`Respaldo descargado correctamente (${formatBytes(blob.size)}).`, 'success');
  } catch (e) {
    showRespaldoAlert('Error de conexión al descargar el respaldo.');
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
  }
}

async function handleDownloadDatabase() {
  const btn     = document.getElementById('btn-descargar-db');
  const spinner = document.getElementById('spinner-db');
  const alertBox = document.getElementById('respaldo-alert');
  alertBox?.classList.add('d-none');

  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/database.sqlite', { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = 'No se pudo descargar la base de datos.';
      try { const data = await res.json(); msg = data.error ?? msg; } catch { /* ignore */ }
      showRespaldoAlert(msg);
      return;
    }

    const blob  = await res.blob();
    const today = new Date().toISOString().slice(0, 10);
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `database-mintic-${today}.sqlite`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    showRespaldoAlert(`Base de datos descargada correctamente (${formatBytes(blob.size)}).`, 'success');
  } catch {
    showRespaldoAlert('Error de conexión al descargar la base de datos.');
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
  }
}

function showEnviosAlert(msg, type = 'danger') {
  const box = document.getElementById('envios-alert');
  if (!box) return;
  box.innerHTML = `<div class="alert alert-${type}" style="margin:0;">${escapeHtml(msg)}</div>`;
  box.classList.remove('d-none');
}

async function handleDownloadEnvios() {
  const btn     = document.getElementById('btn-descargar-envios');
  const spinner = document.getElementById('spinner-envios');
  document.getElementById('envios-alert')?.classList.add('d-none');

  spinner.classList.remove('d-none');
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/envios-consolidados.xlsx', { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = 'No se pudo generar el reporte de envíos.';
      try { const data = await res.json(); msg = data.error ?? msg; } catch { /* ignore */ }
      showEnviosAlert(msg);
      return;
    }

    const blob  = await res.blob();
    const today = new Date().toISOString().slice(0, 10);
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `envios-consolidados-${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    showEnviosAlert(`Reporte descargado correctamente (${formatBytes(blob.size)}).`, 'success');
    toast('Reporte de envíos descargado.', 'success', 2500);
  } catch {
    showEnviosAlert('Error de conexión al descargar el reporte.');
  } finally {
    spinner.classList.add('d-none');
    btn.disabled = false;
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
    // Guardar también el pool persistente para que los próximos envíos vayan a estos revisores
    await fetch('/api/admin/auto-assign-pool', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ reviewerIds }),
    }).catch(() => { /* no bloquear el flujo si falla */ });

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
          <div style="font-size:0.78rem;color:#15803d;margin-bottom:0.35rem;">✓ Pool de asignación automática actualizado. Los próximos envíos se asignarán a estos revisores.</div>
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
      // Refrescar la vista al entrar en ella
      if (btn.dataset.target === 'panel-dashboard') loadDashboard();
      if (btn.dataset.target === 'panel-asignar')   loadAssignmentOverview();
      if (btn.dataset.target === 'panel-respaldo')  loadBackupSummary();
    });
  });

  // Selector de días en el timeline
  document.getElementById('timeline-days')?.addEventListener('change', (e) => {
    dashState.lastTimelineDays = parseInt(e.target.value, 10) || 30;
    loadDashboard();
  });

  // ── Respaldo de datos ─────────────────────────────────────────────────────
  document.getElementById('btn-refrescar-respaldo')?.addEventListener('click', loadBackupSummary);
  document.getElementById('btn-descargar-respaldo')?.addEventListener('click', handleDownloadBackup);
  document.getElementById('btn-descargar-db')?.addEventListener('click', handleDownloadDatabase);
  document.getElementById('btn-descargar-envios')?.addEventListener('click', handleDownloadEnvios);

  // ── Asignación de revisiones ──────────────────────────────────────────────
  document.getElementById('btn-refrescar-asignacion')?.addEventListener('click', loadAssignmentOverview);
  document.getElementById('btn-asignar-confirmar')?.addEventListener('click', handleAssignReviews);
  document.getElementById('btn-asignar-todos')?.addEventListener('click', () => {
    document.querySelectorAll('.asignar-check').forEach(c => {
      c.checked = true;
      const row = c.closest('tr');
      if (row) row.style.background = '#f0fdf4';
    });
    savePoolDebounced();
  });
  document.getElementById('btn-asignar-ninguno')?.addEventListener('click', () => {
    document.querySelectorAll('.asignar-check').forEach(c => {
      c.checked = false;
      const row = c.closest('tr');
      if (row) row.style.background = '';
    });
    savePoolDebounced();
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
        toast(`${role[0].toUpperCase()}${role.slice(1)} creado exitosamente.`, 'success');
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
        toast('Usuario eliminado.', 'success');
        // Recargar las tres listas + overview por si se borró un revisor con asignaciones
        await Promise.all([
          loadUsers('admin'),
          loadUsers('revisor'),
          loadUsers('operador'),
          loadAssignmentOverview(),
        ]);
      } else {
        const data = await res.json();
        toast(data.error ?? 'Error al eliminar.', 'error');
      }
    } catch {
      toast('Error de conexión. Intenta nuevamente.', 'error');
    } finally {
      spinner.classList.add('d-none');
      btn.disabled = false;
      pendingDeleteId   = null;
      pendingDeleteRole = null;
    }
  });

})();
