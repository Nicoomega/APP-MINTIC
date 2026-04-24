/* public/js/questionnaire.js – lógica del formulario de registro */
'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function showAlert(message, type = 'danger') {
  const box = document.getElementById('alert-box');
  box.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show small" role="alert">
      ${escapeHtml(message)}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function formatSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime) {
  if (mime.startsWith('image/'))               return '<i class="fas fa-image text-success"></i>';
  if (mime === 'application/pdf')              return '<i class="fas fa-file-pdf text-danger"></i>';
  if (mime.includes('word'))                   return '<i class="fas fa-file-word text-primary"></i>';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '<i class="fas fa-file-excel text-success"></i>';
  if (mime === 'text/plain' || mime === 'text/csv')            return '<i class="fas fa-file-alt text-secondary"></i>';
  if (mime.includes('zip'))                    return '<i class="fas fa-file-archive text-warning"></i>';
  return '<i class="fas fa-file text-muted"></i>';
}

// ── Estado de archivos seleccionados ─────────────────────────────────────────
let selectedFiles = [];

function renderFilePreview() {
  const container = document.getElementById('file-preview');
  if (!selectedFiles.length) { container.innerHTML = ''; return; }

  container.innerHTML = selectedFiles.map((file, i) => `
    <div class="file-item">
      <span class="file-icon">${fileIcon(file.type)}</span>
      <span class="file-name flex-grow-1">${escapeHtml(file.name)}</span>
      <span class="text-muted small me-2">${formatSize(file.size)}</span>
      <button class="remove-btn" data-index="${i}" aria-label="Eliminar ${escapeHtml(file.name)}">
        <i class="fas fa-times"></i>
      </button>
    </div>`).join('');

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedFiles.splice(parseInt(btn.dataset.index, 10), 1);
      renderFilePreview();
    });
  });
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (selectedFiles.length >= 5) break;
    const duplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
    if (!duplicate) selectedFiles.push(file);
  }
  renderFilePreview();
}

// ── Verificar autenticación ───────────────────────────────────────────────────
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

// ── Inicialización ────────────────────────────────────────────────────────────
(async () => {
  const user = await requireAuth();
  if (!user) return;

  // Saludo
  document.getElementById('user-greeting').textContent = `Hola, ${user.username}`;

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/index.html');
  });

  // Contador de caracteres en notas
  const notasEl    = document.getElementById('notas');
  const charCount  = document.getElementById('char-count');
  notasEl.addEventListener('input', () => {
    charCount.textContent = `${notasEl.value.length} / 1000`;
  });

  // ── Carga de archivos ────────────────────────────────────────────────────
  const fileInput   = document.getElementById('archivos');
  const uploadZone  = document.getElementById('upload-zone');
  const selectBtn   = document.getElementById('select-files-btn');

  selectBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  uploadZone.addEventListener('click', (e) => {
    if (!e.target.closest('button')) fileInput.click();
  });
  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  ['dragleave', 'dragend'].forEach(ev => uploadZone.addEventListener(ev, () => uploadZone.classList.remove('dragover')));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  // ── Envío del formulario ─────────────────────────────────────────────────
  const form      = document.getElementById('questionnaire-form');
  const spinner   = document.getElementById('spinner');
  const submitIcon = document.getElementById('submit-icon');
  const submitBtn  = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    spinner.classList.remove('d-none');
    submitIcon.classList.add('d-none');
    submitBtn.disabled = true;

    const fd = new FormData();
    fd.append('nombre',       document.getElementById('nombre').value.trim());
    fd.append('correo',       document.getElementById('correo').value.trim());
    fd.append('cedula',       document.getElementById('cedula').value.trim());
    fd.append('link_vitrina', document.getElementById('link_vitrina').value.trim());
    fd.append('notas',        notasEl.value.trim());
    selectedFiles.forEach(f => fd.append('archivos', f));

    try {
      const res  = await fetch('/api/questionnaire', {
        method: 'POST', body: fd, credentials: 'same-origin',
      });
      const data = await res.json();

      if (res.ok) {
        showAlert('Registro enviado exitosamente. Redirigiendo...', 'success');
        selectedFiles = [];
        renderFilePreview();
        form.reset();
        charCount.textContent = '0 / 1000';
        setTimeout(() => window.location.replace('/dashboard.html'), 1800);
      } else {
        showAlert(data.errors?.[0]?.msg ?? data.error ?? 'Error al enviar el registro.');
      }
    } catch {
      showAlert('Error de conexión. Intenta nuevamente.');
    } finally {
      spinner.classList.add('d-none');
      submitIcon.classList.remove('d-none');
      submitBtn.disabled = false;
    }
  });

  // Limpiar formulario
  form.addEventListener('reset', () => {
    selectedFiles = [];
    renderFilePreview();
    charCount.textContent = '0 / 1000';
    document.getElementById('alert-box').innerHTML = '';
  });
})();
