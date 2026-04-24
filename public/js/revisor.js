/* public/js/revisor.js */
'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = String(text ?? '');
  return d.innerHTML;
}
function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('es-CO', {
    year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
  });
}

const STATUS_MAP = {
  pendiente_revision: { label: 'Pendiente de revisión', cls: 'badge-warning' },
  aprobado:           { label: 'Aprobado',              cls: 'badge-success' },
  rechazado:          { label: 'Rechazado',             cls: 'badge-danger'  },
};

const FILE_LABELS = {
  cedula_pdf:                'Cédula del beneficiario',
  informe_pdf:               'Informe de asistencia',
  certificado_pdf:           'Certificado',
  planilla_conecta_pdf:      'Planilla Conecta Región Caribe',
  planilla_comunicacion_pdf: 'Planilla Comunicación Efectiva',
  evidencia_chatbot:         'Evidencia del chatbot',
};

// Definición de campos de revisión (se carga también desde /api/reviews/fields)
let REVIEW_FIELDS = [
  { name: 'gestion_asistencia',          label: 'Gestión de la asistencia y acompañamiento',     group: 'Asistencia' },
  { name: 'firma_gestor',                label: 'Firma del gestor',                               group: 'Asistencia' },
  { name: 'precio_ubicacion_descripcion',label: 'Precio, ubicación y descripción del producto',   group: 'Vitrina virtual' },
  { name: 'catalogo',                    label: 'Catálogo',                                       group: 'Vitrina virtual' },
  { name: 'resenas_calificaciones',      label: 'Reseñas y calificaciones',                       group: 'Vitrina virtual' },
  { name: 'vinculo_chatbot',             label: 'Vínculo del chatbot',                            group: 'Vitrina virtual' },
  { name: 'precios_referencia',          label: 'Precios de referencia - Productos relacionados', group: 'Vitrina virtual' },
  { name: 'preguntas_producto',          label: 'Preguntas acerca de este producto',              group: 'Vitrina virtual' },
];

// ── Auth ──────────────────────────────────────────────────────────────────────
async function requireRevisor() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.replace('/index.html'); return null; }
    const { user } = await res.json();
    if (user.role !== 'revisor') { window.location.replace('/index.html'); return null; }
    return user;
  } catch { window.location.replace('/index.html'); return null; }
}

