/**
 * Backend del formulario "Reporte semanal de carga horaria – Docentes Tiempo Completo".
 *
 * Apps Script vinculado a la hoja "Formulario Carga Horaria DTC". Se publica como aplicación web
 * (Implementar → Nueva implementación → Aplicación web; Ejecutar como: yo; Acceso: cualquier usuario).
 * La seguridad no depende de esa URL: cada pedido trae el token de "Iniciar sesión con Google" y aquí
 * se verifica (destinatario = nuestro ID de cliente, dominio unifranz.edu.bo, correo verificado).
 *
 * Acciones (POST, cuerpo JSON enviado como text/plain para evitar el preflight CORS):
 *   { accion: "contexto", idToken }                      → datos del docente, semanas abiertas, su plan y listas
 *   { accion: "enviar",   idToken, semana_viernes, ... } → valida, reemplaza el reporte previo y guarda filas
 *
 * Pestañas que usa: Docentes, Actividades, Semanas, Plan, Motivos, Config, Respuestas.
 * Fechas de semana en texto ISO (AAAA-MM-DD); si la hoja las convierte a fecha, también se aceptan.
 */

// ID de cliente OAuth (tipo "Aplicación web") del proyecto de Google Cloud. Debe ser el mismo que en docs/config.js.
const CLIENT_ID = '215407706779-gdudhegrro3rgeevp7jufvr8gjnamgl8.apps.googleusercontent.com';
const DOMINIO = 'unifranz.edu.bo';
const VERSION_FORMULARIO = 'v2';
const ZONA = 'America/La_Paz';

const MAX_EXTRA_ACTIVIDAD = 20;   // horas extra máximas por actividad y semana
const MAX_EXTRA_SEMANA = 30;      // horas extra máximas por semana
const PASO_HORAS = 0.5;
const MAX_COMENTARIO = 1000;

const COLUMNAS_RESPUESTAS = [
  'codigo', 'estado', 'fecha_envio', 'inicio', 'duracion_seg', 'email', 'ci', 'docente', 'sede', 'carreras',
  'semestre', 'semana_lunes', 'semana_viernes', 'semana_etiqueta', 'tipo', 'actividad', 'actividad_nombre',
  'horas', 'horas_planificadas', 'motivo', 'detalle_motivo', 'comentario', 'dispositivo', 'version_formulario',
];
const COLUMNAS_NUMERICAS = ['duracion_seg', 'horas', 'horas_planificadas'];

// ---------------------------------------------------------------------------------------------- entrada
function doGet() {
  return json_({ ok: true, servicio: 'Formulario carga horaria DTC', version: VERSION_FORMULARIO });
}

function doPost(e) {
  try {
    const pedido = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const email = verificarToken_(pedido.idToken);
    const docente = buscarDocente_(email);
    if (!docente) {
      throw errorUsuario_('NO_REGISTRADO',
        `La cuenta ${email} no está registrada como docente de tiempo completo. ` +
        'Prueba con tu otra cuenta institucional o escribe a ' + config_().correo_soporte + '.');
    }
    if (pedido.accion === 'contexto') return json_(contexto_(docente));
    if (pedido.accion === 'enviar') return json_(enviar_(docente, email, pedido));
    throw errorUsuario_('ACCION', 'Acción no reconocida.');
  } catch (err) {
    if (err && err.esUsuario) return json_({ ok: false, codigo_error: err.codigo, error: err.message });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, codigo_error: 'INTERNO', error: 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.' });
  }
}

// ---------------------------------------------------------------------------------------------- seguridad
function verificarToken_(idToken) {
  if (!idToken) throw errorUsuario_('SIN_SESION', 'Inicia sesión con tu cuenta institucional.');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw errorUsuario_('SESION', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  const t = JSON.parse(r.getContentText());
  const email = String(t.email || '').toLowerCase().trim();
  const valido = t.aud === CLIENT_ID && String(t.email_verified) === 'true' &&
    Number(t.exp) * 1000 > Date.now() && (t.hd === DOMINIO || email.endsWith('@' + DOMINIO));
  if (!valido) throw errorUsuario_('DOMINIO', 'Usa tu cuenta institucional @' + DOMINIO + '.');
  return email;
}

// ---------------------------------------------------------------------------------------------- lectura de pestañas
function hoja_(nombre) {
  const h = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!h) throw new Error('Falta la pestaña ' + nombre);
  return h;
}

