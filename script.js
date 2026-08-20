/* ============================================================
   ICI · Carga fotográfica de puntos geodésicos
   ============================================================
   IMPORTANTE: reemplaza APPS_SCRIPT_URL por la URL "/exec" que te
   entrega Google Apps Script al implementar el backend (Code.gs).
   Ver README.md para el paso a paso de despliegue.
   ============================================================ */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwgvMKttFzJuS4lrXvu-DlVgDVaLEp2Y1G2I4g_3b6DnvLSGb1r88p9rqKkeymKnWHh5g/exec';

// Se usa solo si el backend no responde (por ejemplo, mientras pruebas el
// diseño antes de desplegar Apps Script). En producción, la configuración
// real siempre viene del backend, así los códigos de punto quedan
// centralizados en un solo lugar (Code.gs).
const FALLBACK_CONFIG = {
  points: [
    { code: 'PG-001', label: '' },
    { code: 'PG-002', label: '' },
    { code: 'PG-003', label: '' },
  ],
  categories: [
    { id: '02', name: '02. PROCESO DE MONUMENTACIÓN', accepts: 'image' },
    { id: '03', name: '03. PROFUNDIDAD', accepts: 'image' },
    { id: '04', name: '04. ANCLAJE DE DISCO DE BRONCE', accepts: 'image' },
    { id: '05', name: '05. INCRUSTACIÓN DEL DISCO DE BRONCE', accepts: 'image' },
    { id: '06', name: '06. DISCO INSTALADO', accepts: 'image' },
    { id: '07', name: '07. MEDICIÓN DE ALTURA DE ANTENA', accepts: 'image' },
    { id: '08', name: '08. FOTOGRAFÍAS PANORÁMICAS', accepts: 'image' },
    { id: '09', name: '09. VIDEOS', accepts: 'video' },
  ],
};

let CONFIG = null;
let uploadedCount = 0;

const els = {
  pointsContainer: document.getElementById('pointsContainer'),
  addPointBtn: document.getElementById('addPointBtn'),
  connDot: document.getElementById('connStatusDot'),
  connText: document.getElementById('connStatusText'),
  logList: document.getElementById('logList'),
  logEmpty: document.getElementById('logEmpty'),
  logCount: document.getElementById('logCount'),
  pointBlockTpl: document.getElementById('pointBlockTemplate'),
  categoryCardTpl: document.getElementById('categoryCardTemplate'),
  fileRowTpl: document.getElementById('fileRowTemplate'),
};

document.getElementById('year').textContent = new Date().getFullYear();

init();

async function init() {
  CONFIG = await loadConfig();
  addPointBlock();
  els.addPointBtn.addEventListener('click', addPointBlock);
}

// ------------------------------------------------------------
// Configuración remota
// ------------------------------------------------------------
async function loadConfig() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PEGA_AQUI') !== -1) {
    setConnStatus('error', 'Backend no configurado — usando datos de ejemplo');
    return FALLBACK_CONFIG;
  }
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=config');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Respuesta inválida');
    setConnStatus('online', 'Conectado — ' + data.points.length + ' puntos habilitados');
    return { points: data.points, categories: data.categories };
  } catch (err) {
    console.error(err);
    setConnStatus('error', 'Sin conexión al backend — usando datos de ejemplo');
    return FALLBACK_CONFIG;
  }
}

function setConnStatus(state, text) {
  els.connDot.classList.remove('is-online', 'is-error');
  if (state === 'online') els.connDot.classList.add('is-online');
  if (state === 'error') els.connDot.classList.add('is-error');
  els.connText.textContent = text;
}

// ------------------------------------------------------------
// Bloques de punto
// ------------------------------------------------------------
let pointBlockSeq = 0;

function addPointBlock() {
  const id = 'pt' + (++pointBlockSeq);
  const node = els.pointBlockTpl.content.firstElementChild.cloneNode(true);
  node.dataset.blockId = id;

  const select = node.querySelector('[data-role="point-select"]');
  CONFIG.points.forEach(function (p) {
    const opt = document.createElement('option');
    opt.value = p.code;
    opt.textContent = p.label ? (p.code + ' — ' + p.label) : p.code;
    select.appendChild(opt);
  });

  const grid = node.querySelector('[data-role="categories-grid"]');
  CONFIG.categories.forEach(function (cat) {
    grid.appendChild(buildCategoryCard(cat, select));
  });

  node.querySelector('[data-role="remove-point"]').addEventListener('click', function () {
    node.remove();
  });

  els.pointsContainer.appendChild(node);
}

function buildCategoryCard(category, pointSelectEl) {
  const card = els.categoryCardTpl.content.firstElementChild.cloneNode(true);
  card.dataset.categoryId = category.id;
  card.querySelector('[data-role="category-id"]').textContent = category.id;
  card.querySelector('[data-role="category-name"]').textContent = category.name.replace(/^\d+\.\s*/, '');

  const toggle = card.querySelector('[data-role="category-toggle"]');
  const body = card.querySelector('[data-role="category-body"]');
  toggle.addEventListener('click', function () {
    const isOpen = card.classList.toggle('is-open');
    body.hidden = !isOpen;
  });

  const isVideo = category.accepts === 'video';
  const acceptAttr = isVideo ? 'video/*' : 'image/*';
  const captureLabel = card.querySelector('[data-role="capture-label"]');
  if (isVideo) captureLabel.textContent = '🎥 Grabar video';

  const inputCapture = card.querySelector('[data-role="input-capture"]');
  const inputBrowse = card.querySelector('[data-role="input-browse"]');
  inputCapture.setAttribute('accept', acceptAttr);
  inputBrowse.setAttribute('accept', acceptAttr);
  if (isVideo) inputCapture.setAttribute('capture', 'environment');

  const fileList = card.querySelector('[data-role="file-list"]');
  const countEl = card.querySelector('[data-role="category-count"]');
  countEl.textContent = '0';

  function onFilesChosen(fileInputEvent) {
    const files = Array.from(fileInputEvent.target.files || []);
    fileInputEvent.target.value = ''; // permite volver a elegir el mismo archivo
    if (!files.length) return;

    const pointCode = pointSelectEl.value;
    if (!pointCode) {
      alert('Primero selecciona el código de punto en la parte superior de esta tarjeta.');
      return;
    }

    files.forEach(function (file) {
      queueUpload(file, pointCode, category, fileList, countEl);
    });
  }

  inputCapture.addEventListener('change', onFilesChosen);
  inputBrowse.addEventListener('change', onFilesChosen);

  return card;
}

