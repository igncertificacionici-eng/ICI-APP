/* ============================================================
   ICI · Carga fotográfica de puntos geodésicos
   ============================================================
   IMPORTANTE: reemplaza APPS_SCRIPT_URL por la URL "/exec" que te
   entrega Google Apps Script al implementar el backend (Code.gs).
   Ver README.md para el paso a paso de despliegue.
   ============================================================ */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzrVf4TbX0KTFtv8s_eAWcKVIEmATdL4tDSsOAt2G6BmGI7qGxjMJGih4uK30-U_zE-7Q/exec';

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

  // Se dispara la geolocalización apenas se TOCA "Tomar foto" (antes de que
  // se abra la cámara), para que la coordenada quede lo más cerca posible
  // del instante real de la toma. Se guarda como descripción del archivo en
  // Drive — nunca dentro del JPEG — así la foto original no se toca.
  let pendingLocation = null;
  const captureWrapper = card.querySelector('.btn-capture');
  captureWrapper.addEventListener('click', function () {
    pendingLocation = getLocationSnapshot();
  });

  async function onFilesChosen(fileInputEvent, isCaptureFlow) {
    const files = Array.from(fileInputEvent.target.files || []);
    fileInputEvent.target.value = ''; // permite volver a elegir el mismo archivo
    if (!files.length) return;

    const pointCode = pointSelectEl.value;
    if (!pointCode) {
      alert('Primero selecciona el código de punto en la parte superior de esta tarjeta.');
      return;
    }

    // Se toma la ubicación que empezó a pedirse al tocar "Tomar foto" (o no
    // se pide ninguna si el archivo viene de la galería).
    const locationPromise = isCaptureFlow ? pendingLocation : Promise.resolve(null);
    pendingLocation = null;

    for (const file of files) {
      // El Art. 24 de los Lineamientos IGN exige "sí o sí" que la foto
      // conserve su metadata de cámara (fabricante, modelo) y prohíbe fotos
      // que vengan de WhatsApp u otras apps de edición/mensajería. Si falta,
      // se bloquea la carga aquí mismo — no hay opción de subirla igual.
      // De paso, se aprovecha la fecha de captura del EXIF (si la trae)
      // para nombrar el archivo como IMG_añomesdia_horaminutosegundo.
      let captureDateTime = null;
      if (!isVideo && file.type && file.type.indexOf('image') === 0) {
        const check = await requireCameraExif(file);
        if (!check.ok) continue;
        captureDateTime = check.captureDateTime;
      }
      queueUpload(file, pointCode, category, fileList, countEl, locationPromise, captureDateTime, isVideo);
    }
  }

  inputCapture.addEventListener('change', function (e) { onFilesChosen(e, true); });
  inputBrowse.addEventListener('change', function (e) { onFilesChosen(e, false); });

  return card;
}

// ------------------------------------------------------------
// Ubicación al instante de la toma (no se escribe en la foto, ver arriba)
// ------------------------------------------------------------
function getLocationSnapshot() {
  return new Promise(function (resolve) {
    if (!('geolocation' in navigator)) { resolve(null); return; }

    const timer = setTimeout(function () { resolve(null); }, 8000);

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date(pos.timestamp).toISOString(),
        });
      },
      function () {
        clearTimeout(timer);
        resolve(null); // permiso denegado u otro error: no bloquea la carga
      },
      { enableHighAccuracy: true, timeout: 7500, maximumAge: 0 }
    );
  });
}