/** Filas de una pestaña como objetos {encabezado: valor}. Con caché corta para no leer en cada pedido. */
function tabla_(nombre, segundosCache) {
  const cache = CacheService.getScriptCache();
  const clave = 'tabla_' + nombre;
  if (segundosCache) {
    const guardado = cache.get(clave);
    if (guardado) return JSON.parse(guardado);
  }
  const valores = hoja_(nombre).getDataRange().getValues();
  const enc = valores.shift().map(h => String(h).trim());
  const filas = valores.filter(f => f.some(c => c !== '')).map(f => {
    const o = {};
    enc.forEach((h, i) => { o[h] = f[i] instanceof Date ? fechaIso_(f[i]) : f[i]; });
    return o;
  });
  if (segundosCache) {
    const texto = JSON.stringify(filas);
    if (texto.length < 95000) cache.put(clave, texto, segundosCache);
  }
  return filas;
}

function config_() {
  const c = {};
  tabla_('Config', 300).forEach(f => { c[String(f.clave).trim()] = f.valor; });
  return {
    semestre_actual: String(c.semestre_actual || ''),
    semanas_abiertas: Number(c.semanas_abiertas || 3),
    correo_soporte: String(c.correo_soporte || ''),
    enviar_comprobante: String(c.enviar_comprobante).toUpperCase() !== 'FALSE',
    mensaje_inicio: String(c.mensaje_inicio || ''),
  };
}

function buscarDocente_(email) {
  const fila = tabla_('Docentes', 300).find(d =>
    String(d.activo).toUpperCase() !== 'FALSE' &&
    String(d.correos || '').toLowerCase().split(/[;,\s]+/).map(s => s.trim()).filter(Boolean).includes(email));
  return fila ? { ci: String(fila.ci).trim(), nombre: String(fila.nombre).trim(), sede: String(fila.sede || ''),
                  carreras: String(fila.carreras || '') } : null;
}

function actividadesActivas_() {
  return tabla_('Actividades', 300)
    .filter(a => String(a.activa).toUpperCase() !== 'FALSE')
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
    .map(a => ({ codigo: String(a.codigo), nombre: String(a.nombre || a.codigo), grupo: String(a.grupo || '') }));
}

function motivos_() {
  return tabla_('Motivos', 300).map(m => ({
    motivo: String(m.motivo), requiere_detalle: String(m.requiere_detalle).toUpperCase() === 'TRUE' }));
}

/** Semanas del semestre actual ya iniciadas; las N más recientes quedan abiertas para reportar. */
function semanasAbiertas_() {
  const cfg = config_();
  const hoy = fechaIso_(new Date());
  return tabla_('Semanas', 300)
    .filter(s => String(s.semestre) === cfg.semestre_actual && String(s.lunes) <= hoy)
    .sort((a, b) => String(b.lunes).localeCompare(String(a.lunes)))
    .slice(0, cfg.semanas_abiertas)
    .map(s => ({ semestre: String(s.semestre), nro: Number(s.nro), lunes: String(s.lunes), viernes: String(s.viernes),
                 etiqueta: String(s.etiqueta), hito: String(s.hito || '') }));
}

/** Plan del docente por semana: { 'AAAA-MM-DD': [{actividad, nombre, horas}] } (solo semanas pedidas). */
function planDocente_(ci, viernesLista) {
  const nombres = {};
  actividadesActivas_().forEach(a => { nombres[a.codigo] = a.nombre; });
  const plan = {};
  viernesLista.forEach(v => { plan[v] = []; });
  const valores = hoja_('Plan').getDataRange().getValues();
  const enc = valores.shift().map(String);
  const iCi = enc.indexOf('ci'), iV = enc.indexOf('semana_viernes'), iA = enc.indexOf('actividad'), iH = enc.indexOf('horas_planificadas');
  valores.forEach(f => {
    if (String(f[iCi]).trim() !== ci) return;
    const v = f[iV] instanceof Date ? fechaIso_(f[iV]) : String(f[iV]).trim();
    if (!(v in plan)) return;
    const horas = Number(String(f[iH]).replace(',', '.'));
    if (horas > 0) plan[v].push({ actividad: String(f[iA]), nombre: nombres[f[iA]] || String(f[iA]), horas: redondear_(horas) });
  });
  Object.keys(plan).forEach(v => plan[v].sort((a, b) => b.horas - a.horas));
  return plan;
}

