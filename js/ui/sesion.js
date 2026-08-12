/**
 * sesion.js — la ejecución. La pantalla que se mira con el celular apoyado
 * en un banco, sudado, entre serie y serie.
 *
 * Restricciones que ordenan todo el diseño de esta pantalla:
 *   - Se toca con una mano y con los dedos torpes → nada menor a 48px.
 *   - Se mira dos segundos → un solo dato grande: qué ejercicio y qué serie.
 *   - Los números se precargan con lo que hiciste la última vez. Registrar una
 *     serie tiene que costar UN toque cuando repetís lo mismo, que es el 80%
 *     de los casos. Si registrar cuesta trabajo, se deja de registrar, y sin
 *     registro no hay progresión ni coach.
 *   - Nunca se pierde nada: cada serie es un evento en cuanto se toca el botón.
 *     Si se cierra la app a mitad, al volver está todo.
 *
 * ─── v2 ─────────────────────────────────────────────────────────────────────
 *   - Temporizador de descanso con MARCA DE TIEMPO ABSOLUTA. Con `setTimeout` a
 *     secas, la cuenta se congela cuando se apaga la pantalla y el temporizador
 *     miente. Uno que miente es peor que ninguno.
 *   - Sustituir el ejercicio, que es lo que hace falta cuando la máquina está
 *     ocupada. La v1 solo dejaba saltearlo, y saltear castiga el historial.
 *   - Salida honesta: descartar la sesión sin que cuente como hecha. En la v1
 *     "Terminar acá" con dos series entraba como sesión completa y ensuciaba
 *     adherencia, bandit y progresión.
 */

import { h, vaciar, cifra, encabezado, hoja } from './componentes.js';
import * as estado from '../estado.js';
import { urlGif } from '../dominio/catalogo.js';
import { alternativas, sustituir } from '../dominio/motor.js';
import { panelCoach } from './coach.js';

let inicioMs = null;
let descansoHasta = null;
let reloj = null;

function pararReloj() {
  if (reloj) { clearInterval(reloj); reloj = null; }
}

