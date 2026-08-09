/**
 * buscar.js — el catálogo completo, 1.324 ejercicios.
 *
 * No es una pantalla protagonista: existe para cuando querés mirar cómo se hace
 * algo o entender por qué el motor eligió lo que eligió. Por eso no permite
 * "armar tu rutina" — si la app deja armar rutinas a mano, el motor deja de
 * tener sentido y vuelve a ser una planilla con animaciones.
 */

import { h, vaciar, encabezado, aviso } from './componentes.js';
import { buscar, todos, meta } from '../dominio/catalogo.js';
import { PATRON } from '../dominio/modelo.js';

let filtroPatron = null;
let texto = '';

export function render(cont, { ir }) {
  vaciar(cont);
  cont.append(encabezado('Catálogo'));

  const resultados = h('div.lista-ej');

  const entrada = h('input.buscador', {
    type: 'search', placeholder: 'Buscar ejercicio…', value: texto,
    'aria-label': 'Buscar ejercicio',
    onInput: (e) => { texto = e.target.value; pintar(); },
  });

  const patrones = h('div.fichas', { style: 'margin:var(--e3) 0' },
    Object.entries(PATRON).map(([id, d]) => h('button.ficha', {
      type: 'button', 'aria-pressed': String(filtroPatron === id),
      onClick: (ev) => {
        filtroPatron = filtroPatron === id ? null : id;
        for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', 'false');
        if (filtroPatron) ev.currentTarget.setAttribute('aria-pressed', 'true');
        pintar();
      },
    }, d.nombre)));

  const conteo = h('p.chico');

  function pintar() {
    let lista = texto.trim() ? buscar(texto, 400) : todos();
    if (filtroPatron) lista = lista.filter((e) => e.p === filtroPatron);
    conteo.textContent = `${lista.length} ejercicios`;
    vaciar(resultados);
    for (const e of lista.slice(0, 60)) {
      resultados.append(h('button', { onClick: () => ir(`#/ejercicio/${e.id}`) },
        h('span.n', e.n),
        h('span.d', [PATRON[e.p]?.nombre, e.e, e.t].filter(Boolean).join(' · '))));
    }
    if (lista.length > 60) resultados.append(aviso(`Se muestran 60 de ${lista.length}. Afiná la búsqueda.`));
  }

  cont.append(entrada, patrones, conteo, resultados);
  pintar();

  const m = meta();
  if (m) {
    cont.append(h('div.separador'), h('p.chico',
      `Datos de ${m.fuente} · ${m.licencia_datos}. Animaciones: ${m.licencia_media}. `
      + 'El nombre en español y el patrón de movimiento los agrega Norte, no vienen en el dataset original.'));
  }
}