/** Último reporte vigente del docente por semana: { 'AAAA-MM-DD': {codigo, fecha_envio} }. */
function reportesVigentes_(ci) {
  const h = hoja_('Respuestas');
  const n = h.getLastRow();
  const out = {};
  if (n < 2) return out;
  const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  const valores = h.getRange(2, 1, n - 1, enc.length).getValues();
  const i = nombre => enc.indexOf(nombre);
  valores.forEach(f => {
    if (String(f[i('ci')]).trim() !== ci || f[i('estado')] !== 'vigente') return;
    const v = f[i('semana_viernes')] instanceof Date ? fechaIso_(f[i('semana_viernes')]) : String(f[i('semana_viernes')]);
    out[v] = { codigo: String(f[i('codigo')]), fecha_envio: String(f[i('fecha_envio')]) };
  });
  return out;
}

// ---------------------------------------------------------------------------------------------- acciones
function contexto_(docente) {
  const cfg = config_();
  const semanas = semanasAbiertas_();
  const plan = planDocente_(docente.ci, semanas.map(s => s.viernes));
  const previos = reportesVigentes_(docente.ci);
  return {
    ok: true,
    docente: { nombre: docente.nombre, sede: docente.sede, carreras: docente.carreras },
    semanas: semanas.map(s => Object.assign({}, s, { plan: plan[s.viernes] || [], reportada: previos[s.viernes] || null })),
    actividades: actividadesActivas_(),
    motivos: motivos_(),
    limites: { paso: PASO_HORAS, extra_actividad: MAX_EXTRA_ACTIVIDAD, extra_semana: MAX_EXTRA_SEMANA, comentario: MAX_COMENTARIO },
    soporte: cfg.correo_soporte,
    mensaje: cfg.mensaje_inicio,
  };
}