export function render(cont, { ir }) {
  const p = estado.proyeccion();
  const s = p.sesionHoy;
  pararReloj();
  vaciar(cont);

  if (!s?.plan) { ir('#/hoy'); return; }
  if (s.terminada || s.saltada) { ir('#/hoy'); return; }
  inicioMs ||= Date.now();

  const bloques = s.plan.bloques;
  const hechasPorEj = new Map();
  for (const serie of s.series) {
    hechasPorEj.set(serie.ejercicioId, (hechasPorEj.get(serie.ejercicioId) || 0) + 1);
  }

  // El bloque activo es el primero que todavía no completó sus series.
  const activo = bloques.find((b) => (hechasPorEj.get(b.ejercicio.id) || 0) < b.series);

  cont.append(encabezado(`${s.series.length} series · ${bloques.length} ejercicios`));

  if (!activo) return final(cont, p, s, ir);

  const yaHechas = hechasPorEj.get(activo.ejercicio.id) || 0;
  const ultima = [...s.series].reverse().find((x) => x.ejercicioId === activo.ejercicio.id);

  // Valores por defecto: lo de la serie anterior de hoy, o lo prescrito.
  const valores = {
    reps: ultima?.reps ?? activo.repsObjetivo[1],
    carga: ultima?.carga ?? activo.carga ?? 0,
    rir: ultima?.rir ?? 2,
  };

  const campo = (clave, etiqueta, paso, min) => {
    const input = h('input', {
      type: 'number', inputmode: 'decimal', step: String(paso), min: String(min),
      value: String(valores[clave]), id: `c_${clave}`,
      onInput: (e) => { valores[clave] = Number(e.target.value); },
    });
    return h('div.entrada', h('label', { for: `c_${clave}` }, etiqueta), input);
  };

  cont.append(
    descanso(activo),

    h('div.serie-actual',
      h('p.micro', activo.patronNombre),
      h('h1.titulo', { style: 'margin:var(--e2) 0 var(--e4)' }, activo.ejercicio.n),
      cifra(`${yaHechas + 1}/${activo.series}`, 'serie', 'brasa'),
      h('p.chico', { style: 'margin-top:var(--e3)' },
        `Objetivo: ${activo.repsObjetivo[0]}-${activo.repsObjetivo[1]} reps` +
        (activo.carga ? ` con ${activo.carga} kg` : '')),
      h('div.series-hechas',
        Array.from({ length: activo.series }, (_, i) =>
          h('span.punto-serie', { 'data-hecha': String(i < yaHechas) })))),

    h('div.entradas',
      campo('reps', 'Reps', 1, 0),
      campo('carga', 'Kg', 0.5, 0),
      campo('rir', 'RIR', 1, 0)),

    h('p.chico.centro', { style: 'margin-top:calc(-1 * var(--e2))' },
      'RIR = cuántas te quedaban. 0 es fallo.'),

    h('div.acciones',
      h('button.boton', {
        onClick: async () => {
          await estado.registrarSerie({
            sesionId: s.sesionId,
            ejercicioId: activo.ejercicio.id,
            patron: activo.patron,
            rol: activo.rol,
            serie: yaHechas + 1,
            reps: valores.reps,
            carga: valores.carga,
            rir: valores.rir,
          });
          // El descanso arranca cuando termina la serie, no cuando se pinta la
          // pantalla: se guarda el instante en que vence, no cuánto falta.
          descansoHasta = Date.now() + (activo.descanso ?? 90) * 1000;
          render(cont, { ir });
        },
      }, 'Serie hecha'),
      h('button.boton.fantasma', { onClick: () => verDemo(activo) }, 'Cómo se hace'),
      h('button.boton.fantasma', { onClick: () => cambiarEjercicio(cont, p, s, activo, ir) },
        'Cambiar este ejercicio'),
      h('button.boton.plano', { onClick: () => saltarEjercicio(cont, s, activo, ir) },
        'Saltear este ejercicio')),

    h('div.separador'),
    h('span.micro', { style: 'display:block;margin-bottom:var(--e2)' }, 'Lo que queda'),
    h('div',
      bloques.filter((b) => b !== activo).map((b) => {
        const n = hechasPorEj.get(b.ejercicio.id) || 0;
        return h('div.entre', { style: 'padding:var(--e1) 0' },
          h('span.chico', b.ejercicio.n),
          h('span.chico', { style: n >= b.series ? 'color:var(--brasa)' : '' }, `${n}/${b.series}`));
      })),

    panelCoach({ p, plan: s.plan, bloqueActivo: activo }),

    h('div.acciones.secundarias',
      h('button.boton.plano', { onClick: () => cerrarAntes(cont, p, s, ir) }, 'Terminar acá'),
      h('button.boton.plano', { onClick: () => descartar(cont, s, ir) }, 'Descartar la sesión')),
  );

  // ── Temporizador ──────────────────────────────────────────────────────────
  function descanso(bloque) {
    const total = bloque.descanso ?? 90;
    if (!descansoHasta) return null;
    const restante = () => Math.max(0, Math.round((descansoHasta - Date.now()) / 1000));
    if (!restante()) { descansoHasta = null; return null; }

    const numero = h('span.numero', String(restante()));
    const barra = h('span');
    const caja = h('div.descanso',
      h('div.entre',
        h('span.micro', 'Descanso'),
        h('button.enlace', {
          onClick: () => { descansoHasta = null; pararReloj(); caja.remove(); },
        }, 'Saltar')),
      h('div.entre', numero, h('span.chico', `de ${total}s`)),
      h('div.barra', barra));

    const pintar = () => {
      const r = restante();
      numero.textContent = String(r);
      barra.style.width = `${Math.max(0, (r / total) * 100)}%`;
      if (r <= 0) {
        pararReloj();
        descansoHasta = null;
        numero.textContent = 'listo';
        caja.dataset.terminado = 'true';
        navigator.vibrate?.(200);
      }
    };
    pintar();
    // Se recalcula contra Date.now() en cada tick, así que apagar la pantalla no
    // atrasa la cuenta: al volver, el número ya es el correcto.
    reloj = setInterval(pintar, 500);
    return caja;
  }
}

