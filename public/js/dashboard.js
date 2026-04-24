/* public/js/dashboard.js – panel de respuestas */
'use strict';

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

function formatSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIconClass(mime) {
  if (mime.startsWith('image/'))               return 'fas fa-image text-success';
  if (mime === 'application/pdf')              return 'fas fa-file-pdf text-danger';
  if (mime.includes('word'))                   return 'fas fa-file-word text-primary';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return 'fas fa-file-excel text-success';
  if (mime === 'text/plain' || mime === 'text/csv')            return 'fas fa-file-alt text-secondary';
  if (mime.includes('zip'))                    return 'fas fa-file-archive text-warning';
  return 'fas fa-file text-muted';
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function requireAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.replace('/index.html'); return null; }
    return (await res.json()).user;
  } catch {
    window.location.replace('/index.html');
    return null;
  }
}

// ── Cargar respuestas ─────────────────────────────────────────────────────────
async function loadResponses(isAdmin) {
  const url = isAdmin ? '/api/questionnaire' : '/api/questionnaire/my';
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('No se pudieron cargar los registros.');
  return (await res.json()).responses;
}

// ── Renderizar tarjetas ───────────────────────────────────────────────────────
function renderResponses(responses, isAdmin) {
  const container = document.getElementById('responses-container');

  if (!responses.length) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="fas fa-inbox fa-3x mb-3"></i>
        <p class="mb-2">No hay registros aún.</p>
        <a href="/questionnaire.html" class="btn btn-primary btn-sm">
          <i class="fas fa-plus me-1"></i>Crear primer registro
        </a>
      </div>`;
    return;
  }

  container.innerHTML = responses.map(r => `
    <div class="card response-card border-0 shadow-sm rounded-3 mb-3">
      <div class="card-body p-3">
        <div class="d-flex align-items-start justify-content-between gap-2">
          <div class="flex-grow-1 overflow-hidden">
            <h6 class="fw-bold mb-1">${escapeHtml(r.nombre)}</h6>
            <div class="d-flex flex-wrap gap-3 text-muted small">
              <span><i class="fas fa-id-card me-1"></i>C.C. ${escapeHtml(r.cedula)}</span>
              <span><i class="fas fa-envelope me-1"></i>${escapeHtml(r.correo)}</span>
              ${r.link_vitrina
                ? `<a href="${escapeHtml(r.link_vitrina)}" target="_blank" rel="noopener noreferrer"
                      class="text-decoration-none text-primary">
                     <i class="fas fa-link me-1"></i>Ver vitrina
                   </a>`
                : ''}
              ${isAdmin && r.submitted_by
                ? `<span><i class="fas fa-user me-1"></i>${escapeHtml(r.submitted_by)}</span>`
                : ''}
            </div>
          </div>
          <div class="text-end text-nowrap">
            <div class="text-muted small">${formatDate(r.created_at)}</div>
            ${r.attachment_count > 0
              ? `<span class="badge bg-secondary mt-1">
                   <i class="fas fa-paperclip me-1"></i>${r.attachment_count} archivo(s)
                 </span>`
              : ''}
          </div>
        </div>
        <div class="mt-2">
          <button class="btn btn-outline-primary btn-sm detail-btn" data-id="${r.id}">
            <i class="fas fa-eye me-1"></i>Ver detalle
          </button>
        </div>
      </div>
    </div>`).join('');

  // Delegación de eventos para botones "Ver detalle"
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.detail-btn');
    if (btn) showDetail(parseInt(btn.dataset.id, 10));
  });
}

// ── Modal: mostrar detalle ────────────────────────────────────────────────────
const detailModal = new bootstrap.Modal(document.getElementById('detail-modal'));

async function showDetail(id) {
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div class="text-center py-4">
      <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Cargando…</span></div>
    </div>`;
  detailModal.show();

  try {
    const res  = await fetch(`/api/questionnaire/${id}`, { credentials: 'same-origin' });
    const data = await res.json();

    if (!res.ok) {
      modalBody.innerHTML = `<div class="alert alert-danger small">${escapeHtml(data.error)}</div>`;
      return;
    }

    const { response: r, attachments } = data;

    const attachHtml = attachments.length
      ? `<div class="mt-4">
           <p class="detail-row-label mb-2">
             <i class="fas fa-paperclip me-1"></i>Archivos adjuntos (${attachments.length})
           </p>
           ${attachments.map(a => `
             <a class="attachment-link"
                href="/api/questionnaire/${r.id}/files/${encodeURIComponent(a.stored_name)}"
                target="_blank" rel="noopener noreferrer">
               <i class="${fileIconClass(a.mimetype)} att-icon"></i>
               <div class="flex-grow-1 overflow-hidden">
                 <div class="fw-semibold small text-truncate">${escapeHtml(a.original_name)}</div>
                 <div class="att-meta">${formatSize(a.size)}</div>
               </div>
               <i class="fas fa-external-link-alt text-muted small"></i>
             </a>`).join('')}
         </div>`
      : '';

    modalBody.innerHTML = `
      <div class="row g-3">
        <div class="col-sm-6">
          <p class="detail-row-label">Nombre completo</p>
          <p class="detail-row-value">${escapeHtml(r.nombre)}</p>
        </div>
        <div class="col-sm-6">
          <p class="detail-row-label">Cédula</p>
          <p class="detail-row-value">${escapeHtml(r.cedula)}</p>
        </div>
        <div class="col-sm-6">
          <p class="detail-row-label">Correo</p>
          <p class="detail-row-value">${escapeHtml(r.correo)}</p>
        </div>
        <div class="col-sm-6">
          <p class="detail-row-label">Fecha de registro</p>
          <p class="detail-row-value">${formatDate(r.created_at)}</p>
        </div>
        ${r.link_vitrina ? `
        <div class="col-12">
          <p class="detail-row-label">Link de la vitrina</p>
          <a href="${escapeHtml(r.link_vitrina)}" target="_blank" rel="noopener noreferrer"
             class="detail-row-value d-block text-truncate">
            ${escapeHtml(r.link_vitrina)}
          </a>
        </div>` : ''}
        ${r.notas ? `
        <div class="col-12">
          <p class="detail-row-label">Notas adicionales</p>
          <p class="mb-0 p-2 bg-light rounded-2 small" style="white-space:pre-wrap;">${escapeHtml(r.notas)}</p>
        </div>` : ''}
        ${r.submitted_by ? `
        <div class="col-12">
          <p class="detail-row-label">Registrado por</p>
          <p class="detail-row-value">${escapeHtml(r.submitted_by)}</p>
        </div>` : ''}
      </div>
      ${attachHtml}`;
  } catch {
    modalBody.innerHTML = `<div class="alert alert-danger small">Error al cargar el detalle.</div>`;
  }
}

// ── Bootstrap modal debe existir antes de llamarlo ───────────────────────────
// (ya está disponible porque bootstrap.bundle está cargado en el HTML)

// ── Inicialización ────────────────────────────────────────────────────────────
(async () => {
  const user = await requireAuth();
  if (!user) return;

  document.getElementById('user-greeting').textContent = `Hola, ${user.username}`;

  if (user.role === 'admin') {
    document.getElementById('page-title').innerHTML =
      `<i class="fas fa-users text-primary me-2"></i>Panel de administración`;
    document.getElementById('page-subtitle').textContent =
      'Todos los cuestionarios registrados';
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/index.html');
  });

  try {
    const responses = await loadResponses(user.role === 'admin');
    renderResponses(responses, user.role === 'admin');
  } catch (err) {
    document.getElementById('responses-container').innerHTML =
      `<div class="alert alert-danger small">${escapeHtml(err.message)}</div>`;
  }
})();