function enviar_(docente, email, p) {
  const semana = semanasAbiertas_().find(s => s.viernes === String(p.semana_viernes));
  if (!semana) throw errorUsuario_('SEMANA', 'Esa semana ya no está abierta para reportar. Elige otra.');
  const plan = planDocente_(docente.ci, [semana.viernes])[semana.viernes];
  const planPorActividad = {};
  plan.forEach(x => { planPorActividad[x.actividad] = x; });
  const activas = {};
  actividadesActivas_().forEach(a => { activas[a.codigo] = a; });
  const motivos = {};
  motivos_().forEach(m => { motivos[m.motivo] = m; });

  const sinNovedades = p.tipo === 'sin_novedades';
  const incumplimientos = sinNovedades ? [] : (p.incumplimientos || []);
  const extras = sinNovedades ? [] : (p.extras || []);
  if (!sinNovedades && !incumplimientos.length && !extras.length) {
    throw errorUsuario_('VACIO', 'Marca al menos una actividad no cumplida u horas extra, o elige «Sin novedades».');
  }
  const vistos = {};
  incumplimientos.forEach(x => {
    const pl = planPorActividad[x.actividad];
    if (!pl) throw errorUsuario_('ACTIVIDAD', 'Una de las actividades no está en tu horario de esa semana.');
    if (vistos['i' + x.actividad]) throw errorUsuario_('DUPLICADO', 'Hay una actividad repetida.');
    vistos['i' + x.actividad] = true;
    validarHoras_(x.horas, pl.horas, `Las horas no cumplidas de «${pl.nombre}» deben estar entre ${PASO_HORAS} y ${pl.horas}.`);
    const m = motivos[x.motivo];
    if (!m) throw errorUsuario_('MOTIVO', `Elige un motivo para «${pl.nombre}».`);
    if (m.requiere_detalle && !String(x.detalle || '').trim()) throw errorUsuario_('DETALLE', `Describe brevemente el motivo de «${pl.nombre}».`);
  });
  let totalExtra = 0;
  extras.forEach(x => {
    const a = activas[x.actividad];
    if (!a) throw errorUsuario_('ACTIVIDAD', 'Una de las actividades con horas extra no es válida.');
    if (vistos['e' + x.actividad]) throw errorUsuario_('DUPLICADO', 'Hay una actividad repetida en horas extra.');
    vistos['e' + x.actividad] = true;
    validarHoras_(x.horas, MAX_EXTRA_ACTIVIDAD, `Las horas extra de «${a.nombre}» deben estar entre ${PASO_HORAS} y ${MAX_EXTRA_ACTIVIDAD}.`);
    totalExtra += Number(x.horas);
  });
  if (totalExtra > MAX_EXTRA_SEMANA) throw errorUsuario_('EXTRA', `El total de horas extra no puede superar ${MAX_EXTRA_SEMANA} h por semana.`);
  const comentario = String(p.comentario || '').trim().slice(0, MAX_COMENTARIO);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const h = hoja_('Respuestas');
    const reemplazo = marcarReemplazadas_(h, docente.ci, semana.viernes);
    const codigo = nuevoCodigo_(h, semana.semestre);
    const ahora = new Date();
    const inicio = p.inicio ? new Date(p.inicio) : null;
    const duracion = inicio && !isNaN(inicio) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : '';
    const base = {
      codigo, estado: 'vigente', fecha_envio: fechaHora_(ahora), inicio: inicio && !isNaN(inicio) ? fechaHora_(inicio) : '',
      duracion_seg: duracion, email, ci: docente.ci, docente: docente.nombre, sede: docente.sede, carreras: docente.carreras,
      semestre: semana.semestre, semana_lunes: semana.lunes, semana_viernes: semana.viernes, semana_etiqueta: semana.etiqueta,
      comentario, dispositivo: String(p.dispositivo || '').slice(0, 20), version_formulario: VERSION_FORMULARIO,
    };
    const filas = [];
    if (sinNovedades) filas.push(Object.assign({}, base, { tipo: 'Sin novedades' }));
    incumplimientos.forEach(x => {
      const pl = planPorActividad[x.actividad];
      filas.push(Object.assign({}, base, { tipo: 'Incumplimiento', actividad: x.actividad, actividad_nombre: pl.nombre,
        horas: Number(x.horas), horas_planificadas: pl.horas, motivo: x.motivo, detalle_motivo: String(x.detalle || '').trim().slice(0, 300) }));
    });
    extras.forEach(x => {
      const pl = planPorActividad[x.actividad];
      filas.push(Object.assign({}, base, { tipo: 'Hora extra', actividad: x.actividad, actividad_nombre: activas[x.actividad].nombre,
        horas: Number(x.horas), horas_planificadas: pl ? pl.horas : 0 }));
    });
    const matriz = filas.map(f => COLUMNAS_RESPUESTAS.map(c => textoSeguro_(f[c] === undefined ? '' : f[c])));
    const fila0 = h.getLastRow() + 1;
    // Texto plano en todo salvo duracion_seg, horas y horas_planificadas: así "2026-10-30" o un CI no se convierten
    COLUMNAS_RESPUESTAS.forEach((c, k) => {
      if (!COLUMNAS_NUMERICAS.includes(c)) h.getRange(fila0, k + 1, matriz.length, 1).setNumberFormat('@');
    });
    h.getRange(fila0, 1, matriz.length, COLUMNAS_RESPUESTAS.length).setValues(matriz);
    SpreadsheetApp.flush();

    const resumen = {
      semana: semana.etiqueta, sin_novedades: sinNovedades,
      incumplimientos: incumplimientos.map(x => ({ nombre: planPorActividad[x.actividad].nombre, horas: Number(x.horas), motivo: x.motivo })),
      extras: extras.map(x => ({ nombre: activas[x.actividad].nombre, horas: Number(x.horas) })),
    };
    const comprobante = config_().enviar_comprobante;
    if (comprobante) enviarComprobante_(email, docente, codigo, resumen, reemplazo);
    return { ok: true, codigo, reemplazo, resumen, comprobante, email };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------------------------- utilidades
function validarHoras_(valor, maximo, mensaje) {
  const h = Number(valor);
  const enPaso = Math.abs(h / PASO_HORAS - Math.round(h / PASO_HORAS)) < 1e-9;
  if (!(h >= PASO_HORAS && h <= maximo && enPaso)) throw errorUsuario_('HORAS', mensaje);
}

/** Pasa a "reemplazada" el reporte vigente anterior del mismo docente y semana. Devuelve el código anterior o "". */
function marcarReemplazadas_(h, ci, viernes) {
  const n = h.getLastRow();
  if (n < 2) return '';
  const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  const iCi = enc.indexOf('ci'), iV = enc.indexOf('semana_viernes'), iE = enc.indexOf('estado'), iC = enc.indexOf('codigo');
  const valores = h.getRange(2, 1, n - 1, enc.length).getValues();
  let anterior = '';
  valores.forEach((f, k) => {
    const v = f[iV] instanceof Date ? fechaIso_(f[iV]) : String(f[iV]);
    if (String(f[iCi]).trim() === ci && v === viernes && f[iE] === 'vigente') {
      h.getRange(k + 2, iE + 1).setValue('reemplazada');
      anterior = String(f[iC]);
    }
  });
  return anterior;
}

/** Código corto, legible y único, con el semestre: DTC-II26-7K3F. */
function nuevoCodigo_(h, semestre) {
  const alfabeto = 'ACDEFGHJKMNPQRTUVWXY3479';
  const prefijo = 'DTC-' + String(semestre).replace('-', '') + '-';
  const existentes = new Set(h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().map(f => String(f[0])) : []);
  for (let intento = 0; intento < 50; intento++) {
    let c = prefijo;
    for (let i = 0; i < 4; i++) c += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    if (!existentes.has(c)) return c;
  }
  throw new Error('No se pudo generar un código único');
}

function enviarComprobante_(email, docente, codigo, r, reemplazo) {
  const fila = (t, h) => `<tr><td style="padding:4px 12px 4px 0">${esc_(t)}</td><td style="padding:4px 0"><b>${h}</b></td></tr>`;
  let cuerpo = `<p>Hola ${esc_(docente.nombre.split(' ')[0] || '')}, registramos tu reporte de la semana <b>${esc_(r.semana)}</b>.</p>` +
    `<p style="font-size:18px">Código: <b>${codigo}</b></p>`;
  if (reemplazo) cuerpo += `<p>Este reporte reemplaza al anterior (${esc_(reemplazo)}).</p>`;
  if (r.sin_novedades) cuerpo += '<p>Semana sin novedades: cumpliste tu horario y no registraste horas extra.</p>';
  if (r.incumplimientos.length) cuerpo += '<p><b>Horas no cumplidas</b></p><table>' +
    r.incumplimientos.map(x => fila(`${x.nombre} · ${x.motivo}`, x.horas + ' h')).join('') + '</table>';
  if (r.extras.length) cuerpo += '<p><b>Horas extra</b></p><table>' + r.extras.map(x => fila(x.nombre, x.horas + ' h')).join('') + '</table>';
  cuerpo += '<p style="color:#475569">Si algo no es correcto, vuelve a reportar la misma semana: el nuevo reporte reemplaza a este.</p>';
  try {
    MailApp.sendEmail({ to: email, subject: `Reporte de carga horaria ${r.semana} · ${codigo}`, htmlBody: cuerpo, name: 'Carga horaria DTC' });
  } catch (e) {
    console.warn('No se pudo enviar el comprobante: ' + e);   // el reporte ya quedó guardado
  }
}

/** Evita que un texto escrito por el docente se guarde como fórmula (=, +, -, @ al inicio). */
function textoSeguro_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function fechaIso_(d) { return Utilities.formatDate(d, ZONA, 'yyyy-MM-dd'); }
function fechaHora_(d) { return Utilities.formatDate(d, ZONA, 'yyyy-MM-dd HH:mm:ss'); }
function redondear_(x) { return Math.round(x * 100) / 100; }
function esc_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function errorUsuario_(codigo, mensaje) { const e = new Error(mensaje); e.esUsuario = true; e.codigo = codigo; return e; }

/** Prueba manual desde el editor: muestra el contexto de un correo registrado (sin verificar token). */
function probarContexto() {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const d = buscarDocente_(email);
  console.log(d ? JSON.stringify(contexto_(d), null, 1).slice(0, 4000) : 'Tu correo no está en la pestaña Docentes: ' + email);
}