function verDemo(bloque) {
  const gif = urlGif(bloque.ejercicio);
  hoja(() => h('div',
    h('h2.titulo', { style: 'font-size:var(--t-sub);margin-bottom:var(--e3)' }, bloque.ejercicio.n),
    gif ? h('img.demo', {
      src: gif, alt: `Demostración de ${bloque.ejercicio.n}`, loading: 'lazy',
      onerror: 'this.style.display="none"',
    }) : null,
    h('p.chico', { style: 'margin-bottom:var(--e3)' },
      gif ? 'La animación necesita internet la primera vez. Después queda guardada.' : ''),
    h('div', { id: 'pasos-demo' }, h('p.chico', 'Cargando instrucciones…')),
    h('p.chico', { style: 'margin-top:var(--e3);color:var(--texto-tenue)' }, bloque.ejercicio.en),
  ));

  import('../dominio/catalogo.js').then(async (cat) => {
    const pasos = await cat.instrucciones(bloque.ejercicio.id);
    const destino = document.getElementById('pasos-demo');
    if (!destino) return;
    vaciar(destino);
    destino.append(pasos
      ? h('ol.pasos', pasos.map((t) => h('li', h('span', t))))
      : h('p.chico', 'No hay instrucciones para este ejercicio.'));
  });
}

/**
 * Sustituir el ejercicio del bloque activo. La prescripción se recalcula contra
 * el historial del ejercicio NUEVO: arrastrar la carga del anterior sería la
 * forma más rápida de sugerir una barbaridad.
 */
function cambiarEjercicio(cont, p, s, activo, ir) {
  const equipoDisponible = p.checkHoy?.equipoHoy?.length ? p.checkHoy.equipoHoy : (p.perfil?.equipo || ['peso_corporal']);
  const opciones = alternativas(activo, {
    equipoDisponible,
    vecesHecho: p.vecesHecho,
    yaEnLaSesion: new Set(s.plan.bloques.map((b) => b.ejercicio.id)),
  });

  hoja((cerrar) => h('div',
    h('h2.titulo', { style: 'font-size:var(--t-sub)' }, 'Cambiar el ejercicio'),
    h('p.chico', { style: 'margin:var(--e2) 0 var(--e3)' },
      `Mismo patrón (${activo.patronNombre.toLowerCase()}) y mismo equipo. Las series y las repeticiones no cambian; la carga se recalcula con tu historial del ejercicio nuevo.`),
    opciones.length
      ? h('div.lista-ej', opciones.map((e) => h('button', {
        onClick: async () => {
          const nuevo = sustituir(activo, e, { historial: p.historial, vecesHecho: p.vecesHecho });
          await estado.sustituirBloque(s.sesionId, activo.hueco, nuevo);
          cerrar();
          render(cont, { ir });
        },
      }, h('span.n', e.n), h('span.d', [e.e, e.t].filter(Boolean).join(' · ')))))
      : h('p.chico', 'No hay otra opción de ese patrón con el equipo de hoy.')));
}

function saltarEjercicio(cont, s, activo, ir) {
  // Saltar no borra el bloque: registra las series faltantes con reps 0, para que
  // el historial diga la verdad. Un ejercicio que "no aparece" en el registro es
  // indistinguible de uno que nunca se programó, y eso rompe el diagnóstico.
  const yaHechas = s.series.filter((x) => x.ejercicioId === activo.ejercicio.id).length;
  (async () => {
    for (let i = yaHechas; i < activo.series; i++) {
      await estado.registrarSerie({
        sesionId: s.sesionId, ejercicioId: activo.ejercicio.id,
        patron: activo.patron, rol: activo.rol, serie: i + 1,
        reps: 0, carga: 0, rir: null, salteada: true,
      });
    }
    render(cont, { ir });
  })();
}