// ── Cargar lista ──────────────────────────────────────────────────────────────
async function loadList() {
  const container = document.getElementById('lista-container');
  const filtro    = document.getElementById('filtro-status').value;

  container.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="spinner" style="border-top-color:#059669;margin:0 auto;"></div></div>`;
  try {
    const res  = await fetch('/api/submissions', { credentials: 'same-origin' });
    const data = await res.json();
    let list   = data.submissions ?? [];
    if (filtro) list = list.filter(s => s.status === filtro);
    renderList(list);
  } catch {
    container.innerHTML = '<div class="alert alert-danger">Error al cargar los envíos.</div>';
  }
}

function renderList(list) {
  const container = document.getElementById('lista-container');
  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
        <p>No hay envíos en este estado.</p>
      </div>`;
    return;
  }

  container.innerHTML = list.map(s => {
    const st = STATUS_MAP[s.status] ?? STATUS_MAP.pendiente_revision;
    const canReview = s.status === 'pendiente_revision';
    return `
      <div class="card" style="margin-bottom:0.875rem;">
        <div class="card-body" style="padding:1rem 1.25rem;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.375rem;">
                <span class="badge ${st.cls}">${st.label}</span>
                <span style="font-size:0.78rem;color:#94a3b8;">Envío #${s.id}</span>
              </div>
              <div style="font-size:0.83rem;font-weight:600;color:#0f172a;">${escapeHtml(s.operator_name ?? '?')}</div>
              <div style="font-size:0.8rem;color:#64748b;">
                Enviado: ${formatDate(s.submitted_at)}
                ${s.reviewed_at ? ` · Revisado: ${formatDate(s.reviewed_at)} por <strong>${escapeHtml(s.reviewer_name ?? '?')}</strong>` : ''}
              </div>
            </div>
            <div>
              ${canReview
                ? `<button class="btn btn-primary btn-sm btn-revisar" data-id="${s.id}">
                     <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                     Revisar
                   </button>`
                : `<button class="btn btn-ghost btn-sm btn-revisar" data-id="${s.id}">
                     <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                     Ver revisión
                   </button>`}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Construir formulario de revisión ─────────────────────────────────────────
function buildReviewForm(existingReviews) {
  const reviewMap = {};
  for (const r of (existingReviews ?? [])) reviewMap[r.field_name] = r;

  let html = '';
  let lastGroup = '';

  for (const field of REVIEW_FIELDS) {
    if (field.group !== lastGroup) {
      if (lastGroup) html += '</div>';
      html += `
        <div class="review-group-header">${escapeHtml(field.group)}</div>
        <div>`;
      lastGroup = field.group;
    }

    const existing   = reviewMap[field.name];
    const isCumple   = existing?.status === 'cumple';
    const isNoCumple = existing?.status === 'no_cumple';
    const comment    = existing?.comment ?? '';

    html += `
      <div class="review-field-item" id="field-wrap-${field.name}">
        <div style="font-size:0.85rem;font-weight:600;color:#0f172a;margin-bottom:0.625rem;">${escapeHtml(field.label)}</div>
        <div class="review-radio-group">
          <label class="radio-option ${isCumple ? 'checked-cumple' : ''}">
            <input type="radio" name="rf_${field.name}" value="cumple"
                   class="review-radio" data-field="${field.name}" ${isCumple ? 'checked' : ''} required />
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            Cumple
          </label>
          <label class="radio-option ${isNoCumple ? 'checked-nocumple' : ''}">
            <input type="radio" name="rf_${field.name}" value="no_cumple"
                   class="review-radio" data-field="${field.name}" ${isNoCumple ? 'checked' : ''} />
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            No cumple
          </label>
        </div>
        <div class="comment-wrap ${isNoCumple ? '' : 'd-none'}" id="comment-wrap-${field.name}">
          <textarea class="form-control" rows="2"
                    id="comment_${field.name}" name="comment_${field.name}"
                    placeholder="Describe qué falta o qué error se encontró…"
                    maxlength="500">${escapeHtml(comment)}</textarea>
          <p style="font-size:0.78rem;color:#dc2626;margin:0.25rem 0 0;">Campo obligatorio cuando se marca "No cumple".</p>
        </div>
      </div>`;
  }
  if (lastGroup) html += '</div>';
  return html;
}

// ── Mostrar panel de revisión ────────────────────────────────────────────────
async function showRevision(id) {
  document.getElementById('section-lista').classList.add('d-none');
  document.getElementById('section-revision').classList.remove('d-none');
  if (window.gsap) gsap.from('#section-revision', { opacity: 0, y: 16, duration: 0.3, ease: 'power2.out' });
  document.getElementById('reviewing-id').value = id;
  document.getElementById('revision-id').textContent = `#${id}`;
  document.getElementById('review-alert').classList.add('d-none');
  document.getElementById('review-ok').classList.add('d-none');
  document.getElementById('docs-list').innerHTML   = '<div style="text-align:center;padding:1rem;"><div class="spinner" style="border-top-color:#059669;margin:0 auto;"></div></div>';
  document.getElementById('review-fields-container').innerHTML = '';

  // Resetear botón de envío al estado inicial
  const submitBtn = document.getElementById('btn-review-submit');
  submitBtn.disabled = false;
  document.getElementById('review-spinner').classList.add('d-none');
  document.getElementById('review-icon').classList.remove('d-none');
  document.getElementById('review-btn-label').textContent = 'Enviar revisión';

  try {
    const [subRes, revRes] = await Promise.all([
      fetch(`/api/submissions/${id}`,  { credentials: 'same-origin' }),
      fetch(`/api/reviews/${id}`,      { credentials: 'same-origin' }),
    ]);
    const subData = await subRes.json();
    const revData = await revRes.json();

    const sub     = subData.submission;
    const files   = subData.files    ?? [];
    const reviews = revData.reviews  ?? [];

    document.getElementById('revision-operador').textContent = sub.operator_name ?? '?';

    // Documentos
    const docsList = document.getElementById('docs-list');
    if (!files.length) {
      docsList.innerHTML = '<p style="font-size:0.82rem;color:#94a3b8;">Sin archivos.</p>';
    } else {
      docsList.innerHTML = files.map(f => `
        <div class="doc-item" style="margin-bottom:0.5rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="${f.mimetype.startsWith('image/') ? '#0ea5e9' : '#dc2626'}" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(FILE_LABELS[f.field_name] ?? f.field_name)}</div>
            <div style="font-size:0.75rem;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.original_name)}</div>
          </div>
          <a href="/api/submissions/${id}/files/${f.field_name}"
             target="_blank" rel="noopener noreferrer"
             class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem;flex-shrink:0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          </a>
        </div>`).join('');
    }

    // URLs
    const vitrinaEl = document.getElementById('url-vitrina');
    const chatbotEl = document.getElementById('url-chatbot');
    vitrinaEl.textContent = sub.url_vitrina ?? '—';
    vitrinaEl.href        = sub.url_vitrina ?? '#';
    chatbotEl.textContent = sub.url_chatbot ?? '—';
    chatbotEl.href        = sub.url_chatbot ?? '#';

    // Formulario de revisión
    document.getElementById('review-fields-container').innerHTML = buildReviewForm(reviews);

    // Si ya está revisado (no pendiente), deshabilitar el formulario
    if (sub.status !== 'pendiente_revision') {
      document.querySelectorAll('#review-form input, #review-form textarea').forEach(el => el.disabled = true);
      submitBtn.disabled = true;
      document.getElementById('review-btn-label').textContent = 'Revisión ya enviada';
    }

    // Eventos: toggle comentarios al marcar "no cumple"
    document.querySelectorAll('.review-radio').forEach(radio => {
      radio.addEventListener('change', () => {
        const field       = radio.dataset.field;
        const commentWrap = document.getElementById(`comment-wrap-${field}`);
        const wrap        = document.getElementById(`field-wrap-${field}`);
        // Actualizar estilos de radio-option
        wrap?.querySelectorAll('.radio-option').forEach(lbl => {
          lbl.classList.remove('checked-cumple', 'checked-nocumple');
        });
        if (radio.value === 'no_cumple' && radio.checked) {
          radio.closest('.radio-option')?.classList.add('checked-nocumple');
          commentWrap?.classList.remove('d-none');
        } else if (radio.value === 'cumple' && radio.checked) {
          radio.closest('.radio-option')?.classList.add('checked-cumple');
          commentWrap?.classList.add('d-none');
          const ta = document.getElementById(`comment_${field}`);
          if (ta) ta.value = '';
        }
      });
    });

  } catch (err) {
    console.error(err);
    document.getElementById('docs-list').innerHTML = '<div class="alert alert-danger" style="margin:0;">Error al cargar el envío.</div>';
  }
}

function showLista() {
  document.getElementById('section-revision').classList.add('d-none');
  document.getElementById('section-lista').classList.remove('d-none');
  if (window.gsap) gsap.from('#section-lista', { opacity: 0, y: 16, duration: 0.3, ease: 'power2.out' });
}

// ── Enviar revisión ──────────────────────────────────────────────────────────
async function handleReviewSubmit(e) {
  e.preventDefault();
  const alertEl = document.getElementById('review-alert');
  const okEl    = document.getElementById('review-ok');
  const spinner = document.getElementById('review-spinner');
  const icon    = document.getElementById('review-icon');
  const btn     = document.getElementById('btn-review-submit');
  const subId   = document.getElementById('reviewing-id').value;

  alertEl.classList.add('d-none');
  okEl.classList.add('d-none');

  try {
    // Recopilar y validar campos ANTES de mostrar spinner
    const fields = [];
    let hasError = false;

    for (const rf of REVIEW_FIELDS) {
      const selected = document.querySelector(`input[name="rf_${rf.name}"]:checked`);
      if (!selected) {
        hasError = true;
        document.getElementById(`field-wrap-${rf.name}`)?.classList.add('border-danger');
        continue;
      }
      document.getElementById(`field-wrap-${rf.name}`)?.classList.remove('border-danger');
      const comment = document.getElementById(`comment_${rf.name}`)?.value?.trim() ?? '';
      if (selected.value === 'no_cumple' && !comment) {
        hasError = true;
        document.getElementById(`field-wrap-${rf.name}`)?.classList.add('border-danger');
        continue;
      }
      fields.push({ name: rf.name, status: selected.value, comment });
    }

    if (hasError) {
      alertEl.textContent = 'Por favor completa todos los campos. Los marcados en rojo requieren un comentario.';
      alertEl.classList.remove('d-none');
      window.scrollTo({ top: document.getElementById('section-revision').offsetTop, behavior: 'smooth' });
      return;
    }

    // Activar spinner solo cuando la validación pasa
    spinner.classList.remove('d-none');
    icon.classList.add('d-none');
    btn.disabled = true;

    const res  = await fetch(`/api/reviews/${subId}`, {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ fields }),
    });
    const data = await res.json();

    if (res.ok) {
      okEl.textContent = data.message;
      okEl.classList.remove('d-none');
      setTimeout(async () => {
        showLista();
        await loadList();
      }, 1800);
    } else {
      alertEl.textContent = data.error ?? 'Error al enviar la revisión.';
      alertEl.classList.remove('d-none');
    }
  } catch {
    alertEl.textContent = 'Error de conexión. Intenta nuevamente.';
    alertEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
    btn.disabled = false;
  }
}

