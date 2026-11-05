// Backend simulado para probar el formulario sin Google (se activa con ?demo=1 o ?demo=noregistrado).
// Imita las respuestas de backend/Code.gs. No se usa en producción.
window.MockAPI = (() => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const corta = d => `${d.getDate()} ${MESES[d.getMonth()]}`;
  const hoy = new Date();
  const lunesActual = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const inicioSemestre = new Date(2026, 7, 3);

  const actividades = [
    ['Clases P17', 'Clases Plan 2017'], ['Clases P26', 'Clases Plan 2026'], ['PrepClas', 'Preparación de clases'],
    ['CodPI', 'Codocencia PI'], ['ProyInteg', 'Proyecto Integrador'], ['AmisCrit', 'Amistad Crítica'],
    ['JEA', 'JEA'], ['Gestión P26', 'Gestión Plan 2026'], ['ReuCord', 'Reunión de Coordinación'],
    ['Actividades académicas', 'Actividades académicas'], ['Proyectos de investigación', 'Proyectos de investigación'],
    ['Transformación, Producción, Revisión', 'Transformación, Producción, Revisión'], ['AlmPuen', 'Almuerzo y Puentes'],
  ].map(([codigo, nombre], i) => ({ codigo, nombre, grupo: '', orden: i + 1 }));
  const nombre = Object.fromEntries(actividades.map(a => [a.codigo, a.nombre]));
  const plan = [['Clases P26', 12], ['Clases P17', 8], ['PrepClas', 6], ['ProyInteg', 4], ['ReuCord', 2], ['Gestión P26', 4], ['AlmPuen', 4]]
    .map(([actividad, horas]) => ({ actividad, nombre: nombre[actividad], horas }));
  const motivos = ['Cambio de actividades por superiores', 'Feriado', 'Taller / capacitación', 'Viaje institucional',
    'Conflicto de horario', 'Factores externos', 'Sin requerimiento / pendiente de aprobación', 'Otras tareas priorizadas',
    'Personal / salud', 'Clima laboral'].map(motivo => ({ motivo, requiere_detalle: false }))
    .concat([{ motivo: 'Otro', requiere_detalle: true }]);

  const semanas = [0, 1, 2].map(k => {
    const lunes = new Date(lunesActual); lunes.setDate(lunes.getDate() - 7 * k);
    const viernes = new Date(lunes); viernes.setDate(viernes.getDate() + 4);
    const nro = Math.floor((lunes - inicioSemestre) / (7 * 864e5)) + 1;
    return { semestre: 'II-26', nro, lunes: iso(lunes), viernes: iso(viernes),
             etiqueta: `Lun ${corta(lunes)} – Vie ${corta(viernes)}`, hito: nro <= 7 ? 'Hito 2' : nro <= 14 ? 'Hito 3' : 'Hito 4' };
  });
  const reportes = { [semanas[2].viernes]: { codigo: 'DTC-II26-4MQ7', fecha_envio: semanas[2].viernes + ' 17:42:10' } };

  const espera = ms => new Promise(r => setTimeout(r, ms));
  const alfabeto = 'ACDEFGHJKMNPQRTUVWXY3479';

  async function llamar(accion, datos) {
    await espera(accion === 'enviar' ? 900 : 700);
    if (new URLSearchParams(location.search).get('demo') === 'noregistrado') {
      return { ok: false, codigo_error: 'NO_REGISTRADO',
               error: 'La cuenta demo@unifranz.edu.bo no está registrada como docente de tiempo completo. ' +
                      'Prueba con tu otra cuenta institucional o escribe a neil.inclan@unifranz.edu.bo.' };
    }
    if (accion === 'contexto') {
      return {
        ok: true,
        docente: { nombre: 'María Fernanda Rojas Quiroga', sede: 'La Paz', carreras: 'Ingeniería de Sistemas; Ingeniería Comercial' },
        semanas: semanas.map((s, i) => Object.assign({}, s, { plan: i === 1 ? plan.slice(0, 6) : plan, reportada: reportes[s.viernes] || null })),
        actividades, motivos,
        limites: { paso: 0.5, extra_actividad: 20, extra_semana: 30, comentario: 1000 },
        soporte: 'neil.inclan@unifranz.edu.bo',
        mensaje: '',
      };
    }
    if (accion === 'enviar') {
      const s = semanas.find(x => x.viernes === datos.semana_viernes);
      if (!s) return { ok: false, codigo_error: 'SEMANA', error: 'Esa semana ya no está abierta para reportar. Elige otra.' };
      const reemplazo = reportes[s.viernes] ? reportes[s.viernes].codigo : '';
      let codigo = 'DTC-II26-';
      for (let i = 0; i < 4; i++) codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
      reportes[s.viernes] = { codigo, fecha_envio: iso(new Date()) };
      console.info('[demo] filas que se guardarían:', datos);
      return {
        ok: true, codigo, reemplazo, comprobante: true, email: 'demo@unifranz.edu.bo',
        resumen: {
          semana: s.etiqueta, sin_novedades: datos.tipo === 'sin_novedades',
          incumplimientos: (datos.incumplimientos || []).map(x => ({ nombre: nombre[x.actividad], horas: x.horas, motivo: x.motivo })),
          extras: (datos.extras || []).map(x => ({ nombre: nombre[x.actividad], horas: x.horas })),
        },
      };
    }
    return { ok: false, codigo_error: 'ACCION', error: 'Acción no reconocida.' };
  }

  return { llamar, email: 'demo@unifranz.edu.bo' };
})();
