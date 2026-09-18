/* Reporte semanal de avances - UIDUS / PNC
 * Web estática (GitHub Pages). Los datos viven en Google Sheets vía Apps Script (config.js -> API_URL).
 * Sin API_URL funciona en modo demostración con localStorage. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEMO = !window.CONFIG.API_URL;
const state = { code: '', sesion: null, catalogo: [], registros: [], charts: {} };

/* ---------- utilidades ---------- */
const parseMoney = s => { const n = Number(String(s == null ? '' : s).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const fmtMoney = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
function hoy() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yy = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(yy, 0, 1)) / 864e5 + 1) / 7);
  return yy + '-W' + pad(w);
}
function weekRange(sem) {
  const [y, w] = sem.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (w - 1) * 7);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const f = d => pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
  return f(mon) + ' al ' + f(sun);
}
const fmtFecha = iso => { if (!iso) return ''; const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})T?(\d{2})?:?(\d{2})?/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}` : iso; };
const trunc = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const semLabel = s => `${s} (${weekRange(s)})`;
const semaforoIcon = s => s === 'Verde' ? '✔' : s === 'Rojo' ? '✖' : '▲';
const pill = s => `<span class="pill ${esc(s)}"><span class="dot">${semaforoIcon(s)}</span>${esc(s)}</span>`;
const linksOf = ev => String(ev || '').split(/\s+/).filter(Boolean);
const byFechaDesc = (a, b) => String(b.fecha).localeCompare(String(a.fecha));
function ultimosPorSemana(regs) {
  const m = new Map();
  regs.slice().sort(byFechaDesc).forEach(r => { const k = r.proyectoId + '|' + r.semana; if (!m.has(k)) m.set(k, r); });
  return Array.from(m.values());
}
const semanasDisponibles = regs => Array.from(new Set(regs.map(r => r.semana))).sort().reverse();
const nombreProyecto = id => id;
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
};
function setMsg(el, kind, text) { el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; }

/* ---------- capa de datos ---------- */
const Demo = {
  key: 'reporte_avances_demo',
  mem: null,
  load() {
    if (this.mem) return this.mem;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) {}
    this.mem = d || { registros: [] };
    return this.mem;
  },
  persist() { try { localStorage.setItem(this.key, JSON.stringify(this.mem)); } catch (e) {} },
  catalogo() {
    return [
      { id: 'BELEN-VARILLALITO', programa: 'Habilitación Urbana para la reubicación de la población de la zona baja de Belén, en el predio Varillalito, distrito de San Juan Bautista, provincia de Maynas, departamento de Loreto', cui: 'Prog-03-2015-SNIP',
        estructurantes: 'CUI: 2300564: Creación de los servicios de agua potable y saneamiento de la Nueva Ciudad de Belén - Varillalito\nCUI: 2307577: Creación del servicio de drenaje pluvial urbano de la Nueva Ciudad de Belén - Varillalito\nCUI: 2300167: Creación de los servicios de vialidad de la Nueva Ciudad de Belén - Varillalito\nCUI: 2277384: Gestión del programa y otros',
        montos: [{ cui: '2300564', monto: 105987017.16, etapa1: 67170344.56 }, { cui: '2300167', monto: 168291013.61, etapa1: 90701639.417 }, { cui: '2307577', monto: 49187477.12, etapa1: 17918125.11 }, { cui: '2277384', monto: 18648349.25, etapa1: 3225333.33 }] },
      { id: 'DEMO-PROYECTO-2', programa: 'Proyecto de ejemplo 2 (solo demostración)', cui: '0000001', estructurantes: 'CUI: 0000001: Ejemplo', montos: [{ cui: '0000001', monto: 1000000, etapa1: 500000 }] },
      { id: 'DEMO-PROYECTO-3', programa: 'Proyecto de ejemplo 3 (solo demostración)', cui: '0000002', estructurantes: 'CUI: 0000002: Ejemplo', montos: [{ cui: '0000002', monto: 2000000, etapa1: 900000 }] }
    ];
  },
  async call(action, p) {
    const codes = { ADMIN: { nombre: 'Administrador (demo)', rol: 'admin', proyectos: ['*'] }, BELEN: { nombre: 'Responsable Belén (demo)', rol: 'usuario', proyectos: ['BELEN-VARILLALITO'] } };
    const s = codes[String(p.code || state.code).toUpperCase()];
    if (!s) return { ok: false, error: 'Código de acceso no válido' };
    const ver = id => s.rol === 'admin' || s.proyectos.includes(id);
    const db = this.load();
    if (action === 'login') return { ok: true, sesion: s, catalogo: this.catalogo().filter(c => ver(c.id)) };
    if (action === 'list') return { ok: true, registros: db.registros.filter(r => ver(r.proyectoId)) };
    if (action === 'save') {
      const r = p.registro;
      if (!ver(r.proyectoId)) return { ok: false, error: 'No tiene acceso a este proyecto' };
      const evid = [].concat(String(r.evidenciaEnlaces || '').split(/\s+/).filter(Boolean), (r.archivos || []).map(a => '(demo) ' + a.nombre.replace(/\s+/g, '_'))).join('\n');
      const rec = { id: Math.random().toString(16).slice(2, 10).toUpperCase(), fecha: new Date().toISOString().slice(0, 19), semana: r.semana, proyectoId: r.proyectoId, usuario: s.nombre,
        programa: r.programa, cui: r.cui, estructurantes: r.estructurantes, montos: r.montos, estado: r.estado, hitosSemestre: r.hitosSemestre, hitosSemanal: r.hitosSemanal,
        avance: r.avance, porcentaje: Number(r.porcentaje) || 0, semaforo: r.semaforo, evidencia: evid, riesgo: r.riesgo, medidas: r.medidas };
      db.registros.push(rec); this.persist();
      return { ok: true, id: rec.id };
    }
    if (action === 'delete') {
      if (s.rol !== 'admin') return { ok: false, error: 'Solo el administrador puede eliminar' };
      db.registros = db.registros.filter(r => r.id !== p.id); this.persist(); return { ok: true };
    }
    return { ok: false, error: 'Acción desconocida' };
  }
};

async function api(action, payload) {
  payload = payload || {};
  if (DEMO) return Demo.call(action, Object.assign({ code: state.code }, payload));
  const url = window.CONFIG.API_URL;
  const body = Object.assign({ action, code: state.code }, payload);
  const soloLectura = action === 'login' || action === 'list';
  const leer = async r => {
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('respuesta inesperada del servidor: ' + t.slice(0, 100).replace(/\s+/g, ' ')); }
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return await leer(r);
  } catch (e1) {
    if (soloLectura) { // reintento por GET para consultas
      try { return await leer(await fetch(url + '?' + new URLSearchParams({ action, code: state.code }))); }
      catch (e2) { return { ok: false, error: 'No se pudo conectar con el servidor (' + e2.message + ').' }; }
    }
    return { ok: false, error: 'No se pudo conectar con el servidor (' + e1.message + ').' };
  }
}

/* ---------- login ---------- */
async function entrar(code, silencioso) {
  state.code = code.trim();
  const r = await api('login');
  if (!r.ok) { state.code = ''; store.del('code'); if (!silencioso) setMsg($('#loginMsg'), 'err', r.error); return false; }
  state.sesion = r.sesion; state.catalogo = r.catalogo;
  store.set('code', state.code);
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#whoName').textContent = `${r.sesion.nombre} · ${r.sesion.rol === 'admin' ? 'Administrador' : 'Usuario'}`;
  const admin = r.sesion.rol === 'admin';
  $$('[data-admin]').forEach(b => b.classList.toggle('hidden', !admin));
  $('#btnDemoData').classList.toggle('hidden', !(DEMO && admin));
  await cargarRegistros();
  initFormulario();
  return true;
}
async function cargarRegistros() {
  const r = await api('list');
  if (r.ok) state.registros = r.registros;
  poblarFiltros();
}

/* ---------- pestañas ---------- */
function activarTab(t) {
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  ['form', 'list', 'ppt', 'dash'].forEach(x => $('#tab-' + x).classList.toggle('hidden', x !== t));
  if (t === 'list') renderLista();
  if (t === 'dash') renderDashboard();
}

/* ---------- formulario ---------- */
function initFormulario() {
  const sel = $('#fProyecto');
  sel.innerHTML = state.catalogo.map(c => `<option value="${esc(c.id)}">${esc(c.id)}</option>`).join('');
  $('#fFecha').value = hoy();
  actualizarSemana();
  precargarProyecto();
}
function actualizarSemana() {
  const f = $('#fFecha').value;
  $('#fSemana').textContent = f ? semLabel(isoWeek(f)) : '';
}
function montoRow(m) {
  m = m || { cui: '', monto: '', etapa1: '' };
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" class="m-cui" value="${esc(m.cui)}" aria-label="CUI"></td>
    <td><input type="text" inputmode="decimal" class="m-monto" value="${m.monto === '' ? '' : esc(m.monto)}" aria-label="Monto de inversión"></td>
    <td><input type="text" inputmode="decimal" class="m-etapa" value="${m.etapa1 === '' ? '' : esc(m.etapa1)}" aria-label="Monto etapa 1"></td>
    <td><button type="button" class="btn sm danger" aria-label="Quitar fila">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); totales(); };
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input', totales));
  return tr;
}
function leerMontos() {
  return $$('#montosBody tr').map(tr => ({ cui: $('.m-cui', tr).value.trim(), monto: parseMoney($('.m-monto', tr).value), etapa1: parseMoney($('.m-etapa', tr).value) })).filter(m => m.cui || m.monto || m.etapa1);
}
function totales() {
  const ms = leerMontos();
  $('#totMonto').textContent = fmtMoney(ms.reduce((a, m) => a + m.monto, 0));
  $('#totEtapa').textContent = fmtMoney(ms.reduce((a, m) => a + m.etapa1, 0));
}
function precargarProyecto() {
  const id = $('#fProyecto').value;
  const cat = state.catalogo.find(c => c.id === id);
  if (!cat) return;
  const ult = state.registros.filter(r => r.proyectoId === id).sort(byFechaDesc)[0];
  const base = ult || {};
  $('#fPrograma').value = base.programa || cat.programa || '';
  $('#fCui').value = base.cui || cat.cui || '';
  $('#fEstructurantes').value = base.estructurantes || cat.estructurantes || '';
  $('#montosBody').innerHTML = '';
  (base.montos && base.montos.length ? base.montos : cat.montos || []).forEach(m => $('#montosBody').appendChild(montoRow(m)));
  totales();
  $('#fEstado').value = base.estado || '';
  $('#fHitosSem').value = base.hitosSemestre || '';
  $('#fHitosSemanal').value = '';
  $('#fRiesgo').value = base.riesgo || '';
  $('#fMedidas').value = base.medidas || '';
  limpiarAvance();
  $('#prefillNote').textContent = ult ? `Se precargaron los textos del último reporte (${ult.semana}). Revise y actualice lo que cambió esta semana.` : 'Primer reporte de este proyecto: se cargaron los datos del catálogo.';
}
function limpiarAvance() {
  $('#fAvance').value = ''; $('#fEnlaces').value = ''; $('#fArchivos').value = ''; $('#archList').textContent = '';
  $('#fPct').value = 0; $('#fPctOut').textContent = '0%';
  $('input[name=semaforo][value=Verde]').checked = true;
}
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

async function enviarFormulario(e) {
  e.preventDefault();
  const msg = $('#saveMsg');
  const avance = $('#fAvance').value.trim();
  if (!$('#fProyecto').value) return setMsg(msg, 'err', 'Seleccione un proyecto.');
  if (!$('#fFecha').value) return setMsg(msg, 'err', 'Indique la fecha de corte.');
  if (avance.length < 3) { $('#fAvance').focus(); return setMsg(msg, 'err', 'El avance semanal es obligatorio.'); }
  const files = Array.from($('#fArchivos').files);
  if (files.length > 5) return setMsg(msg, 'err', 'Máximo 5 archivos.');
  const grande = files.find(f => f.size > 6 * 1024 * 1024);
  if (grande) return setMsg(msg, 'err', `"${grande.name}" supera 6 MB. Suba el archivo a Drive y pegue el enlace.`);
  const btn = $('#saveBtn'); btn.disabled = true; setMsg(msg, 'info', 'Guardando…');
  try {
    const archivos = [];
    for (const f of files) archivos.push({ nombre: f.name, tipo: f.type, base64: DEMO ? '' : await toB64(f) });
    const registro = {
      proyectoId: $('#fProyecto').value, semana: isoWeek($('#fFecha').value),
      programa: $('#fPrograma').value.trim(), cui: $('#fCui').value.trim(), estructurantes: $('#fEstructurantes').value.trim(), montos: leerMontos(),
      estado: $('#fEstado').value.trim(), hitosSemestre: $('#fHitosSem').value.trim(), hitosSemanal: $('#fHitosSemanal').value.trim(),
      avance, porcentaje: Number($('#fPct').value), semaforo: $('input[name=semaforo]:checked').value,
      evidenciaEnlaces: $('#fEnlaces').value.trim(), archivos, riesgo: $('#fRiesgo').value.trim(), medidas: $('#fMedidas').value.trim()
    };
    const r = await api('save', { registro });
    if (!r.ok) throw new Error(r.error);
    await cargarRegistros();
    setMsg(msg, 'ok', `Reporte registrado (N.º ${r.id}, ${registro.semana}). Ya aparece en el listado.`);
    precargarProyecto();
  } catch (err) {
    setMsg(msg, 'err', 'No se pudo guardar: ' + err.message);
  } finally { btn.disabled = false; }
}

/* ---------- filtros y listado ---------- */
function poblarFiltros() {
  const semanas = semanasDisponibles(state.registros);
  const proy = [...new Set(state.catalogo.map(c => c.id))];
  const optP = (todos) => (todos ? '<option value="">Todos</option>' : '') + proy.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const optS = (todos) => (todos ? '<option value="">Todas</option>' : '') + semanas.map(s => `<option value="${esc(s)}">${esc(semLabel(s))}</option>`).join('') || '<option value="">(sin registros)</option>';
  const keep = (id, html) => { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === v)) el.value = v; };
  keep('#lProyecto', optP(true)); keep('#lSemana', optS(true));
  keep('#pSemana', optS(false)); keep('#dSemana', optS(false));
  keep('#dProyecto', '<option value="">Promedio de todos</option>' + proy.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join(''));
}
function filtrados() {
  const p = $('#lProyecto').value, s = $('#lSemana').value, q = $('#lBuscar').value.trim().toLowerCase();
  return state.registros.filter(r => (!p || r.proyectoId === p) && (!s || r.semana === s) &&
    (!q || [r.avance, r.hitosSemanal, r.riesgo, r.medidas, r.estado, r.proyectoId, r.usuario].join(' ').toLowerCase().includes(q))).sort(byFechaDesc);
}
function renderLista() {
  const rows = filtrados();
  $('#listCount').textContent = `${rows.length} registro(s)`;
  const admin = state.sesion.rol === 'admin';
  $('#listTable').innerHTML = `<thead><tr><th>Semana</th><th>Proyecto</th><th>% avance</th><th>Semáforo</th><th>Avance semanal</th><th>Riesgo potencial</th><th>Registrado por</th><th>Acciones</th></tr></thead><tbody>` +
    (rows.length ? rows.map(r => `<tr>
      <td>${esc(r.semana)}<div class="muted small">${esc(weekRange(r.semana))}</div></td>
      <td><strong>${esc(r.proyectoId)}</strong></td>
      <td class="num">${esc(r.porcentaje)}%</td>
      <td>${pill(r.semaforo)}</td>
      <td><div class="clip">${esc(r.avance)}</div></td>
      <td><div class="clip">${esc(r.riesgo)}</div></td>
      <td>${esc(r.usuario)}<div class="muted small">${esc(fmtFecha(r.fecha))}</div></td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="ver" data-id="${esc(r.id)}">Ver</button>
        <button class="btn sm" data-act="ficha" data-id="${esc(r.id)}">Ficha PDF</button>
        ${admin ? `<button class="btn sm danger" data-act="del" data-id="${esc(r.id)}">Eliminar</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">No hay registros con estos filtros.</td></tr>`) + '</tbody>';
}
function verRegistro(r) {
  const ev = linksOf(r.evidencia).map(u => /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u)).join('<br>') || '—';
  $('#dlgTitle').textContent = `${r.proyectoId} · ${semLabel(r.semana)}`;
  const dd = (t, v) => `<dt>${esc(t)}</dt><dd>${v}</dd>`;
  $('#dlgBody').innerHTML = '<dl>' +
    dd('Avance', `${esc(r.porcentaje)}% · ${pill(r.semaforo)}`) + dd('Avance semanal', esc(r.avance)) + dd('Hitos programados semanal', esc(r.hitosSemanal) || '—') +
    dd('Hitos 4.º semestre 2026', esc(r.hitosSemestre) || '—') + dd('Estado situacional', esc(r.estado) || '—') + dd('Riesgo potencial', esc(r.riesgo) || '—') +
    dd('Medidas de mitigación', esc(r.medidas) || '—') + dd('Evidencia', ev) +
    dd('Programa o proyecto', esc(r.programa)) + dd('CUI / SNIP', esc(r.cui)) + dd('Registrado', `${esc(r.usuario)} · ${esc(fmtFecha(r.fecha))} · N.º ${esc(r.id)}`) + '</dl>';
  $('#dlg').showModal();
}