// ── Inicialización ────────────────────────────────────────────────────────────
(async () => {
  const user = await requireRevisor();
  if (!user) return;

  document.getElementById('user-greeting').textContent = `Hola, ${user.username}`;

  if (window.gsap) {
    gsap.from('.page-content > *', { opacity: 0, y: 20, stagger: 0.06, duration: 0.4, ease: 'power2.out' });
  }

  // Cargar campos desde API (para sincronizar con el backend)
  try {
    const r = await fetch('/api/reviews/fields', { credentials: 'same-origin' });
    if (r.ok) {
      const d = await r.json();
      if (d.fields?.length) REVIEW_FIELDS = d.fields;
    }
  } catch { /* usa los definidos localmente */ }

  await loadList();

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/index.html');
  });

  // Filtro
  document.getElementById('filtro-status').addEventListener('change', loadList);
  document.getElementById('btn-refrescar').addEventListener('click', loadList);

  // Volver
  document.getElementById('btn-volver').addEventListener('click',  () => { showLista(); loadList(); });
  document.getElementById('btn-volver2').addEventListener('click', () => { showLista(); loadList(); });

  // Revisar
  document.getElementById('lista-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-revisar');
    if (btn) await showRevision(btn.dataset.id);
  });

  // Submit revisión
  document.getElementById('review-form').addEventListener('submit', handleReviewSubmit);
})();
