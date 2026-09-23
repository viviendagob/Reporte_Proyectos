/* Registro y reporte de proyectos - UIDUS / PNC
 * Web estática (GitHub Pages). Los datos viven en Google Sheets vía Apps Script (config.js -> API_URL).
 * Sin API_URL funciona en modo demostración con localStorage. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEMO = !window.CONFIG.API_URL;
const state = { usuario: '', token: '', sesion: null, catalogo: [], usuarios: [], registros: [], charts: {} };

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
const fmtDia = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };
const ubicacionTxt = r => [r.distrito, r.provincia, r.departamento].filter(Boolean).join(', ') + (r.lat !== undefined && r.lat !== '' && r.lat !== null ? ` (${r.lat}, ${r.lng})` : '');
const trunc = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const semLabel = s => `${s} (${weekRange(s)})`;
const semaforoIcon = s => s === 'Verde' ? '✔' : s === 'Rojo' ? '✖' : '▲';
const pill = s => `<span class="pill ${esc(s)}"><span class="dot">${semaforoIcon(s)}</span>${esc(s)}</span>`;
const linksOf = ev => String(ev || '').split(/\s+/).filter(Boolean);
/* -- hitos / actividades / avance semanal: texto legible a partir del arreglo (Excel, PPT, PDF) -- */
const hitoTxt = h => [h.hito, h.responsable && 'Resp.: ' + h.responsable, h.dias && h.dias + ' días',
  (h.inicio || h.fin) && 'Plazo: ' + fmtDia(h.inicio) + ' al ' + fmtDia(h.fin), h.respDirecto && 'Directo: ' + h.respDirecto,
  (h.avance !== '' && h.avance != null) && 'Avance: ' + h.avance + '%'].filter(Boolean).join(' — ');
const actividadTxt = a => [a.actividad, a.responsable && 'Resp.: ' + a.responsable, a.comentario].filter(Boolean).join(' — ');
const avanceItemTxt = v => [v.actividad, v.cumplimiento, v.responsable && 'Resp.: ' + v.responsable, v.evidencia && 'Evid.: ' + v.evidencia].filter(Boolean).join(' — ');
const fmtLista = (arr, fn) => (arr || []).map((x, i) => (i + 1) + '. ' + fn(x)).join('\n');
const olHtml = (arr, fn) => arr && arr.length ? '<ol style="margin:4px 0 0;padding-left:18px">' + arr.map(x => `<li>${esc(fn(x))}</li>`).join('') + '</ol>' : '—';
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
        montos: [
          { cui: '2300564', monto: 105987017.16, etapa1: 67170344.56, devengado2025: 42000000, pia2026: 18000000, pim2026: 22000000, devengadoMes: 9500000, avanceEjec: 45 },
          { cui: '2300167', monto: 168291013.61, etapa1: 90701639.417, devengado2025: 55000000, pia2026: 24000000, pim2026: 29000000, devengadoMes: 11000000, avanceEjec: 38 },
          { cui: '2307577', monto: 49187477.12, etapa1: 17918125.11, devengado2025: 9000000, pia2026: 6000000, pim2026: 7000000, devengadoMes: 1800000, avanceEjec: 22 },
          { cui: '2277384', monto: 18648349.25, etapa1: 3225333.33, devengado2025: 4000000, pia2026: 2000000, pim2026: 2400000, devengadoMes: 600000, avanceEjec: 60 }
        ] },
      { id: 'DEMO-PROYECTO-2', programa: 'Proyecto de ejemplo 2 (solo demostración)', cui: '0000001', estructurantes: 'CUI: 0000001: Ejemplo', montos: [{ cui: '0000001', monto: 1000000, etapa1: 500000 }] },
      { id: 'DEMO-PROYECTO-3', programa: 'Proyecto de ejemplo 3 (solo demostración)', cui: '0000002', estructurantes: 'CUI: 0000002: Ejemplo', montos: [{ cui: '0000002', monto: 2000000, etapa1: 900000 }] }
    ];
  },
  async call(action, p) {
    const users = { admin: { clave: 'admin', s: { usuario: 'admin', nombre: 'Administrador (demo)', rol: 'admin', proyectos: ['*'] } },
      belen: { clave: 'belen', s: { usuario: 'belen', nombre: 'Responsable Belén (demo)', rol: 'usuario', proyectos: ['BELEN-VARILLALITO'] } },
      demo2: { clave: 'demo2', s: { usuario: 'demo2', nombre: 'Responsable Proyecto 2 (demo)', rol: 'usuario', proyectos: ['DEMO-PROYECTO-2'] } } };
    const u = users[String(p.usuario || '').trim().toLowerCase()];
    if (action === 'login' && (!u || u.clave !== p.clave)) return { ok: false, error: 'Usuario o contraseña incorrectos' };
    if (action !== 'login' && (!u || p.token !== 'demo-' + u.s.usuario)) return { ok: false, error: 'Sesión vencida o no válida. Ingrese nuevamente.' };
    const s = u.s;
    const ver = id => s.rol === 'admin' || s.proyectos.includes(id);
    const db = this.load();
    if (action === 'login' || action === 'sesion') return { ok: true, sesion: s, token: 'demo-' + s.usuario, catalogo: this.catalogo().filter(c => ver(c.id)),
      registros: db.registros.filter(r => ver(r.proyectoId)),
      usuarios: s.rol === 'admin' ? Object.values(users).map(x => x.s) : undefined };
    if (action === 'list') return { ok: true, registros: db.registros.filter(r => ver(r.proyectoId)) };
    if (action === 'save') {
      const r = p.registro;
      if (!ver(r.proyectoId)) return { ok: false, error: 'No tiene acceso a este proyecto' };
      const evid = [].concat(String(r.evidenciaEnlaces || '').split(/\s+/).filter(Boolean), (r.archivos || []).map(a => '(demo) ' + a.nombre.replace(/\s+/g, '_'))).join('\n');
      const rec = { id: Math.random().toString(16).slice(2, 10).toUpperCase(), fecha: new Date().toISOString().slice(0, 19), semana: r.semana, proyectoId: r.proyectoId, usuario: s.nombre,
        programa: r.programa, cui: r.cui, estructurantes: r.estructurantes, montos: r.montos,
        fechaInicio: r.fechaInicio, fechaFin: r.fechaFin, estadoProyecto: r.estadoProyecto, departamento: r.departamento, provincia: r.provincia, distrito: r.distrito, lat: r.lat, lng: r.lng, estado: r.estado,
        hitosSemestre: r.hitosSemestre || [], actividadesSemana: r.actividadesSemana || [], avanceDetalle: r.avanceDetalle || [],
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
  if (DEMO) return Demo.call(action, Object.assign({ usuario: state.usuario, token: state.token }, payload));
  const url = window.CONFIG.API_URL;
  const body = Object.assign({ action, usuario: state.usuario, token: state.token }, payload);
  const soloLectura = action === 'login' || action === 'list' || action === 'sesion';
  const leer = async r => {
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('respuesta inesperada del servidor: ' + t.slice(0, 100).replace(/\s+/g, ' ')); }
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return await leer(r);
  } catch (e1) {
    if (soloLectura) { // reintento por GET para consultas
      try { return await leer(await fetch(url + '?' + new URLSearchParams(Object.assign({ action, usuario: state.usuario, token: state.token }, action === 'login' ? { clave: payload.clave } : {})))); }
      catch (e2) { return { ok: false, error: 'No se pudo conectar con el servidor (' + e2.message + ').' }; }
    }
    return { ok: false, error: 'No se pudo conectar con el servidor (' + e1.message + ').' };
  }
}

/* ---------- login ---------- */
async function entrar(usuario, clave, silencioso) {
  state.usuario = String(usuario || '').trim(); if (clave !== null) state.token = '';
  const r = clave === null ? await api('sesion') : await api('login', { clave });
  if (!r.ok) { state.usuario = ''; state.token = ''; store.del('usuario'); store.del('token'); if (!silencioso) setMsg($('#loginMsg'), 'err', r.error); return false; }
  state.sesion = r.sesion; state.catalogo = r.catalogo; state.usuarios = r.usuarios || []; state.token = r.token; state.usuario = r.sesion.usuario;
  state.registros = r.registros || []; poblarFiltros(); // ya vienen en la respuesta de login/sesion: un solo viaje al servidor
  store.set('usuario', state.usuario); store.set('token', state.token);
  $('#appView').classList.remove('hidden'); $('#loginView').classList.add('hidden');
  $('#whoName').textContent = `${r.sesion.nombre} · ${r.sesion.rol === 'admin' ? 'Administrador' : 'Usuario'}`;
  $('#whoAvatar').textContent = String(r.sesion.nombre || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const admin = r.sesion.rol === 'admin';
  $$('[data-admin]').forEach(b => b.classList.toggle('hidden', !admin));
  $('#btnDemoData').classList.toggle('hidden', !(DEMO && admin));
  await initFormulario();
  activarTab(admin ? 'proj' : 'form');
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
  ['proj', 'form', 'list', 'ppt', 'dash'].forEach(x => $('#tab-' + x).classList.toggle('hidden', x !== t));
  if (t === 'proj') renderProyectos();
  if (t === 'list') renderLista();
  if (t === 'dash') renderDashboard();
}

/* ---------- formulario por pasos ---------- */
const PASOS = ['Datos generales', 'Ubicación', 'Presupuesto', 'Cronograma y avance', 'Adjuntos'];
const MAX_ARCHIVOS = 5, MAX_MB = 6;
const TIPOS_OK = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|zip)$/i;
const ACENTOS = { 'Ancash': 'Áncash', 'Apurimac': 'Apurímac', 'Huanuco': 'Huánuco', 'Junin': 'Junín', 'San Martin': 'San Martín' };
const form = { paso: 1, ubigeo: null, mapa: null, marcador: null, punto: null, archivos: [] };
const REGLAS = {
  1: [['#fProyecto', 'Seleccione un proyecto del catálogo.'], ['#fFecha', 'Indique la fecha de corte del reporte.'], ['#fNombre', 'Escriba el nombre del proyecto.'],
      ['#fCui', 'Ingrese el código único (CUI / SNIP).'], ['#fEstadoProy', 'Seleccione el estado del proyecto.']],
  2: [['#fDep', 'Seleccione el departamento.'], ['#fProv', 'Seleccione la provincia.'], ['#fDist', 'Seleccione el distrito.']],
  4: [['#fAvance', 'Describa el avance semanal (mínimo 3 caracteres).']]
};
const fmtNum = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toast(texto, tipo) {
  const t = $('#toast'); t.textContent = texto; t.className = 'toast ' + (tipo || '');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 6000);
}