function cerrarAntes(cont, p, s, ir) {
  hoja((cerrar) => h('div',
    h('h2.titulo', { style: 'font-size:var(--t-sub)' }, '¿Cerramos acá?'),
    h('p.chico', { style: 'margin:var(--e2) 0 var(--e4)' },
      `Llevás ${s.series.length} series. Cuenta como sesión hecha: media sesión registrada vale más que una entera que no pasó.`),
    h('div.pila',
      h('button.boton', { onClick: () => { cerrar(); final(cont, p, s, ir, true); } }, 'Sí, cerrar'),
      h('button.boton.fantasma', { onClick: cerrar }, 'Sigo'))));
}

/**
 * Descartar: la sesión no pasó. No cuenta como hecha ni como fallada, no
 * alimenta al bandit y no toca la adherencia. Las series ya registradas quedan
 * en el log, pero colgadas de una sesión descartada, así que ninguna proyección
 * las mira.
 */
function descartar(cont, s, ir) {
  hoja((cerrar) => h('div',
    h('h2.titulo', { style: 'font-size:var(--t-sub)' }, 'Descartar la sesión'),
    h('p.chico', { style: 'margin:var(--e2) 0 var(--e4)' },
      s.series.length
        ? `Llevás ${s.series.length} series y se van a descartar con la sesión. No cuenta como hecha ni como fallada: es como si no hubiera pasado. Volvés a la propuesta del día.`
        : 'No cuenta como hecha ni como fallada. Volvés a la propuesta del día.'),
    h('div.pila',
      h('button.boton.alerta', {
        onClick: async () => {
          await estado.descartarSesion(s.sesionId, 'descartada_en_curso');
          pararReloj();
          descansoHasta = null;
          inicioMs = null;
          cerrar();
          ir('#/hoy');
        },
      }, 'Descartar'),
      h('button.boton.fantasma', { onClick: cerrar }, 'Cancelar'))));
}

function final(cont, p, s, ir, parcial = false) {
  pararReloj();
  descansoHasta = null;
  vaciar(cont);
  const minutos = inicioMs ? Math.max(1, Math.round((Date.now() - inicioMs) / 60000)) : null;
  let percepcion = 3;

  cont.append(
    encabezado('Cerrando'),
    h('h1.titulo', parcial ? 'Cortaste, y está bien.' : 'Terminaste.'),
    h('div', { style: 'margin:var(--e5) 0' }, cifra(s.series.length, 'series', 'brasa')),
    h('p.cuerpo', minutos ? `${minutos} minutos.` : ''),
    h('div', { style: 'margin-top:var(--e5)' },
      h('span.micro', { style: 'display:block;margin-bottom:var(--e2)' }, '¿Cuánto costó?'),
      h('div.escala', { role: 'group', 'aria-label': 'Esfuerzo percibido' },
        [1, 2, 3, 4, 5].map((n) => h('button', {
          type: 'button', 'aria-pressed': String(n === 3),
          'aria-label': `Esfuerzo ${n} de 5`,
          onClick: (ev) => {
            for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', 'false');
            ev.currentTarget.setAttribute('aria-pressed', 'true');
            percepcion = n;
          },
        }, String(n)))),
      h('div.pistas', h('span', 'muy fácil'), h('span', 'no podía más'))),
    h('div.acciones',
      h('button.boton', {
        onClick: async () => {
          await estado.terminarSesion(s.sesionId, { duracionMin: minutos, percepcion, parcial });
          inicioMs = null;
          ir('#/hoy');
        },
      }, 'Guardar')),
  );
}