// ------------------------------------------------------------
// Verificación de metadata EXIF (Artículo 24 de los Lineamientos IGN)
// ------------------------------------------------------------
// El IGN exige "sí o sí" que la foto conserva sus datos de cámara (marca,
// modelo, fecha) y rechaza fotos que hayan pasado por WhatsApp, Instagram,
// Telegram u otro editor — precisamente porque esas apps eliminan ese
// bloque de datos. Por eso esto NO es una advertencia salteable: si falta,
// se bloquea la carga sin opción de continuar igual. Esta función solo LEE
// el EXIF ya presente en el archivo; nunca modifica la foto ni le agrega
// datos que no traiga.
async function requireCameraExif(file) {
  // Art. 24.1: debe ser JPEG/JPG. Si el celular la generó en otro formato
  // (por ejemplo HEIC), no cumple, así que se bloquea también aquí.
  const nameLooksJpeg = /\.(jpe?g)$/i.test(file.name || '');
  const typeLooksJpeg = !file.type || file.type === 'image/jpeg' || file.type === 'image/jpg';
  if (!nameLooksJpeg && !typeLooksJpeg) {
    alert(
      'La foto "' + file.name + '" no está en formato JPEG/JPG.\n\n' +
      'El Artículo 24 de los Lineamientos IGN exige que las fotos sean ' +
      'JPEG/JPG originales de la cámara. Revisa el formato de cámara del ' +
      'celular (algunos guardan en HEIC por defecto) y vuelve a tomarla.'
    );
    return { ok: false, captureDateTime: null };
  }

  let exif = null;
  try {
    const buffer = await file.arrayBuffer();
    exif = readBasicExif(buffer);
  } catch (err) {
    console.error('No se pudo leer el EXIF de ' + file.name, err);
    // Fallo de nuestro propio lector (archivo raro, corrupto, etc.), no
    // necesariamente responsabilidad de la foto: se avisa pero no se
    // bloquea, para no rechazar fotos válidas por una limitación nuestra.
    alert(
      'No se pudo verificar automáticamente la metadata de "' + file.name + '". ' +
      'Se subirá, pero revisa manualmente sus propiedades antes de enviar el ' +
      'expediente al IGN (Artículo 24).'
    );
    return { ok: true, captureDateTime: null };
  }

  const tieneCamara = exif && exif.make && exif.model;
  if (tieneCamara) return { ok: true, captureDateTime: exif.dateTimeOriginal || null };

  alert(
    'La foto "' + file.name + '" NO tiene datos de cámara en su metadata ' +
    '(marca/modelo). El Artículo 24 de los Lineamientos IGN exige esa ' +
    'información sí o sí, y no acepta fotos reenviadas por WhatsApp u otra ' +
    'app — no se puede subir así.\n\n' +
    'Vuelve a tomarla con el botón "Tomar foto" directamente desde aquí.'
  );
  return { ok: false, captureDateTime: null };
}

// Lector mínimo de EXIF (JPEG/TIFF): extrae Fabricante (0x010F), Modelo
// (0x0110) y Fecha original de captura (0x9003) leyendo directamente los
// bytes del archivo. No depende de librerías externas.
function readBasicExif(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // no es JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break; // marcador inválido, se detiene

    if (marker === 0xffe1) {
      const segmentLength = view.getUint16(offset + 2);
      const segmentStart = offset + 4;
      const isExif =
        view.getUint32(segmentStart) === 0x45786966 && view.getUint16(segmentStart + 4) === 0x0000;
      if (!isExif) { offset += 2 + segmentLength; continue; }

      const tiffOffset = segmentStart + 6;
      const byteOrderMark = view.getUint16(tiffOffset);
      const little = byteOrderMark === 0x4949;
      if (!little && byteOrderMark !== 0x4d4d) return null;

      const firstIfdOffset = view.getUint32(tiffOffset + 4, little);
      const ifd0 = readExifIfd(view, tiffOffset, tiffOffset + firstIfdOffset, little);

      let dateTimeOriginal = null;
      const exifSubIfdPointer = ifd0[0x8769];
      if (typeof exifSubIfdPointer === 'number') {
        const subIfd = readExifIfd(view, tiffOffset, tiffOffset + exifSubIfdPointer, little);
        dateTimeOriginal = subIfd[0x9003] || null;
      }

      return {
        make: ifd0[0x010f] || null,
        model: ifd0[0x0110] || null,
        // 0x9003 (SubIFD) es la fecha de disparo; 0x0132 (IFD0) es la de
        // "última modificación" y sirve de respaldo si la cámara no llenó
        // la primera.
        dateTimeOriginal: dateTimeOriginal || ifd0[0x0132] || null,
      };
    }

    if (marker === 0xffd8 || marker === 0xffd9) { offset += 2; continue; }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return null;
}