/* -- validación -- */
function marcar(el, msg) {
  const f = el.closest('.field'); if (!f) return;
  f.classList.toggle('invalid', !!msg);
  f.classList.toggle('valid', !msg && el.value.trim() !== '');
  const e = f.querySelector('.error-msg'); if (e) e.textContent = msg || '';
  el.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
function validarCampo(sel, msg) {
  const el = $(sel), v = el.value.trim();
  const ok = sel === '#fAvance' ? v.length >= 3 : v !== '';
  marcar(el, ok ? '' : msg);
  return ok;
}
function validarPaso(n) {
  let ok = true, primero = null;
  (REGLAS[n] || []).forEach(([s, m]) => { if (!validarCampo(s, m)) { ok = false; primero = primero || $(s); } });
  if (n === 1) {
    const i = $('#fInicio').value, f = $('#fFin').value, mal = i && f && f < i;
    marcar($('#fFin'), mal ? 'La fecha de fin no puede ser anterior a la de inicio.' : '');
    if (mal) { ok = false; primero = primero || $('#fFin'); }
  }
  if (!ok && primero) primero.focus();
  return ok;
}
function limpiarValidacion() {
  $$('.field.invalid, .field.valid').forEach(f => f.classList.remove('invalid', 'valid'));
  $$('.error-msg').forEach(e => { e.textContent = ''; });
}

/* -- stepper -- */
function mostrarPaso(n, desplazar) {
  form.paso = n;
  $$('.step-panel').forEach(p => p.classList.toggle('hidden', Number(p.dataset.step) !== n));
  $$('#stepper li').forEach(li => {
    const k = Number(li.dataset.step), b = li.querySelector('button');
    li.classList.toggle('active', k === n); li.classList.toggle('done', k < n);
    li.querySelector('.step-num').textContent = k < n ? '✓' : String(k);
    if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  const pct = Math.round(n / PASOS.length * 100);
  $('#progressBar').style.width = pct + '%'; $('#progress').setAttribute('aria-valuenow', String(pct));
  $('#stepInfo').textContent = `Paso ${n} de ${PASOS.length}: ${PASOS[n - 1]}`;
  $('#btnPrev').classList.toggle('hidden', n === 1);
  $('#btnNext').classList.toggle('hidden', n === PASOS.length);
  $('#saveBtn').classList.toggle('hidden', n !== PASOS.length);
  if (n === 2) iniciarMapa();
  if (desplazar) $('#stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function irAPaso(n) {
  if (n > form.paso) for (let i = form.paso; i < n; i++) if (!validarPaso(i)) { mostrarPaso(i, true); return false; }
  mostrarPaso(n, true); return true;
}

/* -- ubicación -- */
async function cargarUbigeo() {
  if (form.ubigeo) return form.ubigeo;
  try { const r = await fetch('ubigeo.json'); form.ubigeo = await r.json(); } catch (e) { form.ubigeo = []; }
  form.ubigeo.forEach(d => { d.n = ACENTOS[d.n] || d.n; });
  const s = $('#fDep');
  s.innerHTML = form.ubigeo.length ? '<option value="">Seleccione…</option>' + form.ubigeo.map(d => `<option>${esc(d.n)}</option>`).join('') : '<option value="">(no se pudo cargar la lista)</option>';
  return form.ubigeo;
}
const depSel = () => (form.ubigeo || []).find(d => d.n === $('#fDep').value);
const provSel = () => { const d = depSel(); return d && d.p.find(p => p.n === $('#fProv').value); };
const distSel = () => { const p = provSel(); return p && p.d.find(x => x[0] === $('#fDist').value); };
function llenarProvincias() {
  const d = depSel(), s = $('#fProv');
  s.innerHTML = d ? '<option value="">Seleccione…</option>' + d.p.map(p => `<option>${esc(p.n)}</option>`).join('') : '<option value="">Seleccione departamento…</option>';
  s.disabled = !d; llenarDistritos();
}
function llenarDistritos() {
  const p = provSel(), s = $('#fDist');
  s.innerHTML = p ? '<option value="">Seleccione…</option>' + p.d.map(x => `<option>${esc(x[0])}</option>`).join('') : '<option value="">Seleccione provincia…</option>';
  s.disabled = !p;
}
async function fijarUbicacion(u) {
  await cargarUbigeo(); u = u || {};
  $('#fDep').value = u.departamento || ''; llenarProvincias();
  $('#fProv').value = u.provincia || ''; llenarDistritos();
  $('#fDist').value = u.distrito || '';
  if (u.lat !== undefined && u.lat !== '' && u.lat !== null && isFinite(Number(u.lat))) fijarPunto(Number(u.lat), Number(u.lng), false); else limpiarPunto();
}
function centrarPorSeleccion() {
  if (!form.mapa) return;
  const d = distSel(), p = provSel(), dp = depSel();
  if (d) form.mapa.setView([d[1], d[2]], 12); else if (p) form.mapa.setView([p.lat, p.lon], 9); else if (dp) form.mapa.setView([dp.lat, dp.lon], 6);
}

/* -- mapa (Leaflet + OpenStreetMap) -- */
function iniciarMapa() {
  const box = $('#map');
  if (!window.L) { box.innerHTML = '<div class="map-off">El mapa no está disponible en este momento. Puede continuar sin marcar el punto.</div>'; return; }
  if (!form.mapa) {
    form.mapa = L.map('map', { scrollWheelZoom: false }).setView([-9.19, -75.0], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; colaboradores de OpenStreetMap' }).addTo(form.mapa);
    form.mapa.on('click', e => fijarPunto(e.latlng.lat, e.latlng.lng, false));
  }
  setTimeout(() => { form.mapa.invalidateSize(); if (form.punto) form.mapa.setView(form.punto, 12); else centrarPorSeleccion(); }, 60);
  if (form.punto) fijarPunto(form.punto[0], form.punto[1], false);
}
function fijarPunto(lat, lng, centrar) {
  form.punto = [lat, lng];
  $('#fLat').value = lat.toFixed(5); $('#fLng').value = lng.toFixed(5);
  $('#coordTxt').textContent = `Lat ${lat.toFixed(5)} · Lng ${lng.toFixed(5)}`;
  if (!form.mapa) return;
  if (!form.marcador) {
    form.marcador = L.marker([lat, lng], { draggable: true }).addTo(form.mapa);
    form.marcador.on('dragend', () => { const p = form.marcador.getLatLng(); fijarPunto(p.lat, p.lng, false); });
  } else form.marcador.setLatLng([lat, lng]);
  if (centrar) form.mapa.setView([lat, lng], 12);
}
function limpiarPunto() {
  form.punto = null; $('#fLat').value = ''; $('#fLng').value = ''; $('#coordTxt').textContent = 'Sin punto marcado';
  if (form.marcador) { form.marcador.remove(); form.marcador = null; }
}

/* -- presupuesto -- */
function montoRow(m) {
  m = m || { cui: '', monto: '', etapa1: '', devengado2025: '', pia2026: '', pim2026: '', devengadoMes: '', avanceEjec: '' };
  const tr = document.createElement('tr');
  const money = (cls, val, label) => `<td><div class="money"><span>S/</span><input type="text" inputmode="decimal" class="${cls}" value="${val === '' ? '' : esc(fmtNum(val))}" placeholder="0.00" aria-label="${label}"></div></td>`;
  tr.innerHTML = `<td><input type="text" class="m-cui" value="${esc(m.cui)}" placeholder="Ej.: 2300564" aria-label="CUI"></td>` +
    money('m-monto', m.monto, 'Monto de inversión en soles') +
    money('m-etapa', m.etapa1, 'Monto de la etapa 1 en soles') +
    money('m-dev25', m.devengado2025, 'Monto devengado acumulado al 2025') +
    money('m-pia', m.pia2026, 'PIA 2026') +
    money('m-pim', m.pim2026, 'PIM 2026') +
    money('m-devmes', m.devengadoMes, 'Devengado al mes anterior') +
    `<td><input type="text" inputmode="decimal" class="m-avance" value="${esc(m.avanceEjec)}" placeholder="0" style="width:70px;text-align:right" aria-label="Avance porcentual"></td>
    <td><button type="button" class="btn sm danger" aria-label="Quitar fila">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); totales(); };
  tr.querySelectorAll('.money input').forEach(i => {
    i.addEventListener('input', totales);
    i.addEventListener('focus', () => i.select());
    i.addEventListener('blur', () => { if (i.value.trim() !== '') i.value = fmtNum(parseMoney(i.value)); totales(); });
  });
  return tr;
}
function leerMontos() {
  return $$('#montosBody tr').map(tr => ({
    cui: $('.m-cui', tr).value.trim(), monto: parseMoney($('.m-monto', tr).value), etapa1: parseMoney($('.m-etapa', tr).value),
    devengado2025: parseMoney($('.m-dev25', tr).value), pia2026: parseMoney($('.m-pia', tr).value), pim2026: parseMoney($('.m-pim', tr).value),
    devengadoMes: parseMoney($('.m-devmes', tr).value), avanceEjec: $('.m-avance', tr).value.trim()
  })).filter(m => m.cui || m.monto || m.etapa1 || m.devengado2025 || m.pia2026 || m.pim2026 || m.devengadoMes || m.avanceEjec);
}
function totales() {
  const ms = leerMontos();
  $('#totMonto').textContent = fmtMoney(ms.reduce((a, m) => a + m.monto, 0));
  $('#totEtapa').textContent = fmtMoney(ms.reduce((a, m) => a + m.etapa1, 0));
  $('#totDev25').textContent = fmtMoney(ms.reduce((a, m) => a + m.devengado2025, 0));
  $('#totPia').textContent = fmtMoney(ms.reduce((a, m) => a + m.pia2026, 0));
  $('#totPim').textContent = fmtMoney(ms.reduce((a, m) => a + m.pim2026, 0));
  $('#totDevMes').textContent = fmtMoney(ms.reduce((a, m) => a + m.devengadoMes, 0));
}

/* -- hitos, actividades y avance semanal (tablas dinámicas) -- */
function renumerar(tbody) { $$('tr', tbody).forEach((tr, i) => { const n = tr.querySelector('.n-cell'); if (n) n.textContent = i + 1; }); }
function hitoRow(h) {
  h = h || { hito: '', responsable: '', dias: '', inicio: '', fin: '', respDirecto: '', avance: '' };
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="n-cell num"></td>
    <td><input type="text" class="h-hito" value="${esc(h.hito)}" placeholder="Descripción del hito" aria-label="Hito"></td>
    <td><input type="text" class="h-resp" value="${esc(h.responsable)}" aria-label="Responsable"></td>
    <td><input type="number" class="h-dias" value="${esc(h.dias)}" min="0" style="width:76px" aria-label="Días calendario"></td>
    <td><input type="date" class="h-inicio" value="${esc(h.inicio)}" aria-label="Plazo inicio"></td>
    <td><input type="date" class="h-fin" value="${esc(h.fin)}" aria-label="Plazo fin"></td>
    <td><input type="text" class="h-respd" value="${esc(h.respDirecto)}" aria-label="Responsable(s) directo"></td>
    <td><input type="number" class="h-avance" value="${esc(h.avance)}" min="0" max="100" style="width:76px" aria-label="Avance actual %"></td>
    <td><button type="button" class="btn sm danger" aria-label="Quitar hito">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); renumerar($('#hitosBody')); };
  return tr;
}
function leerHitos() {
  return $$('#hitosBody tr').map(tr => ({
    hito: $('.h-hito', tr).value.trim(), responsable: $('.h-resp', tr).value.trim(), dias: $('.h-dias', tr).value.trim(),
    inicio: $('.h-inicio', tr).value, fin: $('.h-fin', tr).value, respDirecto: $('.h-respd', tr).value.trim(), avance: $('.h-avance', tr).value.trim()
  })).filter(h => h.hito || h.responsable || h.inicio || h.fin || h.respDirecto || h.avance);
}
function actividadRow(a) {
  a = a || { actividad: '', responsable: '', comentario: '' };
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="n-cell num"></td>
    <td><input type="text" class="a-act" value="${esc(a.actividad)}" placeholder="Actividad programada" aria-label="Actividad semanal"></td>
    <td><input type="text" class="a-resp" value="${esc(a.responsable)}" aria-label="Responsable"></td>
    <td><input type="text" class="a-com" value="${esc(a.comentario)}" aria-label="Comentario"></td>
    <td><button type="button" class="btn sm danger" aria-label="Quitar actividad">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); renumerar($('#actividadesBody')); };
  return tr;
}
function leerActividades() {
  return $$('#actividadesBody tr').map(tr => ({
    actividad: $('.a-act', tr).value.trim(), responsable: $('.a-resp', tr).value.trim(), comentario: $('.a-com', tr).value.trim()
  })).filter(a => a.actividad || a.responsable || a.comentario);
}
function avanceRow(v) {
  v = v || { actividad: '', cumplimiento: '', responsable: '', evidencia: '' };
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="n-cell num"></td>
    <td><input type="text" class="v-act" value="${esc(v.actividad)}" placeholder="Actividad de la semana anterior" aria-label="Actividad"></td>
    <td><input type="text" class="v-cum" value="${esc(v.cumplimiento)}" aria-label="Cumplimiento o comentario"></td>
    <td><input type="text" class="v-resp" value="${esc(v.responsable)}" aria-label="Responsable"></td>
    <td><input type="text" class="v-evid" value="${esc(v.evidencia)}" placeholder="Enlace" aria-label="Evidencia"></td>
    <td><button type="button" class="btn sm danger" aria-label="Quitar ítem">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); renumerar($('#avanceDetalleBody')); };
  return tr;
}
function leerAvanceDetalle() {
  return $$('#avanceDetalleBody tr').map(tr => ({
    actividad: $('.v-act', tr).value.trim(), cumplimiento: $('.v-cum', tr).value.trim(), responsable: $('.v-resp', tr).value.trim(), evidencia: $('.v-evid', tr).value.trim()
  })).filter(v => v.actividad || v.cumplimiento || v.responsable || v.evidencia);
}

/* -- adjuntos (arrastrar y soltar) -- */
function pintarArchivos() {
  $('#fileList').innerHTML = form.archivos.map((f, i) => `<li><span aria-hidden="true">📎</span><span class="fname">${esc(f.name)}</span><span class="fsize">${(f.size / 1048576).toFixed(2)} MB</span><button type="button" class="btn sm danger" data-rm="${i}" aria-label="Quitar ${esc(f.name)}">Quitar</button></li>`).join('');
}
function agregarArchivos(lista) {
  const avisos = [];
  for (const f of Array.from(lista)) {
    if (!TIPOS_OK.test(f.name)) { avisos.push(`"${f.name}": tipo de archivo no permitido`); continue; }
    if (f.size > MAX_MB * 1048576) { avisos.push(`"${f.name}" supera ${MAX_MB} MB (suba el archivo a Drive y pegue el enlace)`); continue; }
    if (form.archivos.some(x => x.name === f.name && x.size === f.size)) continue;
    if (form.archivos.length >= MAX_ARCHIVOS) { avisos.push(`Máximo ${MAX_ARCHIVOS} archivos`); break; }
    form.archivos.push(f);
  }
  $('#dzMsg').textContent = avisos.join(' · ');
  pintarArchivos();
}

/* -- carga y limpieza del formulario -- */
async function initFormulario() {
  const sel = $('#fProyecto');
  sel.innerHTML = state.catalogo.map(c => `<option value="${esc(c.id)}">${esc(c.id)}</option>`).join('');
  $('#fFecha').value = hoy(); actualizarSemana();
  await cargarUbigeo();
  await precargarProyecto();
  mostrarPaso(1, false);
}
function actualizarSemana() {
  const f = $('#fFecha').value;
  $('#fSemana').textContent = f ? semLabel(isoWeek(f)) : '';
}
async function precargarProyecto() {
  const id = $('#fProyecto').value;
  const cat = state.catalogo.find(c => c.id === id);
  if (!cat) return;
  const ult = state.registros.filter(r => r.proyectoId === id).sort(byFechaDesc)[0];
  const b = ult || {};
  $('#fNombre').value = b.programa || cat.programa || '';
  $('#fCui').value = b.cui || cat.cui || '';
  $('#fEstructurantes').value = b.estructurantes || cat.estructurantes || '';
  $('#fInicio').value = String(b.fechaInicio || '').slice(0, 10);
  $('#fFin').value = String(b.fechaFin || '').slice(0, 10);
  $('#fEstadoProy').value = b.estadoProyecto || '';
  $('#montosBody').innerHTML = '';
  (b.montos && b.montos.length ? b.montos : cat.montos || []).forEach(m => $('#montosBody').appendChild(montoRow(m)));
  totales();
  $('#fEstado').value = b.estado || '';
  $('#hitosBody').innerHTML = ''; (b.hitosSemestre || []).forEach(h => $('#hitosBody').appendChild(hitoRow(h))); renumerar($('#hitosBody'));
  $('#actividadesBody').innerHTML = ''; renumerar($('#actividadesBody')); // se llena de nuevo cada semana
  $('#avanceDetalleBody').innerHTML = ''; renumerar($('#avanceDetalleBody')); // se llena de nuevo cada semana
  $('#fRiesgo').value = b.riesgo || '';
  $('#fMedidas').value = b.medidas || '';
  await fijarUbicacion({ departamento: b.departamento, provincia: b.provincia, distrito: b.distrito, lat: b.lat, lng: b.lng });
  limpiarAvance(); limpiarValidacion();
  $('#saveMsg').innerHTML = '';
}
function limpiarAvance() {
  $('#fAvance').value = ''; $('#fEnlaces').value = ''; $('#fArchivos').value = '';
  form.archivos = []; pintarArchivos(); $('#dzMsg').textContent = '';
  $('#fPct').value = 0; $('#fPctOut').textContent = '0%';
  $('input[name=semaforo][value=Verde]').checked = true;
}
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

async function enviarFormulario(e) {
  e.preventDefault();
  const msg = $('#saveMsg');
  for (let i = 1; i <= 4; i++) if (!validarPaso(i)) { mostrarPaso(i, true); return setMsg(msg, 'err', `Revise los campos marcados en el paso ${i} (${PASOS[i - 1]}).`); }
  const btn = $('#saveBtn'); btn.disabled = true; btn.classList.add('loading'); setMsg(msg, 'info', 'Guardando…');
  try {
    const archivos = [];
    for (const f of form.archivos) archivos.push({ nombre: f.name, tipo: f.type, base64: DEMO ? '' : await toB64(f) });
    const registro = {
      proyectoId: $('#fProyecto').value, semana: isoWeek($('#fFecha').value),
      programa: $('#fNombre').value.trim(), cui: $('#fCui').value.trim(), estructurantes: $('#fEstructurantes').value.trim(), montos: leerMontos(),
      fechaInicio: $('#fInicio').value, fechaFin: $('#fFin').value, estadoProyecto: $('#fEstadoProy').value,
      departamento: $('#fDep').value, provincia: $('#fProv').value, distrito: $('#fDist').value, lat: $('#fLat').value, lng: $('#fLng').value,
      estado: $('#fEstado').value.trim(), hitosSemestre: leerHitos(), actividadesSemana: leerActividades(), avanceDetalle: leerAvanceDetalle(),
      avance: $('#fAvance').value.trim(), porcentaje: Number($('#fPct').value), semaforo: $('input[name=semaforo]:checked').value,
      evidenciaEnlaces: $('#fEnlaces').value.trim(), archivos, riesgo: $('#fRiesgo').value.trim(), medidas: $('#fMedidas').value.trim()
    };
    const r = await api('save', { registro });
    if (!r.ok) throw new Error(r.error);
    await cargarRegistros();
    await precargarProyecto();
    mostrarPaso(1, true);
    toast(`Reporte registrado (N.º ${r.id}, ${registro.semana}). Ya aparece en el listado.`, 'ok');
  } catch (err) {
    setMsg(msg, 'err', 'No se pudo guardar: ' + err.message);
  } finally { btn.disabled = false; btn.classList.remove('loading'); }
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
    (!q || [r.avance, fmtLista(r.actividadesSemana, actividadTxt), r.riesgo, r.medidas, r.estado, r.proyectoId, r.usuario].join(' ').toLowerCase().includes(q))).sort(byFechaDesc);
}
function renderLista() {
  const rows = filtrados();
  $('#listCount').textContent = `${rows.length} registro(s)`;
  const admin = state.sesion.rol === 'admin';
  $('#listTable').innerHTML = `<thead><tr><th>Semana</th><th>Proyecto</th><th>% avance</th><th>Semáforo</th><th>Avance semanal</th><th>Riesgo potencial</th><th>Registrado por</th><th>Acciones</th></tr></thead><tbody>` +
    (rows.length ? rows.map(r => `<tr>
      <td>${esc(r.semana)}<div class="muted small">${esc(weekRange(r.semana))}</div></td>
      <td><strong>${esc(r.proyectoId)}</strong><div class="muted small">${esc([r.estadoProyecto, r.distrito].filter(Boolean).join(' · '))}</div></td>
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
/* ---------- panel de proyectos (administrador) ---------- */
function poblarSemanasProy() {
  const act = isoWeek(hoy());
  const semanas = Array.from(new Set([act].concat(semanasDisponibles(state.registros)))).sort().reverse();
  const el = $('#pjSemana'), v = el.value;
  el.innerHTML = semanas.map(x => `<option value="${esc(x)}">${esc(semLabel(x))}${x === act ? ' · actual' : ''}</option>`).join('');
  el.value = semanas.includes(v) ? v : act;
}
function renderProyectos() {
  if (!state.sesion || state.sesion.rol !== 'admin') return;
  poblarSemanasProy();
  const sem = $('#pjSemana').value, f = $('#pjEstado').value, q = $('#pjBuscar').value.trim().toLowerCase();
  const todos = state.catalogo.map(c => {
    const regs = state.registros.filter(r => r.proyectoId === c.id).sort(byFechaDesc);
    const deSem = regs.find(r => r.semana === sem);
    const usuarios = state.usuarios.filter(u => u.rol !== 'admin' && (u.proyectos.includes('*') || u.proyectos.includes(c.id)));
    return { c, regs, deSem, ultimo: regs[0], usuarios };
  });
  const rep = todos.filter(x => x.deSem).length;
  const rojos = todos.filter(x => x.deSem && x.deSem.semaforo === 'Rojo').length;
  const kp = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('#projKpis').innerHTML = kp(todos.length, 'Proyectos') + kp(rep, 'Con reporte en la semana') + kp(todos.length - rep, 'Sin reporte') + kp(rojos, 'En rojo');
  const lista = todos.filter(x => {
    const txt = [x.c.id, x.c.programa, x.usuarios.map(u => u.nombre + ' ' + u.usuario).join(' ')].join(' ').toLowerCase();
    if (q && !txt.includes(q)) return false;
    if (f === 'pend') return !x.deSem;
    if (f === 'ok') return !!x.deSem;
    if (f) return x.deSem && x.deSem.semaforo === f;
    return true;
  });
  $('#projGrid').innerHTML = lista.length ? lista.map(x => {
    const r = x.deSem || x.ultimo, st = x.deSem ? (x.deSem.semaforo === 'Verde' ? 'ok' : x.deSem.semaforo) : 'pend';
    return `<article class="proj-card st-${esc(st)}">
      <div class="proj-top"><h3>${esc(x.c.id)}</h3>${x.deSem ? '<span class="badge ok">Reportó</span>' : '<span class="badge pend">Sin reporte</span>'}</div>
      <div class="prog">${esc(trunc((r && r.programa) || x.c.programa, 140))}</div>
      ${r ? `<div><div class="bar" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, Number(r.porcentaje) || 0))}%"></i></div>
        <div class="proj-meta" style="margin-top:6px"><span><b>${esc(r.porcentaje)}%</b> de avance · ${pill(r.semaforo)}</span>
        <span>${x.deSem ? 'Semana ' + esc(r.semana) : 'Último reporte: ' + esc(r.semana)} · ${esc(fmtFecha(r.fecha))}</span>
        <span>${esc([r.estadoProyecto, ubicacionTxt(r).replace(/ \(.*\)$/, '')].filter(Boolean).join(' · ') || '—')}</span>
        <span>${esc(trunc(r.avance, 130))}</span></div></div>` : '<div class="proj-meta">Aún no hay reportes de este proyecto.</div>'}
      <div class="proj-users">${x.usuarios.length ? x.usuarios.map(u => `<span class="chip" title="${esc(u.usuario)}">${esc(u.nombre)}</span>`).join('') : '<span class="muted small">Sin usuario asignado</span>'}</div>
      <div class="proj-actions">
        ${r ? `<button class="btn sm primary" data-pact="ver" data-id="${esc(r.id)}">Ver reporte</button><button class="btn sm" data-pact="ficha" data-id="${esc(r.id)}">Ficha PDF</button>` : ''}
        <button class="btn sm" data-pact="hist" data-pid="${esc(x.c.id)}">Historial (${x.regs.length})</button></div>
    </article>`; }).join('') : '<div class="empty card">No hay proyectos con estos filtros.</div>';
}
function verRegistro(r) {
  const ev = linksOf(r.evidencia).map(u => /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u)).join('<br>') || '—';
  $('#dlgTitle').textContent = `${r.proyectoId} · ${semLabel(r.semana)}`;
  const dd = (t, v) => `<dt>${esc(t)}</dt><dd>${v}</dd>`;
  $('#dlgBody').innerHTML = '<dl>' +
    dd('Avance', `${esc(r.porcentaje)}% · ${pill(r.semaforo)}`) + dd('Avance semanal', esc(r.avance)) +
    dd('Avance semanal (detalle)', olHtml(r.avanceDetalle, avanceItemTxt)) +
    dd('Actividades programadas (semana)', olHtml(r.actividadesSemana, actividadTxt)) +
    dd('Hitos 4.º semestre 2026', olHtml(r.hitosSemestre, hitoTxt)) + dd('Estado situacional', esc(r.estado) || '—') + dd('Riesgo potencial', esc(r.riesgo) || '—') +
    dd('Medidas de mitigación', esc(r.medidas) || '—') + dd('Evidencia', ev) +
    dd('Nombre del proyecto', esc(r.programa)) + dd('CUI / SNIP', esc(r.cui)) + dd('Estado del proyecto', esc(r.estadoProyecto) || '—') +
    dd('Fechas', esc(fmtDia(r.fechaInicio) + ' al ' + fmtDia(r.fechaFin))) + dd('Ubicación', esc(ubicacionTxt(r)) || '—') + dd('Registrado', `${esc(r.usuario)} · ${esc(fmtFecha(r.fecha))} · N.º ${esc(r.id)}`) + '</dl>';
  $('#dlg').showModal();
}

/* ---------- exportar: Excel ---------- */
function exportarExcel() {
  const rows = filtrados();
  if (!rows.length) return alert('No hay registros para exportar.');
  const data = rows.map(r => ({
    'Semana': r.semana, 'Periodo': weekRange(r.semana), 'Proyecto': r.proyectoId, 'Nombre del proyecto': r.programa, 'CUI / SNIP': r.cui,
    'Estado del proyecto': r.estadoProyecto, 'Fecha inicio': fmtDia(r.fechaInicio), 'Fecha fin': fmtDia(r.fechaFin), 'Departamento': r.departamento, 'Provincia': r.provincia, 'Distrito': r.distrito, 'Latitud': r.lat, 'Longitud': r.lng,
    '% avance': r.porcentaje, 'Semáforo': r.semaforo, 'Avance semanal': r.avance, 'Avance semanal (detalle)': fmtLista(r.avanceDetalle, avanceItemTxt),
    'Actividades programadas (semana)': fmtLista(r.actividadesSemana, actividadTxt), 'Hitos 4.º semestre': fmtLista(r.hitosSemestre, hitoTxt),
    'Estado situacional': r.estado, 'Riesgo potencial': r.riesgo, 'Medidas de mitigación': r.medidas, 'Evidencia': linksOf(r.evidencia).join('\n'),
    'Registrado por': r.usuario, 'Fecha de registro': fmtFecha(r.fecha), 'N.º registro': r.id
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [10, 14, 22, 40, 18, 14, 12, 12, 14, 14, 16, 11, 11, 9, 10, 60, 45, 45, 45, 60, 50, 50, 40, 24, 16, 11].map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const montos = [];
  rows.forEach(r => (r.montos || []).forEach(m => montos.push({
    'Semana': r.semana, 'Proyecto': r.proyectoId, 'CUI': m.cui, 'Monto de inversión (S/)': m.monto, 'Monto Etapa 1 (S/)': m.etapa1,
    'Devengado acum. 2025 (S/)': m.devengado2025, 'PIA 2026 (S/)': m.pia2026, 'PIM 2026 (S/)': m.pim2026,
    'Devengado mes anterior (S/)': m.devengadoMes, 'Avance %': m.avanceEjec
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  if (montos.length) { const w2 = XLSX.utils.json_to_sheet(montos); w2['!cols'] = [10, 22, 14, 24, 22, 22, 16, 16, 24, 11].map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, w2, 'Montos'); }
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
    head: [['Semana', 'Proyecto', '%', 'Semáforo', 'Avance semanal', 'Actividades (semana)', 'Riesgo potencial', 'Registrado por']],
    body: rows.map(r => [r.semana + '\n' + weekRange(r.semana), r.proyectoId, r.porcentaje + '%', r.semaforo, trunc(r.avance, 700), trunc(fmtLista(r.actividadesSemana, actividadTxt), 400), trunc(r.riesgo, 400), r.usuario + '\n' + fmtFecha(r.fecha)]),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [87, 82, 78], textColor: 255 },
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
  const sec = t => [{ content: t, colSpan: 2, styles: { fillColor: [87, 82, 78], textColor: 255, fontStyle: 'bold' } }];
  const montoLinea = m => [
    `CUI ${m.cui}:  Monto ${fmtMoney(m.monto)}   |   Etapa 1 ${fmtMoney(m.etapa1)}`,
    (m.devengado2025 || m.pia2026 || m.pim2026 || m.devengadoMes || m.avanceEjec) ?
      `   Devengado 2025 ${fmtMoney(m.devengado2025)}  |  PIA 2026 ${fmtMoney(m.pia2026)}  |  PIM 2026 ${fmtMoney(m.pim2026)}  |  Devengado mes anterior ${fmtMoney(m.devengadoMes)}  |  Avance ${m.avanceEjec || 0}%` : null
  ].filter(Boolean).join('\n');
  const montosTxt = (r.montos || []).map(montoLinea).concat(
    r.montos && r.montos.length ? [`TOTAL:  ${fmtMoney(r.montos.reduce((a, m) => a + m.monto, 0))}   |   Etapa 1 ${fmtMoney(r.montos.reduce((a, m) => a + m.etapa1, 0))}`] : []).join('\n');
  const body = [
    sec('1. DATOS GENERALES DEL PROYECTO O PROGRAMA'),
    ['Nombre del proyecto', r.programa], ['CUI / Cód. SNIP', r.cui], ['Estado del proyecto', r.estadoProyecto || '-'],
    ['Fechas de inicio y fin', fmtDia(r.fechaInicio) + ' al ' + fmtDia(r.fechaFin)], ['Ubicación', ubicacionTxt(r) || '-'],
    ['Proyecto(s) estructurantes y de prioridad', r.estructurantes], ['Monto de inversión actualizado', montosTxt || '-'],
    sec('2. ESTADO SITUACIONAL DEL PROYECTO'), ['Estado situacional', r.estado || '-'],
    ['Avance semanal', `${r.avance}\n\nAvance: ${r.porcentaje}%   |   Semáforo: ${r.semaforo}`],
    ['Evidencia', linksOf(r.evidencia).join('\n') || '-'], ['Riesgo potencial', r.riesgo || '-'], ['Medidas de mitigación', r.medidas || '-']
  ];
  doc.autoTable({ startY: 84, body, theme: 'grid', margin: { left: 40, right: 40, bottom: 34 }, styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'top', lineColor: [190, 190, 190] },
    columnStyles: { 0: { cellWidth: 125, fontStyle: 'bold', fillColor: [238, 242, 248] } } });
  const tabla3 = (titulo, y, head, filas) => {
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(255).setFillColor(87, 82, 78).rect(40, y, W - 80, 16, 'F');
    doc.text(titulo, 44, y + 11);
    doc.autoTable({ startY: y + 16, head: [head], body: filas.length ? filas : [head.map(() => '-')], theme: 'grid', margin: { left: 40, right: 40, bottom: 34 },
      styles: { fontSize: 7.6, cellPadding: 3, overflow: 'linebreak', valign: 'top', lineColor: [190, 190, 190] }, headStyles: { fillColor: [238, 242, 248], textColor: 20, fontStyle: 'bold' } });
    return doc.lastAutoTable.finalY;
  };
  let y3 = doc.lastAutoTable.finalY + 14;
  if (y3 > 680) { doc.addPage(); y3 = 40; }
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(0).text('3. HITOS PROGRAMADOS', 40, y3); y3 += 10;
  y3 = tabla3('Principales hitos — 4.º semestre 2026', y3, ['N°', 'Hito', 'Responsable', 'Días', 'Inicio', 'Fin', 'Resp. directo', 'Avance %'],
    (r.hitosSemestre || []).map((h, i) => [i + 1, h.hito || '-', h.responsable || '-', h.dias || '-', fmtDia(h.inicio), fmtDia(h.fin), h.respDirecto || '-', (h.avance !== '' && h.avance != null) ? h.avance + '%' : '-'])) + 12;
  y3 = tabla3('Actividades programadas de la semana', y3, ['N°', 'Actividad', 'Responsable', 'Comentario'],
    (r.actividadesSemana || []).map((a, i) => [i + 1, a.actividad || '-', a.responsable || '-', a.comentario || '-'])) + 12;
  y3 = tabla3('Avance semanal (detalle)', y3, ['N°', 'Actividad (semana anterior)', 'Cumplimiento / comentario', 'Responsable', 'Evidencia'],
    (r.avanceDetalle || []).map((v, i) => [i + 1, v.actividad || '-', v.cumplimiento || '-', v.responsable || '-', v.evidencia || '-']));
  doc.setFontSize(8).setTextColor(120);
  doc.text(`Registrado por ${r.usuario} el ${fmtFecha(r.fecha)} - N.º ${r.id}`, 40, doc.lastAutoTable.finalY + 16);
  pieDePagina(doc);
  doc.save(`Ficha_${r.proyectoId}_${r.semana}.pdf`);
}

/* ---------- reporte PPT ---------- */
const COL = { azul: '57524E', rojo: 'DC322D', gris: '52514E', claro: 'EEF2F8', Verde: '0A6B0A', 'Ámbar': '9A6A00', Rojo: 'A12525' };
// Logo institucional (MVCS) incrustado en base64 -- tomado de la plantilla oficial de PPT, uso autorizado por el usuario.
const LOGO_MVCS = 'data:image/png;base64,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';
function fontFor(text, base) { const n = String(text || '').length; return n > 1000 ? base - 4 : n > 700 ? base - 3 : n > 450 ? base - 2 : n > 250 ? base - 1 : base; }
function datosSemana(sem) {
  const regs = ultimosPorSemana(state.registros).filter(r => r.semana === sem);
  const proy = state.catalogo.map(c => c.id);
  return { regs: regs.sort((a, b) => a.proyectoId.localeCompare(b.proyectoId)), pendientes: proy.filter(p => !regs.some(r => r.proyectoId === p)) };
}
async function esperarLibreria(nombre, intentos) {
  for (let i = 0; i < intentos && typeof window[nombre] === 'undefined'; i++) await new Promise(r => setTimeout(r, 300));
  return typeof window[nombre] !== 'undefined';
}
async function generarPpt() {
  const sem = $('#pSemana').value;
  if (!sem) return alert('No hay semanas con registros.');
  const btn = $('#btnPpt'); if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    if (typeof PptxGenJS === 'undefined' && !(await esperarLibreria('PptxGenJS', 10))) {
      throw new Error('La librería para generar PowerPoint (PptxGenJS) no cargó en este navegador. Verifique su conexión a internet, que no haya un bloqueador de anuncios/extensión bloqueando cdnjs.cloudflare.com o cdn.jsdelivr.net, y vuelva a cargar la página (Ctrl/Cmd + Shift + R).');
    }
    await generarPptInterno(sem);
  } catch (err) {
    console.error('Error al generar el PPT:', err);
    alert('No se pudo generar el PPT.\n\nDetalle: ' + (err && err.message ? err.message : err) + '\n\nAbra la consola del navegador (F12) para ver más detalle y envíe ese texto para revisarlo.');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}
async function generarPptInterno(sem) {
  const { regs, pendientes } = datosSemana(sem);
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = 'Reporte general de avances ' + sem;
  const W = 13.33, H = 7.5;
  const bullets = txt => { const li = String(txt || '').split(/\n+/).map(t => t.trim()).filter(Boolean); return li.length ? li.map(t => ({ text: t, options: { bullet: { code: '25CF' }, breakLine: true, indentLevel: 0 } })) : [{ text: '—', options: {} }]; };
  // encabezado blanco con logo institucional + franja roja (idéntico a la plantilla oficial del programa)
  const whiteHeader = s => {
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.82, fill: { color: 'FFFFFF' } });
    if (window.CONFIG.LOGO_URL) s.addImage({ path: window.CONFIG.LOGO_URL, x: 0.32, y: 0.15, w: 2.05, h: 0.57 });
    else s.addImage({ data: LOGO_MVCS, x: 0.32, y: 0.15, w: 2.05, h: 0.57 });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.82, w: W, h: 0.05, fill: { color: COL.rojo } });
  };
  const footer = (s, texto) => s.addText(texto, { x: 0.32, y: H - 0.36, w: W - 3.2, h: 0.3, fontSize: 8.5, color: COL.gris, fontFace: 'Calibri' });
  const cab = (s, titulo, sub, footTxt) => {
    whiteHeader(s);
    s.addText(titulo, { x: 2.55, y: 0.1, w: W - 2.9, h: 0.45, fontSize: 18, bold: true, color: COL.azul, fontFace: 'Calibri', fit: 'shrink' });
    if (sub) s.addText(sub, { x: 2.55, y: 0.5, w: W - 2.9, h: 0.3, fontSize: 10.5, color: COL.gris, fontFace: 'Calibri' });
    footer(s, footTxt || ('UIDUS · Programa Nuestras Ciudades · Semana ' + sem));
  };
  // gráfico de cronograma (gantt) dibujado a partir de los hitos reales del proyecto
  const ganttDraw = (s, x, y, w, h, hitos) => {
    const filas = (hitos || []).slice(0, 6);
    if (!filas.length) { s.addText('Sin hitos programados para el 4.º semestre.', { x, y, w, h, fontSize: 10.5, italic: true, color: COL.gris, valign: 'middle', align: 'center' }); return; }
    const conFechas = filas.filter(hh => hh.inicio && hh.fin);
    let ini = conFechas.length ? new Date(Math.min(...conFechas.map(hh => +new Date(hh.inicio)))) : new Date(new Date().getFullYear(), 0, 1);
    let fin = conFechas.length ? new Date(Math.max(...conFechas.map(hh => +new Date(hh.fin)))) : new Date(new Date().getFullYear(), 11, 31);
    if (+fin <= +ini) fin = new Date(+ini + 30 * 86400000);
    const total = Math.max(1, fin - ini);
    const labelW = w * 0.32, barX = x + labelW, barW = w - labelW;
    const rowH = Math.min(0.42, (h - 0.28) / filas.length);
    const ticks = 4, corto = total < 90 * 86400000;
    for (let i = 0; i <= ticks; i++) {
      const t = new Date(+ini + (total * i / ticks));
      const etq = corto ? `${pad(t.getDate())}/${pad(t.getMonth() + 1)}` : `${pad(t.getMonth() + 1)}/${String(t.getFullYear()).slice(2)}`;
      s.addText(etq, { x: barX + barW * i / ticks - 0.35, y: y, w: 0.7, h: 0.22, fontSize: 7, align: 'center', color: COL.gris });
      s.addShape(pptx.ShapeType.line, { x: barX + barW * i / ticks, y: y + 0.24, w: 0, h: rowH * filas.length, line: { color: 'DDDDDD', width: 0.5 } });
    }
    filas.forEach((hh, i) => {
      const ry = y + 0.26 + i * rowH;
      s.addText(trunc(hh.hito || '—', 50), { x, y: ry, w: labelW - 0.06, h: rowH, fontSize: 7.5, valign: 'middle', color: '222222', fontFace: 'Calibri' });
      if (hh.inicio && hh.fin) {
        const bi = new Date(hh.inicio), bf = new Date(hh.fin);
        const bx = barX + barW * Math.max(0, (bi - ini)) / total;
        const bw = Math.max(0.07, barW * Math.max(0, (bf - bi)) / total);
        const av = Number(hh.avance) || 0;
        const col = av >= 100 ? COL.Verde : av > 0 ? '2E6FCC' : '9AA0A6';
        s.addShape(pptx.ShapeType.rect, { x: bx, y: ry + rowH * 0.16, w: bw, h: rowH * 0.68, fill: { color: col } });
        if (bw > 0.35) s.addText(av + '%', { x: bx, y: ry + rowH * 0.16, w: bw, h: rowH * 0.68, fontSize: 6.5, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle' });
      }
    });
    if ((hitos || []).length > 6) s.addText(`+${hitos.length - 6} hito(s) adicional(es) — ver ficha PDF.`, { x, y: y + h - 0.2, w, h: 0.2, fontSize: 7, italic: true, color: COL.gris });
  };
  // caja con encabezado de color y cuerpo con viñetas (Situación actual, Riesgos, Acciones)
  const box = (s, titulo, contenido, x, y, w, h, bullet) => {
    s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: COL.claro } });
    s.addText(titulo, { x, y, w, h: 0.3, fontSize: 10.5, bold: true, color: 'FFFFFF', fill: { color: COL.azul }, margin: [3, 6, 0, 9] });
    const opts = { x: x + 0.09, y: y + 0.36, w: w - 0.18, h: h - 0.42, fontSize: fontFor(contenido, bullet ? 10.5 : 11), valign: 'top', color: '222222', fontFace: 'Calibri', margin: [2, 4, 2, 4] };
    if (bullet) s.addText(bullets(contenido), opts); else s.addText(trunc(contenido, 1200) || '—', opts);
  };
  // presupuesto: gráfico de barras nativo (editable en PowerPoint) a partir de los montos del proyecto
  const presupuestoBox = (s, x, y, w, h, ms) => {
    s.addText('PRESUPUESTO', { x, y, w, h: 0.3, fontSize: 10.5, bold: true, color: 'FFFFFF', fill: { color: COL.azul }, margin: [3, 6, 0, 9] });
    const dev = (ms || []).reduce((a, m) => a + (m.devengado2025 || 0), 0), pia = (ms || []).reduce((a, m) => a + (m.pia2026 || 0), 0), pim = (ms || []).reduce((a, m) => a + (m.pim2026 || 0), 0);
    if (!dev && !pia && !pim) { s.addShape(pptx.ShapeType.rect, { x, y: y + 0.3, w, h: h - 0.3, fill: { color: COL.claro } }); s.addText('Sin montos registrados.', { x: x + 0.1, y: y + 0.36, w: w - 0.2, h: h - 0.42, fontSize: 10, italic: true, color: COL.gris }); return; }
    s.addChart(pptx.ChartType.bar, [{ name: 'Presupuesto (S/)', labels: ['Devengado 2025', 'PIA 2026', 'PIM 2026'], values: [dev, pia, pim] }],
      { x, y: y + 0.34, w, h: h - 0.36, barDir: 'bar', chartColors: [COL.Verde, COL.Rojo, COL['Ámbar']], showValue: true, dataLabelFontSize: 7.5, dataLabelColor: '333333', dataLabelFormatCode: '0.0,,"M"', catAxisLabelFontSize: 8, valAxisHidden: true, showLegend: false, showTitle: false, barGapWidthPct: 35, valGridLine: { style: 'none' } });
  };
  const ubicacionBox = (s, x, y, w, h, r) => {
    s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: COL.claro } });
    s.addText('UBICACIÓN', { x, y, w, h: 0.3, fontSize: 10.5, bold: true, color: 'FFFFFF', fill: { color: COL.azul }, margin: [3, 6, 0, 9] });
    const lugar = [r.distrito, r.provincia, r.departamento].filter(Boolean).join(', ') || 'No especificada';
    const coords = (r.lat !== undefined && r.lat !== '' && r.lat !== null) ? `Coordenadas: ${r.lat}, ${r.lng}` : '';
    s.addText([{ text: lugar, options: { bold: true, breakLine: true, fontSize: 12 } }, { text: coords, options: { fontSize: 9, color: COL.gris } }], { x: x + 0.09, y: y + 0.36, w: w - 0.18, h: h - 0.42, valign: 'top', fontFace: 'Calibri', color: '222222' });
  };
  // Portada
  let s = pptx.addSlide(); s.background = { color: COL.rojo };
  whiteHeader(s);
  s.addText('REPORTE GENERAL DE AVANCES DE PROYECTOS', { x: 0.7, y: 2.3, w: W - 1.4, h: 1.1, fontSize: 34, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
  s.addShape(pptx.ShapeType.line, { x: 0.72, y: 3.35, w: 5.0, h: 0, line: { color: 'FFFFFF', width: 1 } });
  s.addText(`Semana ${sem} (${weekRange(sem)})`, { x: 0.7, y: 3.5, w: W - 1.4, h: 0.6, fontSize: 20, color: 'EDEAE4' });
  s.addText(window.CONFIG.ENTIDAD || 'Unidad de Inversiones en Desarrollo Urbano Sostenible - Programa Nuestras Ciudades', { x: 0.7, y: 4.25, w: W - 1.4, h: 0.5, fontSize: 14, color: 'EDEAE4' });
  s.addText(`${regs.length} de ${state.catalogo.length} proyecto(s) con reporte esta semana`, { x: 0.7, y: 6.7, w: W - 1.4, h: 0.4, fontSize: 12, color: 'FFFFFF' });
  // Resumen
  const chunk = 8;
  for (let i = 0; i < Math.max(regs.length, 1); i += chunk) {
    s = pptx.addSlide(); cab(s, 'Resumen de avance por proyecto', `${regs.length} de ${state.catalogo.length} proyectos con reporte${regs.length > chunk ? ' (continuación ' + (i / chunk + 1) + ')' : ''}`);
    const head = ['Proyecto', '% avance', 'Semáforo', 'Avance semanal'].map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: COL.azul }, fontSize: 12 } }));
    const rows = regs.slice(i, i + chunk).map(r => [
      { text: r.proyectoId, options: { bold: true, fontSize: 11 } }, { text: r.porcentaje + '%', options: { align: 'center', fontSize: 12, bold: true } },
      { text: `${semaforoIcon(r.semaforo)} ${r.semaforo}`, options: { bold: true, color: COL[r.semaforo] || COL.gris, fontSize: 11 } }, { text: trunc(r.avance, 230), options: { fontSize: 10 } }]);
    s.addTable([head].concat(rows.length ? rows : [[{ text: 'Sin reportes esta semana', options: { colspan: 4 } }]]), { x: 0.4, y: 1.05, w: W - 0.8, colW: [3, 1.2, 1.6, W - 0.8 - 5.8], border: { type: 'solid', color: 'CCCCCC', pt: 0.5 }, valign: 'top', fontFace: 'Calibri' });
  }
  // Por proyecto: diapositiva A (formato oficial: cronograma/hitos, situación, riesgos, acciones, presupuesto, ubicación) + diapositiva B (detalle semanal)
  regs.forEach(r => {
    const ms = r.montos || [];
    const totInv = ms.reduce((a, m) => a + (m.monto || 0), 0), totEtapa = ms.reduce((a, m) => a + (m.etapa1 || 0), 0);
    // -- Diapositiva A --
    let sl = pptx.addSlide();
    whiteHeader(sl);
    sl.addText(r.proyectoId, { x: 0.32, y: 0.92, w: 8.6, h: 0.4, fontSize: 17, bold: true, color: COL.azul, fontFace: 'Calibri', fit: 'shrink' });
    sl.addText(trunc(r.programa, 130), { x: 0.32, y: 1.28, w: 8.6, h: 0.28, fontSize: 10.5, color: COL.gris, fontFace: 'Calibri' });
    if (r.estructurantes) sl.addText(trunc(r.estructurantes.replace(/\n+/g, '   ·   '), 170), { x: 0.32, y: 1.53, w: 8.6, h: 0.26, fontSize: 8.5, color: COL.gris, fontFace: 'Calibri' });
    else if (r.cui) sl.addText(`CUI ${r.cui}`, { x: 0.32, y: 1.53, w: 8.6, h: 0.26, fontSize: 8.5, color: COL.gris, fontFace: 'Calibri' });
    sl.addText([
      { text: 'Inversión total: ', options: { color: COL.gris } }, { text: fmtMoney(totInv) + '   ', options: { bold: true, color: COL.rojo } },
      { text: 'Etapa 1: ', options: { color: COL.gris } }, { text: fmtMoney(totEtapa), options: { bold: true, color: COL.rojo } }
    ], { x: 0.32, y: 1.78, w: 8.6, h: 0.24, fontSize: 9.5, fontFace: 'Calibri' });
    sl.addText(String(r.porcentaje) + '%', { x: 10.9, y: 0.92, w: 2.1, h: 0.5, fontSize: 26, bold: true, align: 'right', color: COL[r.semaforo] || COL.gris });
    sl.addText(`${semaforoIcon(r.semaforo)} ${r.semaforo}`, { x: 10.9, y: 1.4, w: 2.1, h: 0.28, fontSize: 11, bold: true, align: 'right', color: COL[r.semaforo] || COL.gris });
    sl.addShape(pptx.ShapeType.line, { x: 0.32, y: 2.05, w: W - 0.64, h: 0, line: { color: COL.rojo, width: 1 } });
    // columna izquierda: cronograma / hitos
    sl.addText('CRONOGRAMA 2026 E HITOS PRINCIPALES', { x: 0.32, y: 2.14, w: 7.85, h: 0.3, fontSize: 10.5, bold: true, color: 'FFFFFF', fill: { color: COL.azul }, margin: [3, 6, 0, 9] });
    sl.addShape(pptx.ShapeType.rect, { x: 0.32, y: 2.46, w: 7.85, h: 2.58, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', width: 0.75 } });
    ganttDraw(sl, 0.42, 2.56, 7.65, 2.38, r.hitosSemestre);
    box(sl, 'RIESGOS', r.riesgo, 0.32, 5.14, 3.85, 1.9, true);
    box(sl, 'ACCIONES A SEGUIR Y/O MITIGACIÓN', r.medidas, 4.27, 5.14, 3.9, 1.9, true);
    // columna derecha: situación, presupuesto, ubicación
    box(sl, 'SITUACIÓN ACTUAL', r.estado, 8.27, 2.14, 4.74, 1.85, true);
    presupuestoBox(sl, 8.27, 4.09, 4.74, 1.55, ms);
    ubicacionBox(sl, 8.27, 5.74, 4.74, 1.3, r);
    footer(sl, `UIDUS · Programa Nuestras Ciudades · Semana ${sem} · Registrado por ${r.usuario} el ${fmtFecha(r.fecha)}`);
    // -- Diapositiva B: detalle semanal --
    sl = pptx.addSlide(); cab(sl, r.proyectoId + ' — Detalle semanal', trunc(r.programa, 140), `Estado: ${r.estadoProyecto || '—'} · Ubicación: ${ubicacionTxt(r) || '—'} · Evidencias: ${linksOf(r.evidencia).length}`);
    box(sl, 'AVANCE DE LA SEMANA', r.avance, 0.4, 1.05, W - 0.8, 1.15, false);
    const tabla = (titulo, y, head, filas, colW) => {
      sl.addText(titulo, { x: 0.4, y, w: W - 0.8, h: 0.28, fontSize: 11, bold: true, color: COL.azul, fontFace: 'Calibri' });
      const hd = head.map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: COL.azul }, fontSize: 9.5 } }));
      const body = filas.length ? filas : [[{ text: 'Sin datos registrados esta semana', options: { colspan: head.length, italic: true, color: COL.gris } }]];
      sl.addTable([hd].concat(body), { x: 0.4, y: y + 0.3, w: W - 0.8, colW, border: { type: 'solid', color: 'CCCCCC', pt: 0.5 }, valign: 'top', fontFace: 'Calibri', fontSize: 9 });
    };
    const actFilas = (r.actividadesSemana || []).slice(0, 8).map((a, i) => [
      { text: String(i + 1), options: { align: 'center' } }, { text: trunc(a.actividad, 90) }, { text: trunc(a.responsable, 40) }, { text: trunc(a.comentario, 90) }]);
    tabla('Actividades programadas (semana)', 2.35, ['N°', 'Actividad', 'Responsable', 'Comentario'], actFilas, [0.5, 4.6, 2.3, 4.53]);
    const avFilas = (r.avanceDetalle || []).slice(0, 8).map((v, i) => [
      { text: String(i + 1), options: { align: 'center' } }, { text: trunc(v.actividad, 80) }, { text: trunc(v.cumplimiento, 60) }, { text: trunc(v.responsable, 35) }, { text: linksOf(v.evidencia).length ? linksOf(v.evidencia).length + ' archivo(s)' : '—' }]);
    tabla('Avance semanal (detalle) — semana anterior', 4.75, ['N°', 'Actividad', 'Cumplimiento', 'Responsable', 'Evidencia'], avFilas, [0.45, 4.0, 3.3, 2.28, 1.9]);
  });
  // Pendientes
  if (pendientes.length) {
    s = pptx.addSlide(); cab(s, 'Proyectos sin reporte en la semana', `${pendientes.length} pendiente(s)`);
    s.addText(pendientes.map(p => ({ text: p, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.2, w: W - 1.2, h: 5.6, fontSize: 18, color: '222222', valign: 'top' });
  }
  // Cierre
  s = pptx.addSlide(); s.background = { color: COL.rojo }; whiteHeader(s);
  s.addText('Gracias.', { x: 0.7, y: 3.0, w: W - 1.4, h: 1.0, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
  s.addText(window.CONFIG.ENTIDAD || 'Programa Nuestras Ciudades', { x: 0.7, y: 4.1, w: W - 1.4, h: 0.4, fontSize: 13, color: 'EDEAE4' });
  s.addText(`Reporte generado el ${fmtFecha(new Date().toISOString())}`, { x: 0.7, y: 6.9, w: W - 1.4, h: 0.35, fontSize: 10, color: 'EDEAE4' });
  await pptx.writeFile({ fileName: `Reporte_General_Avances_${sem}.pptx` });
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
    db.registros.push({ id: Math.random().toString(16).slice(2, 10).toUpperCase(), fecha: f + 'T09:00:00', semana: isoWeek(f), proyectoId: c.id, usuario: 'Ejemplo', estadoProyecto: 'En Ejecución', departamento: 'Loreto', provincia: 'Maynas', distrito: 'Belen', programa: c.programa, cui: c.cui, estructurantes: c.estructurantes, montos: c.montos,
      estado: 'Texto de ejemplo del estado situacional.',
      hitosSemestre: [{ hito: 'Hito de ejemplo 1', responsable: 'Equipo técnico', dias: 30, inicio: f, fin: f, respDirecto: 'Coordinador', avance: Math.min(100, pct) }],
      actividadesSemana: [{ actividad: 'Coordinación con entidades', responsable: 'Equipo técnico', comentario: 'Ejemplo' }],
      avanceDetalle: [{ actividad: 'Aprobación del 1er entregable', cumplimiento: 'Cumplido', responsable: 'Equipo técnico', evidencia: '' }],
      avance: 'Avance de ejemplo de la semana ' + (4 - w) + '.', porcentaje: pct,
      semaforo: (w + i) % 5 === 0 ? 'Rojo' : (w + i) % 3 === 0 ? 'Ámbar' : 'Verde', evidencia: '', riesgo: 'Riesgo de ejemplo.', medidas: 'Medida de ejemplo.' });
  });
  Demo.persist();
}

/* ---------- eventos ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  if (window.CONFIG.LOGO_URL) $$('#logoImg, #logoLogin').forEach(i => { i.src = window.CONFIG.LOGO_URL; i.classList.remove('hidden'); });
  if (DEMO) { $('#demoBanner').classList.remove('hidden'); $('#demoHint').textContent = 'Demostración: usuario admin / contraseña admin (administrador), o belen / belen (usuario).'; }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('#loginBtn');
    b.disabled = true; b.classList.add('loading'); setMsg($('#loginMsg'), '', '');
    $('#userInput').disabled = true; $('#passInput').disabled = true;
    const ok = await entrar($('#userInput').value, $('#passInput').value);
    b.disabled = false; b.classList.remove('loading');
    $('#userInput').disabled = false; $('#passInput').disabled = false;
    if (!ok) $('#passInput').focus();
  });
  $('#togglePass').onclick = () => { const i = $('#passInput'), ver = i.type === 'password'; i.type = ver ? 'text' : 'password'; $('#togglePass').textContent = ver ? 'Ocultar' : 'Ver'; };
  $('#logoutBtn').onclick = () => { store.del('usuario'); store.del('token'); location.reload(); };
  ['#pjSemana', '#pjEstado'].forEach(x => $(x).addEventListener('change', renderProyectos));
  $('#pjBuscar').addEventListener('input', renderProyectos);
  $('#projGrid').addEventListener('click', e => {
    const b = e.target.closest('button[data-pact]'); if (!b) return;
    if (b.dataset.pact === 'hist') { $('#lProyecto').value = b.dataset.pid; $('#lSemana').value = ''; $('#lBuscar').value = ''; activarTab('list'); return; }
    const r = state.registros.find(x => String(x.id) === b.dataset.id); if (!r) return;
    b.dataset.pact === 'ver' ? verRegistro(r) : fichaPdf(r);
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) activarTab(b.dataset.tab); });
  $('#fProyecto').addEventListener('change', precargarProyecto);
  $('#fFecha').addEventListener('change', () => { actualizarSemana(); marcar($('#fFecha'), $('#fFecha').value ? '' : 'Indique la fecha de corte del reporte.'); });
  Object.values(REGLAS).flat().forEach(([sel, msg]) => { const el = $(sel); ['blur', 'change'].forEach(ev => el.addEventListener(ev, () => validarCampo(sel, msg))); if (el.tagName !== 'SELECT') el.addEventListener('input', () => { if (el.closest('.field').classList.contains('invalid')) validarCampo(sel, msg); }); });
  ['#fInicio', '#fFin'].forEach(s => $(s).addEventListener('change', () => { const i = $('#fInicio').value, f = $('#fFin').value; marcar($('#fFin'), i && f && f < i ? 'La fecha de fin no puede ser anterior a la de inicio.' : ''); }));
  $('#fDep').addEventListener('change', () => { llenarProvincias(); limpiarPunto(); centrarPorSeleccion(); });
  $('#fProv').addEventListener('change', () => { llenarDistritos(); limpiarPunto(); centrarPorSeleccion(); });
  $('#fDist').addEventListener('change', () => { const d = distSel(); if (d) fijarPunto(d[1], d[2], true); });
  $('#btnClearPoint').onclick = limpiarPunto;
  $('#addMonto').onclick = () => $('#montosBody').appendChild(montoRow());
  $('#addHito').onclick = () => { $('#hitosBody').appendChild(hitoRow()); renumerar($('#hitosBody')); };
  $('#addActividad').onclick = () => { $('#actividadesBody').appendChild(actividadRow()); renumerar($('#actividadesBody')); };
  $('#addAvanceItem').onclick = () => { $('#avanceDetalleBody').appendChild(avanceRow()); renumerar($('#avanceDetalleBody')); };
  $('#fPct').addEventListener('input', e => { $('#fPctOut').textContent = e.target.value + '%'; });
  $('#btnNext').onclick = () => irAPaso(form.paso + 1);
  $('#btnPrev').onclick = () => mostrarPaso(form.paso - 1, true);
  $('#stepper').addEventListener('click', e => { const li = e.target.closest('li[data-step]'); if (li) irAPaso(Number(li.dataset.step)); });
  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#fArchivos').click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fArchivos').click(); } });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => agregarArchivos(e.dataTransfer.files));
  $('#fArchivos').addEventListener('change', e => { agregarArchivos(e.target.files); e.target.value = ''; });
  $('#fileList').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) { form.archivos.splice(Number(b.dataset.rm), 1); pintarArchivos(); } });
  $('#regForm').addEventListener('submit', enviarFormulario);
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
  const gu = store.get('usuario'), gt = store.get('token');
  if (gu && gt) { state.token = gt; entrar(gu, null, true); }
});
