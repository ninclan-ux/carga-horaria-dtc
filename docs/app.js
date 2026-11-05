/* Reporte semanal de carga horaria – Docentes Tiempo Completo (Unifranz)
 * Aplicación estática: inicia sesión con Google, pide el contexto del docente al Apps Script y envía el reporte.
 * Pasos: semana → cómo fue → horas no cumplidas → horas extra → revisar y enviar → confirmación.
 * "Sin novedades" salta directo de "cómo fue" a "revisar".
 */
(() => {
  'use strict';

  const C = window.CONFIG || {};
  const DEMO = new URLSearchParams(location.search).has('demo');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = $('#app');

  // ------------------------------------------------------------------------------------------- íconos
  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`;
  const ICO = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.8"'),
    reloj: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    calendario: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    codigo: svg('<path d="M4 7h16M4 12h10M4 17h7"/><path d="m16 15 2 2 3.5-3.5"/>'),
    alerta: svg('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>'),
    info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>'),
    copiar: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/>'),
    atras: svg('<path d="M15 5.5 8.5 12l6.5 6.5"/>'),
    flecha: svg('<path d="M9 5.5 15.5 12 9 18.5"/>'),
    mas: svg('<path d="M12 5.5v13M5.5 12h13"/>', 'stroke-width="2.6"'),
    menos: svg('<path d="M5.5 12h13"/>', 'stroke-width="2.6"'),
    correo: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="m4 7 8 6 8-6"/>'),
    cambio: svg('<path d="M4 9h12.5l-3.5-3.5M20 15H7.5l3.5 3.5"/>'),
    vacio: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/>'),
    google: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  };

  // ------------------------------------------------------------------------------------------- utilidades
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = x => Number(x).toLocaleString('es-BO', { maximumFractionDigits: 2 });
  const fmtH = x => fmtN(x) + ' h';
  const leerNumero = t => { const n = Number(String(t).trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const aPaso = x => Math.round(x / paso()) * paso();
  const sumar = obj => Object.values(obj).reduce((a, v) => a + (Number(v.horas) || 0), 0);
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const primerNombre = () => E.nombreGoogle || String((E.ctx && E.ctx.docente.nombre) || '').split(' ')[0] || '';
  const paso = () => (E.ctx && E.ctx.limites.paso) || 0.5;
  const dispositivo = () => matchMedia('(pointer: coarse)').matches ? (innerWidth >= 768 ? 'tableta' : 'móvil') : 'escritorio';
  const oscuro = () => matchMedia('(prefers-color-scheme: dark)').matches;

  function nuevoReporte() { return { tipo: null, inc: {}, hubo: null, ext: {}, comentario: '' }; }

  const E = {
    token: null, email: '', nombreGoogle: '', ctx: null, inicio: null,
    semana: null, rSemana: null, paso: 'inicio', r: nuevoReporte(), ultimo: null, enviando: false, errorLogin: '', errorMsg: '',
  };

  const semanaActual = () => (E.ctx ? E.ctx.semanas.find(s => s.viernes === E.semana) : null);
  const nombreActividad = cod => {
    const s = semanaActual();
    const p = s && s.plan.find(x => x.actividad === cod);
    if (p) return p.nombre;
    const a = E.ctx && E.ctx.actividades.find(x => x.codigo === cod);
    return a ? a.nombre : cod;
  };
  const motivoRequiere = m => !!(E.ctx && E.ctx.motivos.find(x => x.motivo === m && x.requiere_detalle));

  function toast(texto) {
    const t = $('#toast');
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------------------------------------- borrador local
  const claveBorrador = v => `dtc-borrador:${E.email}:${v}`;
  function guardarBorrador() {
    if (!E.semana || !E.email) return;
    try { localStorage.setItem(claveBorrador(E.semana), JSON.stringify(E.r)); } catch (e) { /* modo privado */ }
  }
  function leerBorrador(v) {
    try { const b = JSON.parse(localStorage.getItem(claveBorrador(v)) || 'null'); return b && b.tipo ? Object.assign(nuevoReporte(), b) : null; }
    catch (e) { return null; }
  }
  function borrarBorrador(v) { try { localStorage.removeItem(claveBorrador(v)); } catch (e) { /* nada */ } }

  // ------------------------------------------------------------------------------------------- backend
  const configurado = () => DEMO || (C.CLIENT_ID && !/PEGAR_AQUI/.test(C.CLIENT_ID) && C.API_URL && !/PEGAR_AQUI/.test(C.API_URL));

  async function api(accion, datos = {}) {
    if (DEMO) return window.MockAPI.llamar(accion, datos);
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 40000);
    try {
      const r = await fetch(C.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // sin preflight CORS
        body: JSON.stringify(Object.assign({ accion, idToken: E.token }, datos)),
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }

  const ERRORES_SESION = ['SIN_SESION', 'SESION', 'DOMINIO'];

  // ------------------------------------------------------------------------------------------- inicio de sesión
  let gsiListo = false;
  function cargarGoogle() {
    return new Promise((ok, mal) => {
      if (window.google && google.accounts && google.accounts.id) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = ok;
      s.onerror = () => mal(new Error('gsi'));
      document.head.appendChild(s);
    });
  }

  async function prepararBoton() {
    const cont = $('#g-boton');
    if (!cont) return;
    if (DEMO) {
      cont.innerHTML = `<button type="button" class="btn btn-primario" data-accion="login-demo">${ICO.google}<span>Iniciar sesión (demo)</span></button>`;
      return;
    }
    if (!configurado()) { mostrarErrorLogin('El formulario aún no está configurado. Avisa a ' + (C.SOPORTE || 'soporte') + '.'); return; }
    try { await cargarGoogle(); }
    catch (e) { mostrarErrorLogin('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión y recarga la página.'); return; }
    if (!gsiListo) {
      google.accounts.id.initialize({
        client_id: C.CLIENT_ID, callback: r => alIniciar(r.credential), hd: C.DOMINIO,
        auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup', context: 'signin', use_fedcm_for_prompt: true,
      });
      gsiListo = true;
    }
    google.accounts.id.renderButton(cont, {
      type: 'standard', theme: oscuro() ? 'filled_black' : 'outline', size: 'large', text: 'signin_with',
      shape: 'pill', logo_alignment: 'left', locale: 'es', width: Math.min(320, cont.clientWidth || 320),
    });
  }

  function mostrarErrorLogin(texto) {
    E.errorLogin = texto;
    const el = $('#error-login');
    if (el) { el.hidden = !texto; $('p', el).textContent = texto; }
  }

  function decodificarToken(jwt) {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  }

  async function alIniciar(credencial) {
    let datos;
    try { datos = decodificarToken(credencial); } catch (e) { mostrarErrorLogin('No pudimos leer tu sesión. Intenta de nuevo.'); return; }
    const email = String(datos.email || '').toLowerCase();
    if (!email.endsWith('@' + C.DOMINIO)) { mostrarErrorLogin('Usa tu cuenta institucional @' + C.DOMINIO + '.'); return; }
    E.token = credencial;
    E.email = email;
    E.nombreGoogle = datos.given_name || '';
    E.inicio = new Date().toISOString();
    E.errorLogin = '';
    mostrarUsuario();
    await cargarContexto();
  }

  function loginDemo() {
    E.token = 'demo';
    E.email = window.MockAPI.email;
    E.nombreGoogle = 'María';
    E.inicio = new Date().toISOString();
    mostrarUsuario();
    cargarContexto();
  }

  function mostrarUsuario() {
    $('#usuario').hidden = !E.email;
    $('#usuario-correo').textContent = E.email;
    $('#usuario [data-accion="salir"]').title = E.email ? 'Cerrar la sesión de ' + E.email : '';
  }

  function salir(mensaje = '') {
    if (!DEMO && window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    Object.assign(E, { token: null, email: '', nombreGoogle: '', ctx: null, semana: null, rSemana: null, r: nuevoReporte(), ultimo: null, errorLogin: mensaje });
    mostrarUsuario();
    ir('inicio');
  }

  async function cargarContexto() {
    ir('cargando', false);
    try {
      const r = await api('contexto');
      if (!r.ok) {
        if (r.codigo_error === 'NO_REGISTRADO') { E.errorMsg = r.error; ir('noregistrado'); return; }
        if (ERRORES_SESION.includes(r.codigo_error)) { salir(r.error); return; }
        E.errorMsg = r.error; ir('error'); return;
      }
      E.ctx = r;
      actualizarSoporte();
      E.semana = null;
      ir('semana');
    } catch (e) {
      E.errorMsg = 'No pudimos conectarnos con el servidor. Revisa tu conexión e inténtalo de nuevo.';
      ir('error');
    }
  }

  function actualizarSoporte() {
    const correo = (E.ctx && E.ctx.soporte) || C.SOPORTE || '';
    const a = $('#soporte');
    a.textContent = correo;
    a.href = 'mailto:' + correo + '?subject=' + encodeURIComponent('Formulario de carga horaria DTC');
    a.parentElement.hidden = !correo;
  }

  // ------------------------------------------------------------------------------------------- navegación
  const NOMBRE_PASO = { semana: 'Semana', como: 'Tu semana', incumplimientos: 'Horas no cumplidas', extras: 'Horas extra', revisar: 'Revisar y enviar' };
  const pasos = () => (E.r.tipo === 'sin_novedades' ? ['semana', 'como', 'revisar'] : ['semana', 'como', 'incumplimientos', 'extras', 'revisar']);

  function actualizarProgreso() {
    const lista = pasos();
    const i = lista.indexOf(E.paso);
    $('#progreso').hidden = i < 0;
    if (i < 0) return;
    const pct = Math.round(((i + 1) / lista.length) * 100);
    $('#progreso-texto').textContent = `Paso ${i + 1} de ${lista.length} · ${NOMBRE_PASO[E.paso]}`;
    const barra = $('#progreso-barra');
    barra.setAttribute('aria-valuenow', pct);
    barra.setAttribute('aria-valuetext', `Paso ${i + 1} de ${lista.length}`);
    $('span', barra).style.width = pct + '%';
  }

  function ir(nuevo, enfocar = true) {
    E.paso = nuevo;
    const pantallas = { inicio: pInicio, cargando: pCargando, error: pError, noregistrado: pNoRegistrado, semana: pSemana, como: pComo,
                        incumplimientos: pIncumplimientos, extras: pExtras, revisar: pRevisar, confirmacion: pConfirmacion, fin: pFin };
    app.innerHTML = pantallas[nuevo]();
    actualizarProgreso();
    if (nuevo === 'inicio') prepararBoton();
    window.scrollTo(0, 0);
    if (enfocar) { const h = $('h1', app); if (h) h.focus({ preventScroll: true }); }
  }

  function atras() {
    const lista = pasos();
    const i = lista.indexOf(E.paso);
    if (i > 0) ir(lista[i - 1]);
  }

  const barraAcciones = (conAtras, principal) => `
    <div class="acciones"><div class="acciones-in">
      ${conAtras ? `<button type="button" class="btn btn-secundario" data-accion="atras">${ICO.atras}<span>Atrás</span></button>` : ''}
      ${principal}
    </div></div>`;
  const botonSeguir = (accion, texto = 'Continuar') =>
    `<button type="button" class="btn btn-primario" data-accion="${accion}"><span>${texto}</span>${ICO.flecha}</button>`;
  const errorCampo = (id = '') => `<p class="error-campo" ${id ? `id="${id}"` : ''} data-error role="alert" hidden></p>`;
  function ponerError(el, texto) {
    if (!el) return;
    el.hidden = !texto;
    el.innerHTML = texto ? ICO.alerta + `<span>${esc(texto)}</span>` : '';
  }

  // ------------------------------------------------------------------------------------------- pantallas
  function pInicio() {
    return `
    <section class="pantalla hero">
      <p class="eyebrow">Docentes Tiempo Completo</p>
      <h1 tabindex="-1">Reporte semanal de carga horaria</h1>
      <p class="lead">Cuéntanos en menos de un minuto cómo fue tu semana: horas que no pudiste cumplir y horas extra.</p>
      <ul class="puntos">
        <li><span class="ico">${ICO.check}</span><div><b>Semana normal, un solo toque</b><span class="txt">Si cumpliste tu horario, solo lo confirmas.</span></div></li>
        <li><span class="ico">${ICO.calendario}</span><div><b>Solo tus actividades</b><span class="txt">Ves tu horario de la semana con las horas planificadas.</span></div></li>
        <li><span class="ico">${ICO.codigo}</span><div><b>Código de confirmación</b><span class="txt">Al terminar recibes un código y una copia por correo.</span></div></li>
      </ul>
      <div class="tarjeta login">
        <h2>Ingresa con tu cuenta institucional</h2>
        <div class="g-boton" id="g-boton"></div>
        <p class="nota">Puedes usar tu correo <b>doc.</b> o tu correo administrativo @${esc(C.DOMINIO)}.</p>
        <div class="aviso aviso-error" id="error-login" role="alert" ${E.errorLogin ? '' : 'hidden'}>${ICO.alerta}<p>${esc(E.errorLogin)}</p></div>
      </div>
    </section>`;
  }

  function pCargando() {
    return `
    <section class="pantalla" aria-busy="true">
      <h1 tabindex="-1" class="sr-only">Cargando tu horario</h1>
      <div class="carga" aria-hidden="true">
        <div class="esqueleto corto"></div><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div>
      </div>
      <p class="nota" role="status">Cargando tu horario…</p>
    </section>`;
  }

  function pError() {
    return `
    <section class="pantalla">
      <h1 tabindex="-1">No pudimos continuar</h1>
      <div class="aviso aviso-error">${ICO.alerta}<p>${esc(E.errorMsg)}</p></div>
      <div class="pila">
        <button type="button" class="btn btn-primario btn-bloque" data-accion="reintentar">Reintentar</button>
        <button type="button" class="btn btn-secundario btn-bloque" data-accion="salir">Volver al inicio</button>
      </div>
    </section>`;
  }

  function pNoRegistrado() {
    return `
    <section class="pantalla">
      <p class="eyebrow">Cuenta no registrada</p>
      <h1 tabindex="-1">No encontramos tu cuenta</h1>
      <div class="aviso aviso-alerta">${ICO.alerta}<p>${esc(E.errorMsg)}</p></div>
      <p class="sub">Muchos docentes tienen dos cuentas (la <b>doc.</b> y la administrativa). Inicia sesión con la otra e inténtalo de nuevo.</p>
      <div class="pila">
        <button type="button" class="btn btn-primario btn-bloque" data-accion="salir">Usar otra cuenta</button>
      </div>
    </section>`;
  }

  function preseleccion() {
    const hoy = hoyIso();
    const ss = E.ctx.semanas;
    const s = ss.find(x => !x.reportada && x.viernes < hoy) || ss.find(x => !x.reportada) || ss.find(x => x.viernes < hoy) || ss[0];
    return s ? s.viernes : null;
  }

  function chipSemana(s) {
    const hoy = hoyIso();
    if (s.reportada) return `<span class="chip chip-ok">${ICO.check}Reportada</span>`;
    if (s.lunes <= hoy && hoy <= s.viernes) return '<span class="chip chip-curso">En curso</span>';
    return '<span class="chip chip-pendiente">Pendiente</span>';
  }

  function avisoReemplazo(s) {
    if (!s || !s.reportada) return '';
    return `<div class="aviso aviso-alerta">${ICO.alerta}<p>Ya enviaste esta semana (código <b>${esc(s.reportada.codigo)}</b>). Si envías de nuevo, el nuevo reporte <b>reemplaza</b> al anterior.</p></div>`;
  }

  function pSemana() {
    const c = E.ctx;
    if (!E.semana) E.semana = preseleccion();
    const sede = [c.docente.sede, c.docente.carreras].filter(Boolean).join(' · ');
    const lista = c.semanas.map(s => {
      const total = s.plan.reduce((a, x) => a + x.horas, 0);
      const meta = [`Semana ${s.nro}`, s.hito, total ? `${fmtH(total)} planificadas` : 'Sin horario cargado'].filter(Boolean).join(' · ');
      return `
        <label class="opcion">
          <input type="radio" name="semana" value="${esc(s.viernes)}" ${s.viernes === E.semana ? 'checked' : ''}>
          <span class="radio-falso" aria-hidden="true"></span>
          <span class="opcion-cuerpo"><span class="opcion-titulo">${esc(s.etiqueta)}</span><span class="opcion-meta">${esc(meta)}</span></span>
          ${chipSemana(s)}
        </label>`;
    }).join('');
    return `
    <section class="pantalla">
      <p class="eyebrow">Hola, ${esc(primerNombre())}</p>
      <h1 tabindex="-1">¿Qué semana vas a reportar?</h1>
      <p class="sub">${esc(sede)}</p>
      ${c.mensaje ? `<div class="aviso aviso-info">${ICO.info}<p>${esc(c.mensaje)}</p></div>` : ''}
      ${c.semanas.length ? `<fieldset class="lista"><legend class="sr-only">Semanas abiertas para reportar</legend>${lista}</fieldset>`
                         : `<div class="tarjeta vacio">${ICO.calendario}<p>No hay semanas abiertas para reportar en este momento.</p></div>`}
      <div id="aviso-reemplazo">${avisoReemplazo(semanaActual())}</div>
      ${c.semanas.length ? barraAcciones(false, botonSeguir('semana-ok')) : ''}
    </section>`;
  }

  function pComo() {
    const s = semanaActual();
    const t = E.r.tipo;
    return `
    <section class="pantalla">
      <p class="eyebrow">${esc(s.etiqueta)}</p>
      <h1 tabindex="-1">¿Cómo fue tu semana?</h1>
      <p class="sub">Elige una opción.</p>
      <div class="opciones-grandes">
        <button type="button" class="opcion-grande" data-accion="sin-novedades" aria-pressed="${t === 'sin_novedades'}">
          <span class="ico ico-ok">${ICO.check}</span>
          <span><b>Se cumplió todo mi horario, sin horas extra</b><small>Confirmas y listo.</small></span>
          <span class="flecha">${ICO.flecha}</span>
        </button>
        <button type="button" class="opcion-grande" data-accion="con-novedades" aria-pressed="${t === 'detalle'}">
          <span class="ico ico-cambio">${ICO.cambio}</span>
          <span><b>Hubo horas no cumplidas o horas extra</b><small>Indicas cuáles actividades y cuántas horas.</small></span>
          <span class="flecha">${ICO.flecha}</span>
        </button>
      </div>
      ${barraAcciones(true, '')}
    </section>`;
  }

  function stepper(idEtiqueta, valor, max) {
    return `
      <div class="stepper" role="group" aria-labelledby="${idEtiqueta}">
        <button type="button" data-accion="menos" aria-label="Restar media hora">${ICO.menos}</button>
        <input type="text" inputmode="decimal" data-campo="horas" value="${fmtN(valor)}" data-max="${max}" aria-labelledby="${idEtiqueta}" autocomplete="off">
        <span class="unidad" aria-hidden="true">h</span>
        <button type="button" data-accion="mas" aria-label="Sumar media hora">${ICO.mas}</button>
      </div>`;
  }

  function itemIncumplimiento(p, i) {
    const v = E.r.inc[p.actividad];
    const opciones = E.ctx.motivos.map(m => `<option ${v && v.motivo === m.motivo ? 'selected' : ''}>${esc(m.motivo)}</option>`).join('');
    const req = v && motivoRequiere(v.motivo);
    return `
      <div class="item ${v ? 'activo' : ''}" data-tipo="inc" data-act="${esc(p.actividad)}" data-max="${p.horas}">
        <label class="item-cabeza">
          <input type="checkbox" data-accion="marcar" ${v ? 'checked' : ''} aria-controls="inc-panel-${i}">
          <span class="check-falso" aria-hidden="true">${ICO.check}</span>
          <span class="item-nombre">${esc(p.nombre)}</span>
          <span class="item-horas"><span class="sr-only">Planificadas: </span>${fmtH(p.horas)}</span>
        </label>
        <div class="item-panel" id="inc-panel-${i}" ${v ? '' : 'hidden'}>
          <div class="campo">
            <span class="etiqueta" id="inc-h-${i}">Horas no cumplidas</span>
            ${stepper('inc-h-' + i, v ? v.horas : p.horas, p.horas)}
            <p class="ayuda">De ${fmtH(p.horas)} planificadas. Ajusta si cumpliste una parte.</p>
          </div>
          <div class="campo">
            <label for="inc-m-${i}">Motivo</label>
            <select class="entrada" id="inc-m-${i}" data-campo="motivo"><option value="">Elige un motivo</option>${opciones}</select>
          </div>
          <div class="campo" data-bloque="detalle" ${v && v.motivo ? '' : 'hidden'}>
            <label for="inc-d-${i}">Detalle <span class="opcional" data-opcional ${req ? 'hidden' : ''}>(opcional)</span></label>
            <input class="entrada" id="inc-d-${i}" data-campo="detalle" maxlength="300" autocomplete="off" value="${esc(v ? v.detalle : '')}"
                   placeholder="${req ? 'Cuéntanos brevemente qué pasó' : 'Ej.: reunión convocada por dirección'}">
          </div>
          ${errorCampo()}
        </div>
      </div>`;
  }

  function textoTotalInc() {
    const s = semanaActual();
    const plan = s.plan.reduce((a, x) => a + x.horas, 0);
    return `<span>Total no cumplido</span><strong>${fmtH(sumar(E.r.inc))} <small class="opcional">de ${fmtH(plan)}</small></strong>`;
  }

  function pIncumplimientos() {
    const s = semanaActual();
    const cuerpo = s.plan.length
      ? `<div class="lista">${s.plan.map(itemIncumplimiento).join('')}</div><div class="total" id="total-inc" aria-live="polite">${textoTotalInc()}</div>`
      : `<div class="tarjeta vacio">${ICO.vacio}<p>No encontramos actividades planificadas para esta semana en tu horario.</p><p class="nota">Puedes continuar y registrar horas extra.</p></div>`;
    return `
    <section class="pantalla">
      <p class="eyebrow">${esc(s.etiqueta)}</p>
      <h1 tabindex="-1">¿Qué actividades no pudiste cumplir?</h1>
      <p class="sub">Marca solo las que no cumpliste del todo. Si cumpliste todas, toca Continuar.</p>
      ${cuerpo}
      ${barraAcciones(true, botonSeguir('inc-ok'))}
    </section>`;
  }

  function itemExtra(cod, nombre, detalle, i) {
    const v = E.r.ext[cod];
    const L = E.ctx.limites;
    return `
      <div class="item ${v ? 'activo' : ''}" data-tipo="ext" data-act="${esc(cod)}" data-max="${L.extra_actividad}">
        <label class="item-cabeza">
          <input type="checkbox" data-accion="marcar" ${v ? 'checked' : ''} aria-controls="ext-panel-${i}">
          <span class="check-falso" aria-hidden="true">${ICO.check}</span>
          <span class="item-nombre">${esc(nombre)}<small>${esc(detalle)}</small></span>
        </label>
        <div class="item-panel" id="ext-panel-${i}" ${v ? '' : 'hidden'}>
          <div class="campo">
            <span class="etiqueta" id="ext-h-${i}">Horas extra</span>
            ${stepper('ext-h-' + i, v ? v.horas : 1, L.extra_actividad)}
            <p class="ayuda">Horas adicionales a las planificadas (máximo ${fmtH(L.extra_actividad)}).</p>
          </div>
          ${errorCampo()}
        </div>
      </div>`;
  }

  function listaExtras() {
    const s = semanaActual();
    const enPlan = new Set(s.plan.map(p => p.actividad));
    const items = s.plan.map((p, i) => itemExtra(p.actividad, p.nombre, `Planificadas: ${fmtH(p.horas)}`, i));
    Object.keys(E.r.ext).filter(c => !enPlan.has(c)).forEach((c, k) =>
      items.push(itemExtra(c, nombreActividad(c), 'Fuera de tu horario', s.plan.length + k)));
    const usadas = new Set([...enPlan, ...Object.keys(E.r.ext)]);
    const otras = E.ctx.actividades.filter(a => !usadas.has(a.codigo));
    const L = E.ctx.limites;
    const total = sumar(E.r.ext);
    return `
      <div class="lista">${items.join('')}</div>
      ${otras.length ? `
      <div class="campo" style="margin-top:14px">
        <label for="otra-act">¿Otra actividad que no está en tu horario?</label>
        <select class="entrada" id="otra-act" data-campo="otra"><option value="">Agregar otra actividad…</option>
          ${otras.map(a => `<option value="${esc(a.codigo)}">${esc(a.nombre)}</option>`).join('')}</select>
      </div>` : ''}
      <div class="total ${total > L.extra_semana ? 'excedido' : ''}" id="total-ext" aria-live="polite">
        <span>Total horas extra <small class="opcional">(máx. ${fmtH(L.extra_semana)})</small></span><strong>${fmtH(total)}</strong>
      </div>
      ${errorCampo('error-total-ext')}`;
  }

  function pExtras() {
    const s = semanaActual();
    const h = E.r.hubo;
    return `
    <section class="pantalla">
      <p class="eyebrow">${esc(s.etiqueta)}</p>
      <h1 tabindex="-1">¿Trabajaste horas extra esta semana?</h1>
      <p class="sub">Horas adicionales a tu horario planificado.</p>
      <fieldset class="lista" style="gap:0">
        <legend class="sr-only">¿Trabajaste horas extra?</legend>
        <div class="segmentado">
          <label><input type="radio" name="hubo" value="si" ${h === true ? 'checked' : ''}>Sí</label>
          <label><input type="radio" name="hubo" value="no" ${h === false ? 'checked' : ''}>No</label>
        </div>
      </fieldset>
      ${errorCampo('error-hubo')}
      <div id="panel-extras" ${h === true ? '' : 'hidden'}>${h === true ? listaExtras() : ''}</div>
      <div id="sin-nada" hidden></div>
      ${barraAcciones(true, botonSeguir('ext-ok'))}
    </section>`;
  }

  function bloqueResumen(r) {
    if (r.sin_novedades) return `<div class="resumen-bloque"><p class="resumen-ok">${ICO.check}<span>Cumpliste todo tu horario, sin horas extra.</span></p></div>`;
    const li = (n, sub, h) => `<li><span>${esc(n)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="h">${fmtH(h)}</span></li>`;
    const editar = p => (r.editable ? `<button type="button" class="enlace" data-accion="ir" data-paso="${p}">Editar</button>` : '');
    return `
      <div class="resumen-bloque">
        <h2><span>Horas no cumplidas</span>${editar('incumplimientos')}</h2>
        ${r.incumplimientos.length ? `<ul class="resumen-lista">${r.incumplimientos.map(x => li(x.nombre, x.motivo + (x.detalle ? ' — ' + x.detalle : ''), x.horas)).join('')}</ul>`
                                   : '<p class="ayuda">Ninguna.</p>'}
      </div>
      <div class="resumen-bloque">
        <h2><span>Horas extra</span>${editar('extras')}</h2>
        ${r.extras.length ? `<ul class="resumen-lista">${r.extras.map(x => li(x.nombre, '', x.horas)).join('')}</ul>` : '<p class="ayuda">Ninguna.</p>'}
      </div>`;
  }

  function armarEnvio() {
    const s = semanaActual();
    const sin = E.r.tipo === 'sin_novedades';
    const enPlan = new Set(s.plan.map(p => p.actividad));
    const incumplimientos = sin ? [] : Object.entries(E.r.inc).filter(([c]) => enPlan.has(c))
      .map(([actividad, v]) => ({ actividad, horas: v.horas, motivo: v.motivo, detalle: (v.detalle || '').trim() }));
    const extras = sin || !E.r.hubo ? [] : Object.entries(E.r.ext).map(([actividad, v]) => ({ actividad, horas: v.horas }));
    return {
      semana_viernes: s.viernes, tipo: sin ? 'sin_novedades' : 'detalle', incumplimientos, extras,
      comentario: E.r.comentario.trim(), inicio: E.inicio, dispositivo: dispositivo(),
    };
  }

  function pRevisar() {
    const s = semanaActual();
    const d = armarEnvio();
    const L = E.ctx.limites;
    const resumen = {
      editable: true, sin_novedades: d.tipo === 'sin_novedades',
      incumplimientos: d.incumplimientos.map(x => ({ nombre: nombreActividad(x.actividad), horas: x.horas, motivo: x.motivo, detalle: x.detalle })),
      extras: d.extras.map(x => ({ nombre: nombreActividad(x.actividad), horas: x.horas })),
    };
    return `
    <section class="pantalla">
      <p class="eyebrow">Último paso</p>
      <h1 tabindex="-1">Revisa y envía tu reporte</h1>
      <div class="tarjeta resumen">
        <dl><dt>Semana</dt><dd>${esc(s.etiqueta)}</dd><dt>Docente</dt><dd>${esc(E.ctx.docente.nombre)}</dd></dl>
        ${bloqueResumen(resumen)}
      </div>
      ${avisoReemplazo(s)}
      <div class="campo" style="margin-top:18px">
        <label for="comentario">Comentario <span class="opcional">(opcional)</span></label>
        <textarea class="entrada" id="comentario" data-campo="comentario" maxlength="${L.comentario}" rows="3"
                  placeholder="Algo que quieras que sepa tu coordinación" aria-describedby="contador">${esc(E.r.comentario)}</textarea>
        <p class="contador" id="contador">${E.r.comentario.length}/${L.comentario}</p>
      </div>
      <div class="aviso aviso-error" id="error-envio" role="alert" hidden>${ICO.alerta}<p></p></div>
      ${barraAcciones(true, `<button type="button" class="btn btn-primario" data-accion="enviar" id="btn-enviar"><span>Enviar reporte</span>${ICO.check}</button>`)}
    </section>`;
  }

  function semanasPendientes() {
    const hoy = hoyIso();
    return E.ctx.semanas.filter(s => !s.reportada && s.viernes <= hoy).length;
  }

  function pConfirmacion() {
    const r = E.ultimo;
    const quedan = semanasPendientes();
    return `
    <section class="pantalla exito">
      <div class="exito-ico">${ICO.check}</div>
      <h1 tabindex="-1">¡Reporte enviado!</h1>
      <p class="sub">${esc(r.resumen.semana)}</p>
      <div class="codigo">
        <span>Tu código de confirmación</span>
        <strong id="codigo">${esc(r.codigo)}</strong>
        <button type="button" class="btn btn-secundario" data-accion="copiar">${ICO.copiar}<span>Copiar código</span></button>
      </div>
      ${r.reemplazo ? `<p class="nota">Este reporte reemplaza al anterior (${esc(r.reemplazo)}).</p>` : ''}
      ${r.comprobante ? `<p class="nota">Te enviamos una copia a <b>${esc(r.email || E.email)}</b>.</p>` : ''}
      <div class="tarjeta resumen">${bloqueResumen(r.resumen).replace('resumen-bloque', 'resumen-bloque" style="border:0;margin:0;padding:0')}</div>
      <div class="pila">
        <button type="button" class="btn ${quedan ? 'btn-primario' : 'btn-secundario'} btn-bloque" data-accion="otra-semana">${ICO.calendario}<span>Reportar otra semana</span></button>
        <button type="button" class="btn ${quedan ? 'btn-secundario' : 'btn-primario'} btn-bloque" data-accion="terminar">Terminar</button>
      </div>
      ${quedan ? `<p class="nota">Tienes ${quedan} ${quedan === 1 ? 'semana pendiente' : 'semanas pendientes'} de reportar.</p>` : ''}
    </section>`;
  }

  function pFin() {
    return `
    <section class="pantalla exito">
      <div class="exito-ico">${ICO.check}</div>
      <h1 tabindex="-1">¡Gracias${E.finNombre ? ', ' + esc(E.finNombre) : ''}!</h1>
      <p class="sub">Tu reporte quedó registrado. Ya puedes cerrar esta pestaña.</p>
      <div class="pila"><button type="button" class="btn btn-secundario btn-bloque" data-accion="salir">Volver al inicio</button></div>
    </section>`;
  }

  // ------------------------------------------------------------------------------------------- validaciones
  function validarHoras(v, max) {
    const p = paso();
    return Number.isFinite(v) && v >= p && v <= max + 1e-9 && Math.abs(v / p - Math.round(v / p)) < 1e-9;
  }

  function validarIncumplimientos() {
    let primero = null;
    $$('.item[data-tipo="inc"]', app).forEach(item => {
      const v = E.r.inc[item.dataset.act];
      const err = $('[data-error]', item);
      ponerError(err, '');
      if (!v) return;
      const max = Number(item.dataset.max);
      let msg = '', campo = null;
      if (!validarHoras(v.horas, max)) { msg = `Indica entre ${fmtN(paso())} y ${fmtN(max)} h, en pasos de media hora.`; campo = $('[data-campo="horas"]', item); }
      else if (!v.motivo) { msg = 'Elige un motivo.'; campo = $('[data-campo="motivo"]', item); }
      else if (motivoRequiere(v.motivo) && !String(v.detalle || '').trim()) { msg = 'Describe brevemente el motivo.'; campo = $('[data-campo="detalle"]', item); }
      marcarInvalido(item, campo);
      if (msg) { ponerError(err, msg); primero = primero || campo; }
    });
    if (primero) primero.focus();
    return !primero;
  }

  function marcarInvalido(item, campo) {
    $$('[aria-invalid]', item).forEach(x => x.removeAttribute('aria-invalid'));
    if (campo) (campo.closest('.stepper') || campo).setAttribute('aria-invalid', 'true');
  }

  function validarExtras() {
    const L = E.ctx.limites;
    ponerError($('#error-hubo'), '');
    if (E.r.hubo === null) { ponerError($('#error-hubo'), 'Elige Sí o No.'); $('input[name="hubo"]', app).focus(); return false; }
    const hayInc = Object.keys(E.r.inc).length > 0;
    if (E.r.hubo === false) {
      if (!hayInc) { mostrarSinNada(); return false; }
      return true;
    }
    let primero = null;
    $$('.item[data-tipo="ext"]', app).forEach(item => {
      const v = E.r.ext[item.dataset.act];
      const err = $('[data-error]', item);
      ponerError(err, '');
      if (!v) return;
      const ok = validarHoras(v.horas, L.extra_actividad);
      const campo = $('[data-campo="horas"]', item);
      marcarInvalido(item, ok ? null : campo);
      if (!ok) { ponerError(err, `Indica entre ${fmtN(paso())} y ${fmtN(L.extra_actividad)} h, en pasos de media hora.`); primero = primero || campo; }
    });
    if (primero) { primero.focus(); return false; }
    const errTotal = $('#error-total-ext');
    ponerError(errTotal, '');
    if (!Object.keys(E.r.ext).length) {
      ponerError(errTotal, 'Marca al menos una actividad con horas extra, o elige «No».');
      const c = $('.item[data-tipo="ext"] input', app); if (c) c.focus();
      return false;
    }
    if (sumar(E.r.ext) > L.extra_semana + 1e-9) {
      ponerError(errTotal, `El total no puede superar ${fmtH(L.extra_semana)} por semana.`);
      return false;
    }
    return true;
  }

  function mostrarSinNada() {
    const el = $('#sin-nada');
    el.hidden = false;
    el.innerHTML = `
      <div class="aviso aviso-alerta" role="alert">${ICO.info}
        <div><p>No marcaste horas no cumplidas ni horas extra. Entonces tu semana fue <b>sin novedades</b>.</p>
        <button type="button" class="enlace" data-accion="cambiar-sin">Registrar «Se cumplió todo mi horario»</button></div>
      </div>`;
    $('.enlace', el).focus();
  }

  // ------------------------------------------------------------------------------------------- envío
  async function enviar() {
    if (E.enviando) return;
    const btn = $('#btn-enviar');
    const err = $('#error-envio');
    err.hidden = true;
    E.enviando = true;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Enviando…</span>';
    const s = semanaActual();
    try {
      const r = await api('enviar', armarEnvio());
      if (!r.ok) {
        if (ERRORES_SESION.includes(r.codigo_error)) {
          errorEnvio(err, 'Tu sesión expiró. Vuelve a iniciar sesión: tus respuestas quedan guardadas en este dispositivo.', true);
        } else {
          errorEnvio(err, r.error || 'No pudimos guardar tu reporte.');
        }
        return;
      }
      borrarBorrador(s.viernes);
      s.reportada = { codigo: r.codigo };
      E.ultimo = r;
      ir('confirmacion');
    } catch (e) {
      errorEnvio(err, 'No pudimos enviar tu reporte. Revisa tu conexión e inténtalo de nuevo; tus respuestas siguen aquí.');
    } finally {
      E.enviando = false;
      if (document.body.contains(btn)) {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
        btn.innerHTML = `<span>Enviar reporte</span>${ICO.check}`;
      }
    }
  }

  function errorEnvio(el, texto, sesion = false) {
    el.hidden = false;
    $('p', el).innerHTML = esc(texto) + (sesion ? ' <button type="button" class="enlace" data-accion="salir">Iniciar sesión</button>' : '');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ------------------------------------------------------------------------------------------- eventos
  function ajustarHoras(input, delta) {
    const max = Number(input.dataset.max);
    let v = leerNumero(input.value);
    if (!Number.isFinite(v)) v = 0;
    v = delta ? aPaso(v) + delta : aPaso(v);
    v = Math.min(max, Math.max(paso(), v));
    input.value = fmtN(v);
    guardarHoras(input, v);
  }

  function guardarHoras(input, v) {
    const item = input.closest('.item');
    const dic = item.dataset.tipo === 'inc' ? E.r.inc : E.r.ext;
    if (dic[item.dataset.act]) dic[item.dataset.act].horas = v;
    actualizarTotales();
    guardarBorrador();
  }

  function actualizarTotales() {
    const ti = $('#total-inc');
    if (ti) ti.innerHTML = textoTotalInc();
    const te = $('#total-ext');
    if (te) {
      const L = E.ctx.limites;
      const total = sumar(E.r.ext);
      $('strong', te).textContent = fmtH(total);
      te.classList.toggle('excedido', total > L.extra_semana + 1e-9);
    }
  }

  function marcarItem(input) {
    const item = input.closest('.item');
    const cod = item.dataset.act;
    const esInc = item.dataset.tipo === 'inc';
    const dic = esInc ? E.r.inc : E.r.ext;
    const s = semanaActual();
    if (input.checked) {
      dic[cod] = esInc ? { horas: Number(item.dataset.max), motivo: '', detalle: '' } : { horas: 1 };
    } else {
      delete dic[cod];
      if (!esInc && !s.plan.some(p => p.actividad === cod)) {   // actividad agregada fuera del horario: se quita de la lista
        $('#panel-extras').innerHTML = listaExtras();
        guardarBorrador();
        const sel = $('#otra-act'); if (sel) sel.focus();
        return;
      }
    }
    item.classList.toggle('activo', input.checked);
    const panel = $('.item-panel', item);
    panel.hidden = !input.checked;
    if (input.checked) {
      const h = $('[data-campo="horas"]', item);
      h.value = fmtN(dic[cod].horas);
    } else {
      ponerError($('[data-error]', item), '');
    }
    actualizarTotales();
    guardarBorrador();
  }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-accion]');
    if (!el || el.matches('input')) return;
    const a = el.dataset.accion;
    if (a === 'login-demo') loginDemo();
    else if (a === 'salir') salir();
    else if (a === 'reintentar') cargarContexto();
    else if (a === 'atras') atras();
    else if (a === 'ir') ir(el.dataset.paso);
    else if (a === 'semana-ok') elegirSemana();
    else if (a === 'sin-novedades') { E.r.tipo = 'sin_novedades'; guardarBorrador(); ir('revisar'); }
    else if (a === 'con-novedades') { E.r.tipo = 'detalle'; guardarBorrador(); ir('incumplimientos'); }
    else if (a === 'inc-ok') { if (validarIncumplimientos()) ir('extras'); }
    else if (a === 'ext-ok') { if (validarExtras()) ir('revisar'); }
    else if (a === 'cambiar-sin') { E.r = Object.assign(nuevoReporte(), { tipo: 'sin_novedades', comentario: E.r.comentario }); guardarBorrador(); ir('revisar'); }
    else if (a === 'enviar') enviar();
    else if (a === 'mas' || a === 'menos') ajustarHoras($('input', el.closest('.stepper')), a === 'mas' ? paso() : -paso());
    else if (a === 'copiar') copiarCodigo();
    else if (a === 'otra-semana') { E.r = nuevoReporte(); E.semana = null; E.rSemana = null; E.inicio = new Date().toISOString(); ir('semana'); }
    else if (a === 'terminar') { E.finNombre = primerNombre(); const n = E.finNombre; salir(); E.finNombre = n; ir('fin'); }
  });

  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.name === 'semana') {
      E.semana = t.value;
      $('#aviso-reemplazo').innerHTML = avisoReemplazo(semanaActual());
    } else if (t.dataset.accion === 'marcar') {
      marcarItem(t);
    } else if (t.name === 'hubo') {
      E.r.hubo = t.value === 'si';
      ponerError($('#error-hubo'), '');
      $('#sin-nada').hidden = true;
      const panel = $('#panel-extras');
      panel.hidden = !E.r.hubo;
      if (E.r.hubo && !panel.innerHTML.trim()) panel.innerHTML = listaExtras();
      guardarBorrador();
    } else if (t.dataset.campo === 'motivo') {
      const item = t.closest('.item');
      const v = E.r.inc[item.dataset.act];
      v.motivo = t.value;
      const req = motivoRequiere(v.motivo);
      const bloque = $('[data-bloque="detalle"]', item);
      bloque.hidden = !v.motivo;
      $('[data-opcional]', bloque).hidden = req;
      $('input', bloque).placeholder = req ? 'Cuéntanos brevemente qué pasó' : 'Ej.: reunión convocada por dirección';
      guardarBorrador();
    } else if (t.dataset.campo === 'otra' && t.value) {
      const cod = t.value;
      E.r.ext[cod] = { horas: 1 };
      $('#panel-extras').innerHTML = listaExtras();
      const nuevo = $(`.item[data-act="${CSS.escape(cod)}"] [data-campo="horas"]`, app);
      if (nuevo) nuevo.focus();
      toast(`Agregaste «${nombreActividad(cod)}»`);
      guardarBorrador();
    }
  });

  document.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.campo === 'horas') {
      const v = leerNumero(t.value);
      if (Number.isFinite(v)) guardarHoras(t, v);
    } else if (t.dataset.campo === 'detalle') {
      E.r.inc[t.closest('.item').dataset.act].detalle = t.value;
      guardarBorrador();
    } else if (t.dataset.campo === 'comentario') {
      E.r.comentario = t.value;
      $('#contador').textContent = `${t.value.length}/${E.ctx.limites.comentario}`;
      guardarBorrador();
    }
  });

  document.addEventListener('focusout', ev => {
    if (ev.target.dataset && ev.target.dataset.campo === 'horas') ajustarHoras(ev.target, 0);
  });

  function elegirSemana() {
    if (!E.semana) return;
    if (E.rSemana !== E.semana) {
      const b = leerBorrador(E.semana);
      E.r = b || nuevoReporte();
      E.rSemana = E.semana;
      if (b) toast('Recuperamos lo que habías avanzado en esta semana.');
    }
    ir('como');
  }

  async function copiarCodigo() {
    const codigo = $('#codigo').textContent;
    try {
      await navigator.clipboard.writeText(codigo);
    } catch (e) {
      const r = document.createRange();
      r.selectNodeContents($('#codigo'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('copy');
    }
    toast('Código copiado');
  }

  // ------------------------------------------------------------------------------------------- arranque
  actualizarSoporte();
  if (DEMO) document.title = '[Demo] ' + document.title;
  ir('inicio', false);
})();