// ------------------------------------------------------------
// Carga de archivos
// ------------------------------------------------------------
function queueUpload(file, pointCode, category, fileListEl, countEl) {
  const row = els.fileRowTpl.content.firstElementChild.cloneNode(true);
  const icon = row.querySelector('[data-role="file-icon"]');
  const nameEl = row.querySelector('[data-role="file-name"]');
  const statusEl = row.querySelector('[data-role="file-status"]');

  nameEl.textContent = file.name + ' · ' + formatSize(file.size);
  statusEl.textContent = 'Subiendo…';
  row.classList.add('is-uploading');
  icon.textContent = '⏳';
  fileListEl.prepend(row);

  uploadFile(file, pointCode, category)
    .then(function (result) {
      row.classList.remove('is-uploading');
      row.classList.add('is-success');
      icon.textContent = '✅';
      statusEl.innerHTML = '<a href="' + result.fileUrl + '" target="_blank" rel="noopener">Ver en Drive</a>';
      bumpCategoryCount(countEl);
      logEntry({ ok: true, pointCode: pointCode, category: category, fileName: result.fileName, fileUrl: result.fileUrl });
    })
    .catch(function (err) {
      row.classList.remove('is-uploading');
      row.classList.add('is-error');
      icon.textContent = '⚠️';
      statusEl.textContent = 'Error — toca para reintentar';
      row.style.cursor = 'pointer';
      row.addEventListener('click', function retry() {
        row.removeEventListener('click', retry);
        row.classList.remove('is-error');
        row.classList.add('is-uploading');
        icon.textContent = '⏳';
        statusEl.textContent = 'Subiendo…';
        uploadFile(file, pointCode, category)
          .then(function (result) {
            row.classList.remove('is-uploading');
            row.classList.add('is-success');
            icon.textContent = '✅';
            statusEl.innerHTML = '<a href="' + result.fileUrl + '" target="_blank" rel="noopener">Ver en Drive</a>';
            bumpCategoryCount(countEl);
            logEntry({ ok: true, pointCode: pointCode, category: category, fileName: result.fileName, fileUrl: result.fileUrl });
          })
          .catch(function (e2) {
            row.classList.remove('is-uploading');
            row.classList.add('is-error');
            icon.textContent = '⚠️';
            statusEl.textContent = 'Error — toca para reintentar';
          });
      });
      logEntry({ ok: false, pointCode: pointCode, category: category, fileName: file.name, error: String(err && err.message ? err.message : err) });
      console.error(err);
    });
}

function uploadFile(file, pointCode, category) {
  return fileToBase64(file).then(function (base64Data) {
    const payload = {
      action: 'upload',
      pointCode: pointCode,
      categoryId: category.id,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64Data: base64Data,
    };

    // Content-Type text/plain evita el preflight CORS que Apps Script no
    // maneja; el backend igual lee el cuerpo como JSON.
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || 'El servidor rechazó el archivo.');
        return data;
      });
  });
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      // El resultado viene como "data:<mime>;base64,XXXX" — se conserva
      // exactamente el mismo binario original, sin recomprimir la imagen,
      // por lo que su metadata EXIF/GPS no se altera.
      const commaIdx = reader.result.indexOf(',');
      resolve(reader.result.slice(commaIdx + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function bumpCategoryCount(countEl) {
  const current = parseInt(countEl.textContent || '0', 10) || 0;
  countEl.textContent = String(current + 1);
  countEl.classList.add('has-files');
}

// ------------------------------------------------------------
// Bitácora / confirmación en tiempo real
// ------------------------------------------------------------
function logEntry(info) {
  els.logEmpty.hidden = true;

  const li = document.createElement('li');
  li.className = 'log-entry' + (info.ok ? '' : ' is-error');

  const time = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const catShort = info.category.id;

  if (info.ok) {
    li.innerHTML =
      '<span class="log-entry-time">' + time + '</span> · ' +
      '<span class="log-entry-point">' + escapeHtml(info.pointCode) + '</span> · ' +
      '<span class="log-entry-cat">carpeta ' + escapeHtml(catShort) + '</span> · guardado ✔' +
      '<span class="log-entry-name">' + escapeHtml(info.fileName) + '</span>' +
      '<a href="' + info.fileUrl + '" target="_blank" rel="noopener">Abrir archivo →</a>';
    uploadedCount++;
  } else {
    li.innerHTML =
      '<span class="log-entry-time">' + time + '</span> · ' +
      '<span class="log-entry-point">' + escapeHtml(info.pointCode) + '</span> · ' +
      '<span class="log-entry-cat">carpeta ' + escapeHtml(catShort) + '</span> · falló ✕' +
      '<span class="log-entry-name">' + escapeHtml(info.fileName) + ' — ' + escapeHtml(info.error || '') + '</span>';
  }

  els.logList.prepend(li);
  els.logCount.textContent = uploadedCount + (uploadedCount === 1 ? ' archivo' : ' archivos');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
