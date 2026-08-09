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
 */

import { h, vaciar, cifra, encabezado, hoja } from './componentes.js';
import * as estado from '../estado.js';
import { urlGif } from '../dominio/catalogo.js';

let inicioMs = null;

export function render(cont, { ir }) {
  const p = estado.proyeccion();
  const s = p.sesionHoy;
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
          render(cont, { ir });
        },
      }, 'Serie hecha'),
      h('button.boton.fantasma', { onClick: () => verDemo(activo) }, 'Cómo se hace'),
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

    h('div.acciones',
      h('button.boton.plano', { onClick: () => cerrarAntes(cont, p, s, ir) }, 'Terminar acá')),
  );
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

function final(cont, p, s, ir, parcial = false) {
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
