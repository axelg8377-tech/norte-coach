/**
 * buscar.js — el catálogo completo, 1.324 ejercicios.
 *
 * En la v1 esta pantalla era de solo mirar, a propósito: si la app deja armar
 * rutinas a mano, el motor deja de tener sentido. Axel la usó en un gimnasio y
 * pidió lo contrario, así que la decisión se reabrió el 2026-08-11 — acotada.
 *
 * Cómo se reabre sin matar al motor: desde acá se elige QUÉ, y el motor sigue
 * diciendo cuántas series, cuántas repeticiones y con cuánto peso, y escribe el
 * diagnóstico de lo que estás dejando afuera. Las sesiones armadas a mano quedan
 * marcadas con `origen: 'manual'` para poder comparar adherencia y equilibrio
 * contra las del motor a las 20 sesiones. El dato cierra la discusión, no la
 * opinión.
 *
 * La búsqueda en sí también se rehizo: la v1 hacía `includes()` del texto
 * completo y cortaba la lista ANTES de ordenarla, así que devolvía los primeros
 * del archivo y no los mejores.
 */

import { h, vaciar, encabezado } from './componentes.js';
import { buscar, todos, meta, zonas, porId } from '../dominio/catalogo.js';
import { PATRON, GRUPO_EQUIPO } from '../dominio/modelo.js';
import { bloqueDe } from '../dominio/motor.js';
import * as estado from '../estado.js';
import { crearSesionManual } from './hoy.js';

let filtroPatron = null;
let filtroEquipo = null;
let filtroZona = null;
let texto = '';
let seleccion = [];

export function render(cont, { ir, params = {} }) {
  const armando = params.id === 'armar';
  const p = estado.proyeccion();
  const sesion = p.sesionHoy;
  const puedeAgregar = !armando && sesion?.plan && !sesion.terminada && !sesion.saltada;

  if (!armando) seleccion = [];
  vaciar(cont);
  cont.append(encabezado(armando ? 'Armá la sesión' : 'Catálogo'));

  if (armando) {
    cont.append(
      h('h1.titulo', { style: 'font-size:var(--t-sub)' }, 'Elegí los ejercicios'),
      h('p.chico', { style: 'margin:var(--e2) 0 var(--e3)' },
        'Vos elegís cuáles. Las series, las repeticiones y la carga las sigo calculando '
        + 'con tu historial, y al final te digo qué patrón estás dejando afuera.'));
  }

  const resultados = h('div.lista-ej');
  const conteo = h('p.chico');
  const bandeja = h('div.bandeja', { hidden: true });

  const entrada = h('input.buscador', {
    type: 'search', placeholder: 'press banca, sentadilla, dorsal…', value: texto,
    'aria-label': 'Buscar ejercicio',
    onInput: (e) => { texto = e.target.value; pintar(); },
  });

  const grupoFichas = (etiqueta, opciones, valorActual, alElegir) => h('div.campo',
    h('span.micro', etiqueta),
    h('div.fichas', opciones.map(([id, nombre]) => h('button.ficha', {
      type: 'button', 'aria-pressed': String(valorActual() === id),
      onClick: (ev) => {
        const nuevo = valorActual() === id ? null : id;
        alElegir(nuevo);
        for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', 'false');
        if (nuevo) ev.currentTarget.setAttribute('aria-pressed', 'true');
        pintar();
      },
    }, nombre))));

  const filtros = h('div',
    grupoFichas('Patrón', Object.entries(PATRON).map(([id, d]) => [id, d.nombre]),
      () => filtroPatron, (v) => { filtroPatron = v; }),
    grupoFichas('Equipo', Object.entries(GRUPO_EQUIPO),
      () => filtroEquipo, (v) => { filtroEquipo = v; }),
    grupoFichas('Zona', zonas().map((z) => [z, z]),
      () => filtroZona, (v) => { filtroZona = v; }));

  function pintar() {
    const lista = buscar(texto, {
      limite: 60,
      patron: filtroPatron,
      equipo: filtroEquipo ? [filtroEquipo] : null,
      zona: filtroZona,
    });
    const total = texto.trim() || filtroPatron || filtroEquipo || filtroZona
      ? null
      : todos().length;

    conteo.textContent = lista.length
      ? `${lista.length}${lista.length === 60 ? ' mejores' : ''} de ${total ?? 'los que coinciden'}`
      : 'Ningún ejercicio coincide. Sacá un filtro o probá con otra palabra.';

    vaciar(resultados);
    for (const e of lista) {
      const fila = h('button', {
        onClick: () => {
          if (armando) alternar(e.id, fila);
          else ir(`#/ejercicio/${e.id}`);
        },
      },
      h('span.n', e.n),
      h('span.d', [PATRON[e.p]?.nombre, e.e, e.t].filter(Boolean).join(' · ')));
      if (armando) fila.dataset.elegido = String(seleccion.includes(e.id));

      if (puedeAgregar) {
        const yaEsta = sesion.plan.bloques.some((b) => b.ejercicio.id === e.id);
        resultados.append(h('div.fila-ej', fila,
          h('button.boton.compacto', {
            disabled: yaEsta,
            onClick: async () => {
              const bloque = bloqueDe(e, {
                historial: p.historial, vecesHecho: p.vecesHecho,
                indice: sesion.plan.bloques.length,
              });
              await estado.agregarBloque(sesion.sesionId, bloque);
              ir('#/hoy');
            },
          }, yaEsta ? 'ya está' : '+ hoy')));
      } else {
        resultados.append(fila);
      }
    }
  }

  function alternar(id, fila) {
    if (seleccion.includes(id)) seleccion = seleccion.filter((x) => x !== id);
    else seleccion.push(id);
    fila.dataset.elegido = String(seleccion.includes(id));
    pintarBandeja();
  }

  function pintarBandeja() {
    vaciar(bandeja);
    bandeja.hidden = !seleccion.length;
    if (!seleccion.length) return;
    bandeja.append(
      h('p.chico', seleccion.map((id) => porId(id)?.n).filter(Boolean).join(' · ')),
      h('div.acciones',
        h('button.boton', {
          onClick: async () => {
            await crearSesionManual(seleccion);
            seleccion = [];
            ir('#/hoy');
          },
        }, `Armar la sesión (${seleccion.length})`),
        h('button.boton.plano', {
          onClick: () => { seleccion = []; pintar(); pintarBandeja(); },
        }, 'Vaciar')));
  }

  cont.append(entrada, filtros, conteo, resultados, bandeja);
  pintar();
  pintarBandeja();

  if (!armando) {
    const m = meta();
    if (m) {
      cont.append(h('div.separador'), h('p.chico',
        `Datos de ${m.fuente} · ${m.licencia_datos}. Animaciones: ${m.licencia_media}. `
        + 'El nombre en español y el patrón de movimiento los agrega Norte, no vienen en el dataset original.'));
    }
  }
}
