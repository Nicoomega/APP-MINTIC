/* public/js/operador.js */
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

// ── Auth ──────────────────────────────────────────────────────────────────────
async function requireOperador() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.replace('/index.html'); return null; }
    const { user } = await res.json();
    if (user.role !== 'operador') { window.location.replace('/index.html'); return null; }
    return user;
  } catch { window.location.replace('/index.html'); return null; }
}

// ── Cargar lista ──────────────────────────────────────────────────────────────
async function loadList() {
  const container = document.getElementById('lista-container');
  try {
    const res  = await fetch('/api/submissions', { credentials: 'same-origin' });
    const data = await res.json();
    renderList(data.submissions ?? []);
  } catch {
    container.innerHTML = '<div class="alert alert-danger">Error al cargar los envíos.</div>';
  }
}

function renderList(list) {
  const container = document.getElementById('lista-container');
  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
        <p>Aún no tienes envíos registrados.</p>
        <button class="btn btn-primary btn-sm" id="btn-primer-envio">Crear primer envío</button>
      </div>`;
    document.getElementById('btn-primer-envio')?.addEventListener('click', () => showForm('nuevo'));
    return;
  }

  container.innerHTML = list.map(s => {
    const st = STATUS_MAP[s.status] ?? STATUS_MAP.pendiente_revision;
    return `
      <div class="card" style="margin-bottom:0.875rem;">
        <div class="card-body" style="padding:1rem 1.25rem;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
            <div>
              <span class="badge ${st.cls}" style="margin-bottom:0.375rem;display:inline-block;">${st.label}</span>
              <div style="font-size:0.8rem;color:#64748b;">Enviado: ${formatDate(s.submitted_at)}</div>
              ${s.reviewed_at ? `<div style="font-size:0.8rem;color:#64748b;">Revisado: ${formatDate(s.reviewed_at)} por <strong>${escapeHtml(s.reviewer_name ?? '?')}</strong></div>` : ''}
              <div style="font-size:0.8rem;color:#64748b;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                <a href="${escapeHtml(s.url_vitrina)}" target="_blank" rel="noopener noreferrer" style="color:#059669;">${escapeHtml(s.url_vitrina)}</a>
              </div>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm btn-detalle" data-id="${s.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                Ver
              </button>
              ${s.status === 'rechazado' ? `
                <button class="btn btn-warning btn-sm btn-corregir" data-id="${s.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  Corregir
                </button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Mostrar / Ocultar secciones ───────────────────────────────────────────────
function showLista() {
  document.getElementById('section-lista').classList.remove('d-none');
  document.getElementById('section-form').classList.add('d-none');
  if (window.gsap) gsap.from('#section-lista', { opacity: 0, y: 16, duration: 0.3, ease: 'power2.out' });
}

function showForm(mode = 'nuevo', data = null, reviews = []) {
  document.getElementById('section-lista').classList.add('d-none');
  document.getElementById('section-form').classList.remove('d-none');
  if (window.gsap) gsap.from('#section-form', { opacity: 0, y: 16, duration: 0.3, ease: 'power2.out' });

  const titulo    = document.getElementById('form-titulo');
  const subtitulo = document.getElementById('form-subtitulo');
  const editId    = document.getElementById('edit-id');
  const alertEl   = document.getElementById('form-alert');
  const okEl      = document.getElementById('form-ok');
  const submitLbl = document.getElementById('submit-label');
  const notesDiv  = document.getElementById('review-notes');
  const notesBdy  = document.getElementById('review-notes-body');

  alertEl.classList.add('d-none');
  okEl.classList.add('d-none');
  document.getElementById('upload-form').reset();

  if (mode === 'corregir' && data) {
    titulo.textContent    = 'Corregir envío rechazado';
    subtitulo.textContent = 'Reemplaza los documentos con problemas y reenvía a revisión.';
    submitLbl.textContent = 'Reenviar';
    editId.value          = data.submission.id;
    document.getElementById('btn-submit').style.display = '';

    // Mostrar archivos actuales
    const FILE_LABELS = {
      cedula_pdf: 'Cédula del beneficiario',
      informe_pdf: 'Informe general',
      certificado_pdf: 'Certificado',
      planilla_conecta_pdf: 'Planilla Conecta',
      planilla_comunicacion_pdf: 'Planilla Comunicación',
      calificacion_modulos_pdf: 'Calificación módulos virtuales',
      evidencia_chatbot: 'Evidencia chatbot',
    };
    for (const [field, label] of Object.entries(FILE_LABELS)) {
      const fileInfo = data.files.find(f => f.field_name === field);
      const currentDiv = document.getElementById(`current-${field}`);
      const inputEl    = document.getElementById(field);
      if (fileInfo && currentDiv) {
        currentDiv.classList.remove('d-none');
        currentDiv.innerHTML = `
          <div class="doc-item" style="margin-bottom:0.5rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
            <span style="flex:1;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(fileInfo.original_name)}</span>
            <a href="/api/submissions/${data.submission.id}/files/${field}"
               target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem;">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            </a>
          </div>
          <p style="font-size:0.78rem;color:#d97706;margin:0 0 0.5rem;">Selecciona un archivo nuevo para reemplazarlo (opcional).</p>`;
        if (inputEl) inputEl.removeAttribute('required');
      }
    }

    // Pre-llenar URLs
    document.getElementById('url_vitrina').value = data.submission.url_vitrina ?? '';
    document.getElementById('url_chatbot').value = data.submission.url_chatbot ?? '';

    // ── Bloquear campos que NO fueron rechazados ────────────────────────────
    // Mapeo: criterio/documento de revisión → campos del formulario que controla
    const REVIEW_TO_FIELDS = {
      // Revisión por documento (cada doc → su propio input)
      cedula_pdf:                   ['cedula_pdf'],
      informe_pdf:                  ['informe_pdf'],
      certificado_pdf:              ['certificado_pdf'],
      planilla_conecta_pdf:         ['planilla_conecta_pdf'],
      planilla_comunicacion_pdf:    ['planilla_comunicacion_pdf'],
      calificacion_modulos_pdf:     ['calificacion_modulos_pdf'],
      evidencia_chatbot:            ['evidencia_chatbot'],
      // Criterios de evaluación
      gestion_asistencia:           ['cedula_pdf', 'informe_pdf', 'certificado_pdf', 'planilla_conecta_pdf', 'planilla_comunicacion_pdf', 'calificacion_modulos_pdf'],
      firma_gestor:                 ['cedula_pdf', 'informe_pdf', 'certificado_pdf'],
      precio_ubicacion_descripcion: ['url_vitrina'],
      catalogo:                     ['url_vitrina'],
      resenas_calificaciones:       ['url_vitrina'],
      vinculo_chatbot:              ['url_chatbot', 'evidencia_chatbot'],
      precios_referencia:           ['url_vitrina'],
      preguntas_producto:           ['url_vitrina'],
    };
    const rejectedFields = reviews.filter(r => r.status === 'no_cumple').map(r => r.field_name);
    const editableFields  = new Set(rejectedFields.flatMap(n => REVIEW_TO_FIELDS[n] ?? []));
    const allFormFields   = ['cedula_pdf', 'informe_pdf', 'certificado_pdf', 'planilla_conecta_pdf',
                             'planilla_comunicacion_pdf', 'calificacion_modulos_pdf', 'evidencia_chatbot',
                             'url_vitrina', 'url_chatbot'];

    // Limpiar badges anteriores
    document.querySelectorAll('.field-status-badge').forEach(b => b.remove());
    document.querySelectorAll('.field-locked').forEach(el => el.classList.remove('field-locked'));

    for (const field of allFormFields) {
      const inputEl = document.getElementById(field);
      const wrapEl  = document.getElementById(`wrap-${field}`);
      if (!inputEl || !wrapEl) continue;
      const label = wrapEl.querySelector('label');
      const badge = document.createElement('span');
      badge.className = 'field-status-badge';
      if (editableFields.has(field)) {
        inputEl.removeAttribute('disabled');
        inputEl.removeAttribute('readonly');
        badge.classList.add('needs-fix');
        badge.textContent = 'Requiere corrección';
      } else {
        if (inputEl.type === 'file') {
          inputEl.setAttribute('disabled', '');
        } else {
          inputEl.setAttribute('readonly', '');
        }
        wrapEl.classList.add('field-locked');
        badge.classList.add('locked');
        badge.textContent = 'Sin cambios requeridos';
      }
      label?.after(badge);
    }

    // Mostrar observaciones del revisor
    const rejected = reviews.filter(r => r.status === 'no_cumple');
    if (rejected.length) {
      notesDiv.classList.remove('d-none');
      notesBdy.innerHTML = rejected.map(r => {
        const LABELS = {
          cedula_pdf: 'Cédula del beneficiario',
          informe_pdf: 'Informe general',
          certificado_pdf: 'Certificado',
          planilla_conecta_pdf: 'Planilla Conecta Región Caribe',
          planilla_comunicacion_pdf: 'Planilla Comunicación Efectiva',
          calificacion_modulos_pdf: 'Calificación módulos virtuales',
          evidencia_chatbot: 'Evidencia del chatbot',
          gestion_asistencia: 'Gestión de la asistencia y acompañamiento',
          firma_gestor: 'Firma del gestor',
          precio_ubicacion_descripcion: 'Precio, ubicación y descripción del producto',
          catalogo: 'Catálogo',
          resenas_calificaciones: 'Reseñas y calificaciones',
          vinculo_chatbot: 'Vínculo del chatbot',
          precios_referencia: 'Precios de referencia - Productos relacionados',
          preguntas_producto: 'Preguntas acerca de este producto',
        };
        return `<div style="margin-bottom:0.5rem;">
          <span style="font-weight:600;">• ${escapeHtml(LABELS[r.field_name] ?? r.field_name)}:</span>
          <span style="color:#dc2626;margin-left:0.25rem;">${escapeHtml(r.comment)}</span>
        </div>`;
      }).join('');
    } else {
      notesDiv.classList.add('d-none');
    }

  } else if (mode === 'ver' && data) {
    titulo.textContent    = 'Detalle del envío';
    subtitulo.textContent = 'Vista de solo lectura. No puedes editar este envío.';
    submitLbl.textContent = 'Enviar';
    editId.value          = '';
    notesDiv.classList.add('d-none');

    const FILE_LABELS = {
      cedula_pdf: 'Cédula del beneficiario',
      informe_pdf: 'Informe general',
      certificado_pdf: 'Certificado',
      planilla_conecta_pdf: 'Planilla Conecta',
      planilla_comunicacion_pdf: 'Planilla Comunicación',
      calificacion_modulos_pdf: 'Calificación módulos virtuales',
      evidencia_chatbot: 'Evidencia chatbot',
    };
    for (const [field, label] of Object.entries(FILE_LABELS)) {
      const fileInfo   = data.files.find(f => f.field_name === field);
      const currentDiv = document.getElementById(`current-${field}`);
      const inputEl    = document.getElementById(field);
      const wrapEl     = document.getElementById(`wrap-${field}`);
      if (currentDiv) {
        if (fileInfo) {
          currentDiv.classList.remove('d-none');
          currentDiv.innerHTML = `
            <div class="doc-item" style="margin-bottom:0.5rem;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
              <span style="flex:1;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(fileInfo.original_name)}</span>
              <a href="/api/submissions/${data.submission.id}/files/${field}"
                 target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem;">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              </a>
            </div>`;
        } else {
          currentDiv.classList.add('d-none');
        }
      }
      // Ocultar solo el input y el hint; mostrar el wrap si hay archivo
      if (wrapEl) wrapEl.style.display = fileInfo ? '' : 'none';
      if (inputEl) inputEl.style.display = 'none';
      const hintEl = wrapEl?.querySelector('.form-hint');
      if (hintEl) hintEl.style.display = 'none';
      const reqEl = wrapEl?.querySelector('.req');
      if (reqEl) reqEl.style.display = 'none';
    }

    // Pre-llenar URLs (solo lectura)
    document.getElementById('url_vitrina').value = data.submission.url_vitrina ?? '';
    document.getElementById('url_chatbot').value = data.submission.url_chatbot ?? '';
    document.getElementById('url_vitrina').setAttribute('readonly', '');
    document.getElementById('url_chatbot').setAttribute('readonly', '');

    // Ocultar botón de envío
    document.getElementById('btn-submit').style.display = 'none';

  } else {
    titulo.textContent    = 'Nuevo envío';
    subtitulo.textContent = 'Completa todos los campos. Los documentos PDF serán validados automáticamente.';
    submitLbl.textContent = 'Enviar';
    editId.value          = '';
    notesDiv.classList.add('d-none');

    // Ocultar divs de archivos actuales y restaurar required
    ['cedula_pdf','informe_pdf','certificado_pdf','planilla_conecta_pdf','planilla_comunicacion_pdf','calificacion_modulos_pdf','evidencia_chatbot']
      .forEach(field => {
        const currentDiv = document.getElementById(`current-${field}`);
        const inputEl    = document.getElementById(field);
        const wrapEl     = document.getElementById(`wrap-${field}`);
        if (currentDiv) currentDiv.classList.add('d-none');
        if (inputEl)    inputEl.removeAttribute('disabled');
        if (inputEl)    inputEl.setAttribute('required', '');
        if (inputEl)    inputEl.style.display = '';
        if (wrapEl)     wrapEl.style.display = '';
        const hintEl = wrapEl?.querySelector('.form-hint');
        if (hintEl) hintEl.style.display = '';
        const reqEl = wrapEl?.querySelector('.req');
        if (reqEl) reqEl.style.display = '';
      });

    // Restaurar botón submit y URLs editables
    document.getElementById('btn-submit').style.display = '';
    document.getElementById('url_vitrina').removeAttribute('readonly');
    document.getElementById('url_chatbot').removeAttribute('readonly');

    // Limpiar estado del modo corregir/ver
    document.querySelectorAll('.field-status-badge').forEach(b => b.remove());
    document.querySelectorAll('.field-locked').forEach(el => el.classList.remove('field-locked'));
  }
}

// ── Envío del formulario ──────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const alertEl   = document.getElementById('form-alert');
  const okEl      = document.getElementById('form-ok');
  const spinner   = document.getElementById('form-spinner');
  const submitBtn = document.getElementById('btn-submit');
  const icon      = document.getElementById('submit-icon');
  const editId    = document.getElementById('edit-id').value;

  alertEl.classList.add('d-none');
  okEl.classList.add('d-none');
  spinner.classList.remove('d-none');
  icon.classList.add('d-none');
  submitBtn.disabled = true;

  const formData = new FormData(document.getElementById('upload-form'));

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/submissions/${editId}`, {
        method:      'PUT',
        credentials: 'same-origin',
        body:        formData,
      });
    } else {
      res = await fetch('/api/submissions', {
        method:      'POST',
        credentials: 'same-origin',
        body:        formData,
      });
    }
    const data = await res.json();

    if (res.ok) {
      okEl.textContent = data.message;
      okEl.classList.remove('d-none');
      setTimeout(async () => {
        showLista();
        await loadList();
      }, 1500);
    } else {
      alertEl.textContent = data.error ?? 'Error al enviar.';
      alertEl.classList.remove('d-none');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch {
    alertEl.textContent = 'Error de conexión. Intenta nuevamente.';
    alertEl.classList.remove('d-none');
  } finally {
    spinner.classList.add('d-none');
    icon.classList.remove('d-none');
    submitBtn.disabled = false;
  }
}

// ── Inicialización ────────────────────────────────────────────────────────────
(async () => {
  const user = await requireOperador();
  if (!user) return;

  document.getElementById('user-greeting').textContent = `Hola, ${user.username}`;

  if (window.gsap) {
    gsap.from('.page-content > *', { opacity: 0, y: 20, stagger: 0.06, duration: 0.4, ease: 'power2.out' });
  }

  await loadList();

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/index.html');
  });

  // Nuevo envío
  document.getElementById('btn-nuevo').addEventListener('click', () => showForm('nuevo'));

  // Volver a lista
  document.getElementById('btn-volver').addEventListener('click',  () => { showLista(); loadList(); });
  document.getElementById('btn-volver2').addEventListener('click', () => { showLista(); loadList(); });

  // Submit
  document.getElementById('upload-form').addEventListener('submit', handleSubmit);

  // Delegación: Ver / Corregir
  document.getElementById('lista-container').addEventListener('click', async (e) => {
    const detBtn = e.target.closest('.btn-detalle');
    const corBtn = e.target.closest('.btn-corregir');

    if (detBtn) {
      const id = detBtn.dataset.id;
      try {
        const [subRes, revRes] = await Promise.all([
          fetch(`/api/submissions/${id}`,  { credentials: 'same-origin' }),
          fetch(`/api/reviews/${id}`,      { credentials: 'same-origin' }),
        ]);
        const subData = await subRes.json();
        const revData = await revRes.json();
        showForm('ver', subData, revData.reviews ?? []);
      } catch {
        alert('Error al cargar los datos del envío.');
      }
    }

    if (corBtn) {
      const id = corBtn.dataset.id;
      try {
        const [subRes, revRes] = await Promise.all([
          fetch(`/api/submissions/${id}`,  { credentials: 'same-origin' }),
          fetch(`/api/reviews/${id}`,      { credentials: 'same-origin' }),
        ]);
        const subData = await subRes.json();
        const revData = await revRes.json();
        showForm('corregir', subData, revData.reviews ?? []);
      } catch {
        alert('Error al cargar los datos del envío.');
      }
    }
  });
})();