/* ---------- exportar: Excel ---------- */
function exportarExcel() {
  const rows = filtrados();
  if (!rows.length) return alert('No hay registros para exportar.');
  const data = rows.map(r => ({
    'Semana': r.semana, 'Periodo': weekRange(r.semana), 'Proyecto': r.proyectoId, 'Programa o proyecto': r.programa, 'CUI / SNIP': r.cui,
    '% avance': r.porcentaje, 'Semáforo': r.semaforo, 'Avance semanal': r.avance, 'Hitos semanal': r.hitosSemanal, 'Hitos 4.º semestre': r.hitosSemestre,
    'Estado situacional': r.estado, 'Riesgo potencial': r.riesgo, 'Medidas de mitigación': r.medidas, 'Evidencia': linksOf(r.evidencia).join('\n'),
    'Registrado por': r.usuario, 'Fecha de registro': fmtFecha(r.fecha), 'N.º registro': r.id
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [10, 14, 22, 40, 18, 9, 10, 60, 45, 45, 60, 50, 50, 40, 24, 16, 11].map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const montos = [];
  rows.forEach(r => (r.montos || []).forEach(m => montos.push({ 'Semana': r.semana, 'Proyecto': r.proyectoId, 'CUI': m.cui, 'Monto de inversión (S/)': m.monto, 'Monto Etapa 1 (S/)': m.etapa1 })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  if (montos.length) { const w2 = XLSX.utils.json_to_sheet(montos); w2['!cols'] = [10, 22, 14, 24, 22].map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, w2, 'Montos'); }
  XLSX.writeFile(wb, `Registros_Avances_${hoy()}.xlsx`);
}

/* ---------- exportar: PDF (listado y ficha) ---------- */
function nuevoPdf(orient) { const { jsPDF } = window.jspdf; return new jsPDF({ orientation: orient, unit: 'pt', format: 'a4' }); }
function pieDePagina(doc) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Página ${i} de ${n}`, W - 40, H - 20, { align: 'right' }); doc.text('Generado el ' + fmtFecha(new Date().toISOString().slice(0, 16)), 40, H - 20); }
}
function exportarPdf() {
  const rows = filtrados();
  if (!rows.length) return alert('No hay registros para exportar.');
  const doc = nuevoPdf('landscape'), W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold').setFontSize(11).text(window.CONFIG.ENTIDAD, W / 2, 34, { align: 'center' });
  doc.setFontSize(13).text('LISTADO DE REPORTES DE AVANCE DE PROYECTOS', W / 2, 54, { align: 'center' });
  doc.autoTable({
    startY: 70, margin: { left: 30, right: 30, bottom: 34 },
    head: [['Semana', 'Proyecto', '%', 'Semáforo', 'Avance semanal', 'Hitos semanal', 'Riesgo potencial', 'Registrado por']],
    body: rows.map(r => [r.semana + '\n' + weekRange(r.semana), r.proyectoId, r.porcentaje + '%', r.semaforo, trunc(r.avance, 700), trunc(r.hitosSemanal, 400), trunc(r.riesgo, 400), r.usuario + '\n' + fmtFecha(r.fecha)]),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [24, 79, 149], textColor: 255 },
    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 70 }, 2: { cellWidth: 28 }, 3: { cellWidth: 42 }, 7: { cellWidth: 70 } }
  });
  pieDePagina(doc);
  doc.save(`Listado_Avances_${hoy()}.pdf`);
}
function fichaPdf(r) {
  const doc = nuevoPdf('portrait'), W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0);
  doc.text(doc.splitTextToSize(window.CONFIG.ENTIDAD, W - 80), W / 2, 36, { align: 'center' });
  doc.setFontSize(12).text(`REPORTE DE AVANCE - SEMANA ${r.semana} (${weekRange(r.semana)})`, W / 2, 68, { align: 'center' });
  const sec = t => [{ content: t, colSpan: 2, styles: { fillColor: [24, 79, 149], textColor: 255, fontStyle: 'bold' } }];
  const montosTxt = (r.montos || []).map(m => `CUI ${m.cui}:  Monto ${fmtMoney(m.monto)}   |   Etapa 1 ${fmtMoney(m.etapa1)}`).concat(
    r.montos && r.montos.length ? [`TOTAL:  ${fmtMoney(r.montos.reduce((a, m) => a + m.monto, 0))}   |   Etapa 1 ${fmtMoney(r.montos.reduce((a, m) => a + m.etapa1, 0))}`] : []).join('\n');
  const body = [
    sec('1. DATOS GENERALES DEL PROYECTO O PROGRAMA'),
    ['Programa o Proyecto de Inversión Pública', r.programa], ['CUI / Cód. SNIP', r.cui],
    ['Proyecto(s) estructurantes y de prioridad', r.estructurantes], ['Monto de inversión actualizado', montosTxt || '-'],
    sec('2. ESTADO SITUACIONAL DEL PROYECTO'), ['Estado situacional', r.estado || '-'],
    sec('3. HITOS PROGRAMADOS'),
    ['Hitos programados 4.º semestre 2026', r.hitosSemestre || '-'], ['Hitos programados semanal', r.hitosSemanal || '-'],
    ['Avance semanal', `${r.avance}\n\nAvance: ${r.porcentaje}%   |   Semáforo: ${r.semaforo}`],
    ['Evidencia', linksOf(r.evidencia).join('\n') || '-'], ['Riesgo potencial', r.riesgo || '-'], ['Medidas de mitigación', r.medidas || '-']
  ];
  doc.autoTable({ startY: 84, body, theme: 'grid', margin: { left: 40, right: 40, bottom: 34 }, styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'top', lineColor: [190, 190, 190] },
    columnStyles: { 0: { cellWidth: 125, fontStyle: 'bold', fillColor: [238, 242, 248] } } });
  doc.setFontSize(8).setTextColor(120);
  doc.text(`Registrado por ${r.usuario} el ${fmtFecha(r.fecha)} - N.º ${r.id}`, 40, doc.lastAutoTable.finalY + 16);
  pieDePagina(doc);
  doc.save(`Ficha_${r.proyectoId}_${r.semana}.pdf`);
}

/* ---------- reporte PPT ---------- */
const COL = { azul: '184F95', gris: '52514E', claro: 'EEF2F8', Verde: '0A6B0A', 'Ámbar': '9A6A00', Rojo: 'A12525' };
function fontFor(text, base) { const n = String(text || '').length; return n > 1000 ? base - 4 : n > 700 ? base - 3 : n > 450 ? base - 2 : n > 250 ? base - 1 : base; }
function datosSemana(sem) {
  const regs = ultimosPorSemana(state.registros).filter(r => r.semana === sem);
  const proy = state.catalogo.map(c => c.id);
  return { regs: regs.sort((a, b) => a.proyectoId.localeCompare(b.proyectoId)), pendientes: proy.filter(p => !regs.some(r => r.proyectoId === p)) };
}
function generarPpt() {
  const sem = $('#pSemana').value;
  if (!sem) return alert('No hay semanas con registros.');
  const { regs, pendientes } = datosSemana(sem);
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = 'Reporte general de avances ' + sem;
  const W = 13.33;
  const cab = (s, titulo, sub) => {
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.9, fill: { color: COL.azul } });
    s.addText(titulo, { x: 0.4, y: 0.08, w: W - 0.8, h: 0.5, fontSize: 20, bold: true, color: 'FFFFFF', fontFace: 'Calibri', fit: 'shrink' });
    if (sub) s.addText(sub, { x: 0.4, y: 0.52, w: W - 0.8, h: 0.32, fontSize: 11, color: 'DCE6F5', fontFace: 'Calibri' });
    s.addText('UIDUS - Programa Nuestras Ciudades · Semana ' + sem, { x: 0.4, y: 7.1, w: 8, h: 0.3, fontSize: 9, color: '777777' });
  };
  // Portada
  let s = pptx.addSlide(); s.background = { color: COL.azul };
  s.addText('REPORTE GENERAL DE AVANCES DE PROYECTOS', { x: 0.7, y: 2.2, w: W - 1.4, h: 1.2, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
  s.addText(`Semana ${sem} (${weekRange(sem)})`, { x: 0.7, y: 3.5, w: W - 1.4, h: 0.6, fontSize: 22, color: 'DCE6F5' });
  s.addText('Unidad de Inversiones en Desarrollo Urbano Sostenible - Programa Nuestras Ciudades', { x: 0.7, y: 4.3, w: W - 1.4, h: 0.5, fontSize: 16, color: 'DCE6F5' });
  // Resumen
  const chunk = 8;
  for (let i = 0; i < Math.max(regs.length, 1); i += chunk) {
    s = pptx.addSlide(); cab(s, 'Resumen de avance por proyecto', `${regs.length} de ${state.catalogo.length} proyectos con reporte${regs.length > chunk ? ' (continuación ' + (i / chunk + 1) + ')' : ''}`);
    const head = ['Proyecto', '% avance', 'Semáforo', 'Avance semanal'].map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: COL.azul }, fontSize: 12 } }));
    const rows = regs.slice(i, i + chunk).map(r => [
      { text: r.proyectoId, options: { bold: true, fontSize: 11 } }, { text: r.porcentaje + '%', options: { align: 'center', fontSize: 12, bold: true } },
      { text: `${semaforoIcon(r.semaforo)} ${r.semaforo}`, options: { bold: true, color: COL[r.semaforo] || COL.gris, fontSize: 11 } }, { text: trunc(r.avance, 230), options: { fontSize: 10 } }]);
    s.addTable([head].concat(rows.length ? rows : [[{ text: 'Sin reportes esta semana', options: { colspan: 4 } }]]), { x: 0.4, y: 1.15, w: W - 0.8, colW: [3, 1.2, 1.6, W - 0.8 - 5.8], border: { type: 'solid', color: 'CCCCCC', pt: 0.5 }, valign: 'top', fontFace: 'Calibri' });
  }
  // Por proyecto
  regs.forEach(r => {
    const chip = `${r.porcentaje}%  ·  ${semaforoIcon(r.semaforo)} ${r.semaforo}`;
    const box = (s, titulo, texto, x, y, w, h, base) => {
      s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: 'CCCCCC', width: 0.75 } });
      s.addText(titulo, { x, y, w, h: 0.34, fontSize: 12, bold: true, color: 'FFFFFF', fill: { color: COL.azul }, margin: [0, 8, 0, 8] });
      s.addText(trunc(texto, 1300) || '—', { x: x + 0.05, y: y + 0.38, w: w - 0.1, h: h - 0.42, fontSize: fontFor(texto, base), valign: 'top', color: '222222', fontFace: 'Calibri', margin: [2, 6, 2, 6] });
    };
    let sl = pptx.addSlide(); cab(sl, r.proyectoId, trunc(r.programa, 150));
    sl.addText(chip, { x: W - 3.6, y: 1.0, w: 3.2, h: 0.4, fontSize: 14, bold: true, align: 'right', color: COL[r.semaforo] || COL.gris });
    box(sl, 'Avance semanal', r.avance, 0.4, 1.5, 6.2, 2.7, 13);
    box(sl, 'Hitos programados (semana)', r.hitosSemanal, 0.4, 4.3, 6.2, 2.7, 13);
    box(sl, 'Riesgo potencial', r.riesgo, 6.8, 1.5, 6.1, 2.7, 12);
    box(sl, 'Medidas de mitigación', r.medidas, 6.8, 4.3, 6.1, 2.7, 12);
    sl = pptx.addSlide(); cab(sl, r.proyectoId + ' - Situación y hitos', trunc(r.programa, 150));
    box(sl, 'Estado situacional', r.estado, 0.4, 1.15, 6.2, 5.35, 12);
    box(sl, 'Hitos programados 4.º semestre 2026', r.hitosSemestre, 6.8, 1.15, 6.1, 5.35, 12);
    const nEv = linksOf(r.evidencia).length;
    sl.addText(`Evidencias registradas: ${nEv}   ·   Registrado por ${r.usuario} el ${fmtFecha(r.fecha)}`, { x: 0.4, y: 6.6, w: W - 0.8, h: 0.35, fontSize: 10, color: COL.gris });
  });
  // Pendientes
  if (pendientes.length) {
    s = pptx.addSlide(); cab(s, 'Proyectos sin reporte en la semana', `${pendientes.length} pendiente(s)`);
    s.addText(pendientes.map(p => ({ text: p, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.3, w: W - 1.2, h: 5.4, fontSize: 18, color: '222222', valign: 'top' });
  }
  pptx.writeFile({ fileName: `Reporte_General_Avances_${sem}.pptx` });
  const info = $('#pptInfo'); info.classList.remove('hidden');
  info.textContent = `Presentación generada: ${regs.length} proyecto(s) con reporte, ${pendientes.length} sin reporte.`;
}

/* ---------- dashboard ---------- */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function destruir(k) { if (state.charts[k]) { state.charts[k].destroy(); state.charts[k] = null; } }
function tablaSimple(head, rows) {
  return `<table class="data" style="min-width:0"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderDashboard() {
  const sem = $('#dSemana').value;
  if (!sem) { $('#kpis').innerHTML = '<div class="empty" style="grid-column:1/-1">Aún no hay registros. Registre el primer reporte en la pestaña Formulario.</div>'; ['chBar', 'chLine'].forEach(k => destruir(k)); $('#riskList').innerHTML = ''; $('#pendList').innerHTML = ''; return; }
  const { regs, pendientes } = datosSemana(sem);
  const total = state.catalogo.length;
  const prom = regs.length ? Math.round(regs.reduce((a, r) => a + r.porcentaje, 0) / regs.length) : 0;
  const rojos = regs.filter(r => r.semaforo === 'Rojo').length, ambar = regs.filter(r => r.semaforo === 'Ámbar').length;
  $('#kpis').innerHTML = [
    [`${regs.length}/${total}`, 'Proyectos con reporte'], [`${prom}%`, 'Avance promedio'],
    [`<span class="pill Ámbar" style="font-size:1.9rem"><span class="dot">▲</span>${ambar}</span>`, 'En ámbar'], [`<span class="pill Rojo" style="font-size:1.9rem"><span class="dot">✖</span>${rojos}</span>`, 'En rojo']
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  const tick = css('--text-2'), grid = css('--grid'), s1 = css('--series-1'), surf = css('--surface');
  Chart.defaults.font.family = 'system-ui, sans-serif'; Chart.defaults.color = tick;
  // barras
  destruir('bar');
  const barLabels = { id: 'barLabels', afterDatasetsDraw(ch) { const { ctx } = ch; ctx.save(); ctx.fillStyle = css('--text'); ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle';
    ch.getDatasetMeta(0).data.forEach((b, i) => ctx.fillText(ch.data.datasets[0].data[i] + '%', b.x + 6, b.y)); ctx.restore(); } };
  state.charts.bar = new Chart($('#chBar'), {
    type: 'bar', data: { labels: regs.map(r => trunc(r.proyectoId, 26)), datasets: [{ data: regs.map(r => r.porcentaje), backgroundColor: s1, borderRadius: 4, maxBarThickness: 26 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 36 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x}% de avance` } } },
      scales: { x: { min: 0, max: 100, grid: { color: grid }, ticks: { callback: v => v + '%' }, border: { display: false } }, y: { grid: { display: false }, border: { color: grid } } } },
    plugins: [barLabels]
  });
  $('#barTable').innerHTML = tablaSimple(['Proyecto', '% avance', 'Semáforo'], regs.map(r => [r.proyectoId, r.porcentaje + '%', r.semaforo]));

  // línea
  destruir('line');
  const p = $('#dProyecto').value;
  const todas = ultimosPorSemana(state.registros).filter(r => !p || r.proyectoId === p);
  const semanas = [...new Set(todas.map(r => r.semana))].sort();
  const serie = semanas.map(sm => { const rs = todas.filter(r => r.semana === sm); return Math.round(rs.reduce((a, r) => a + r.porcentaje, 0) / rs.length); });
  state.charts.line = new Chart($('#chLine'), {
    type: 'line', data: { labels: semanas, datasets: [{ label: p || 'Promedio de todos', data: serie, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 4, pointBackgroundColor: s1, pointBorderColor: surf, pointBorderWidth: 2, tension: 0.25 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => semLabel(i[0].label), label: c => ` ${c.parsed.y}% de avance` } } },
      scales: { y: { min: 0, max: 100, grid: { color: grid }, ticks: { callback: v => v + '%' }, border: { display: false } }, x: { grid: { display: false }, border: { color: grid } } } }
  });
  $('#lineTable').innerHTML = tablaSimple(['Semana', '% avance'], semanas.map((sm, i) => [sm, serie[i] + '%']));

  // alertas y pendientes
  const alertas = regs.filter(r => r.semaforo !== 'Verde').sort((a, b) => (a.semaforo === 'Rojo' ? 0 : 1) - (b.semaforo === 'Rojo' ? 0 : 1));
  $('#riskList').innerHTML = alertas.length ? alertas.map(r => `<div class="risk-item"><div class="t">${pill(r.semaforo)} ${esc(r.proyectoId)} <span class="muted small">${esc(r.porcentaje)}%</span></div><p>${esc(trunc(r.riesgo || r.avance, 320))}</p></div>`).join('') : '<div class="empty">Sin proyectos en ámbar o rojo.</div>';
  $('#pendList').innerHTML = pendientes.length ? pendientes.map(x => `<div class="risk-item"><div class="t">${esc(x)}</div></div>`).join('') : '<div class="empty">Todos los proyectos reportaron.</div>';
}

/* ---------- datos de ejemplo (solo demo) ---------- */
function generarEjemplos() {
  const db = Demo.load(); const cats = Demo.catalogo();
  const hoyD = new Date(); const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  for (let w = 3; w >= 0; w--) cats.forEach((c, i) => {
    if (w === 0 && i === 2) return; // deja un pendiente
    const d = new Date(hoyD); d.setDate(d.getDate() - 7 * w);
    const f = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const pct = Math.min(100, 20 + (4 - w) * rnd(6, 14) + i * 5);
    db.registros.push({ id: Math.random().toString(16).slice(2, 10).toUpperCase(), fecha: f + 'T09:00:00', semana: isoWeek(f), proyectoId: c.id, usuario: 'Ejemplo', programa: c.programa, cui: c.cui, estructurantes: c.estructurantes, montos: c.montos,
      estado: 'Texto de ejemplo del estado situacional.', hitosSemestre: '* Hito de ejemplo 1\n* Hito de ejemplo 2', hitosSemanal: '* Coordinación con entidades', avance: 'Avance de ejemplo de la semana ' + (4 - w) + '.', porcentaje: pct,
      semaforo: (w + i) % 5 === 0 ? 'Rojo' : (w + i) % 3 === 0 ? 'Ámbar' : 'Verde', evidencia: '', riesgo: 'Riesgo de ejemplo.', medidas: 'Medida de ejemplo.' });
  });
  Demo.persist();
}

/* ---------- eventos ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  if (DEMO) { $('#demoBanner').classList.remove('hidden'); $('#demoHint').textContent = 'Demostración: use ADMIN (administrador) o BELEN (usuario).'; }
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const b = $('#loginBtn'); b.disabled = true; setMsg($('#loginMsg'), 'info', 'Verificando…'); await entrar($('#codeInput').value); b.disabled = false; });
  $('#logoutBtn').onclick = () => { store.del('code'); location.reload(); };
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) activarTab(b.dataset.tab); });
  $('#fProyecto').addEventListener('change', precargarProyecto);
  $('#fFecha').addEventListener('change', actualizarSemana);
  $('#addMonto').onclick = () => $('#montosBody').appendChild(montoRow());
  $('#fPct').addEventListener('input', e => { $('#fPctOut').textContent = e.target.value + '%'; });
  $('#fArchivos').addEventListener('change', e => { $('#archList').textContent = Array.from(e.target.files).map(f => `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`).join(' · '); });
  $('#regForm').addEventListener('submit', enviarFormulario);
  $('#clearBtn').onclick = () => { limpiarAvance(); setMsg($('#saveMsg'), '', ''); };
  ['#lProyecto', '#lSemana'].forEach(s => $(s).addEventListener('change', renderLista));
  $('#lBuscar').addEventListener('input', renderLista);
  $('#btnRefrescar').onclick = async () => { await cargarRegistros(); renderLista(); };
  $('#btnXlsx').onclick = exportarExcel; $('#btnPdf').onclick = exportarPdf; $('#btnPpt').onclick = generarPpt;
  ['#dSemana', '#dProyecto'].forEach(s => $(s).addEventListener('change', renderDashboard));
  $('#btnDemoData').onclick = async () => { generarEjemplos(); await cargarRegistros(); renderDashboard(); };
  $('#dlgClose').onclick = () => $('#dlg').close();
  $('#listTable').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const r = state.registros.find(x => String(x.id) === b.dataset.id); if (!r) return;
    if (b.dataset.act === 'ver') verRegistro(r);
    else if (b.dataset.act === 'ficha') fichaPdf(r);
    else if (b.dataset.act === 'del' && confirm('¿Eliminar este registro de forma permanente?')) { const x = await api('delete', { id: r.id }); if (x.ok) { await cargarRegistros(); renderLista(); } else alert(x.error); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!$('#tab-dash').classList.contains('hidden')) renderDashboard(); });
  const guardado = store.get('code'); if (guardado) entrar(guardado, true);
});