function readExifIfd(view, tiffOffset, ifdOffset, little) {
  const entries = {};
  if (ifdOffset + 2 > view.byteLength) return entries;
  const count = view.getUint16(ifdOffset, little);

  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const numValues = view.getUint32(entryOffset + 4, little);
    const valueFieldOffset = entryOffset + 8;

    if (type === 2) { // ASCII
      const byteLength = numValues;
      const dataOffset = byteLength <= 4 ? valueFieldOffset : tiffOffset + view.getUint32(valueFieldOffset, little);
      let str = '';
      for (let j = 0; j < byteLength && dataOffset + j < view.byteLength; j++) {
        const code = view.getUint8(dataOffset + j);
        if (code === 0) break;
        str += String.fromCharCode(code);
      }
      entries[tag] = str.trim();
    } else if (type === 3) { // SHORT
      entries[tag] = view.getUint16(valueFieldOffset, little);
    } else if (type === 4) { // LONG
      entries[tag] = view.getUint32(valueFieldOffset, little);
    }
  }
  return entries;
}

// ------------------------------------------------------------
// Carga de archivos
// ------------------------------------------------------------
function queueUpload(file, pointCode, category, fileListEl, countEl, locationPromise, captureDateTime, isVideo) {
  const row = els.fileRowTpl.content.firstElementChild.cloneNode(true);
  const icon = row.querySelector('[data-role="file-icon"]');
  const nameEl = row.querySelector('[data-role="file-name"]');
  const statusEl = row.querySelector('[data-role="file-status"]');

  nameEl.textContent = file.name + ' · ' + formatSize(file.size);
  statusEl.textContent = 'Subiendo…';
  row.classList.add('is-uploading');
  icon.textContent = '⏳';
  fileListEl.prepend(row);

  uploadFile(file, pointCode, category, locationPromise, captureDateTime, isVideo)
    .then(function (result) {
      row.classList.remove('is-uploading');
      row.classList.add('is-success');
      icon.textContent = '✅';
      nameEl.textContent = result.fileName + ' · ' + formatSize(file.size);
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
        uploadFile(file, pointCode, category, locationPromise, captureDateTime, isVideo)
          .then(function (result) {
            row.classList.remove('is-uploading');
            row.classList.add('is-success');
            icon.textContent = '✅';
            nameEl.textContent = result.fileName + ' · ' + formatSize(file.size);
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

function uploadFile(file, pointCode, category, locationPromise, captureDateTime, isVideo) {
  const locReady = locationPromise ? locationPromise.catch(function () { return null; }) : Promise.resolve(null);

  return Promise.all([fileToBase64(file), locReady]).then(function (results) {
    const base64Data = results[0];
    const location = results[1];

    const payload = {
      action: 'upload',
      pointCode: pointCode,
      categoryId: category.id,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64Data: base64Data,
      // Ubicación tomada por el navegador al momento de tocar "Tomar foto".
      // Va aparte del archivo — el backend la guarda como descripción del
      // archivo en Drive, nunca dentro del JPEG.
      location: location,
      // Fecha de captura leída del EXIF (formato "AAAA:MM:DD HH:MM:SS"), o
      // null si no la trae (típico en videos) — el backend arma el nombre
      // final IMG_/VID_AAAAMMDD_HHMMSS a partir de esto.
      captureDateTime: captureDateTime || null,
      isVideo: !!isVideo,
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
