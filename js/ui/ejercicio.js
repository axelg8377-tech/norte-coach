/**
 * ejercicio.js — el detalle de un ejercicio.
 *
 * Muestra el nombre original en inglés a propósito: los nombres en español los
 * genera un glosario determinista y ninguna traducción automática es perfecta.
 * Si algo suena raro, se puede verificar contra la fuente sin salir de la app.
 */

import { h, vaciar, encabezado, chispa } from './componentes.js';
import { porId, instrucciones, urlGif } from '../dominio/catalogo.js';
import { PATRON } from '../dominio/modelo.js';
import * as estado from '../estado.js';

export function render(cont, { ir, params }) {
  const ej = porId(params.id);
  vaciar(cont);
  cont.append(encabezado('Ejercicio'));

  if (!ej) {
    cont.append(h('p.cuerpo', 'No existe ese ejercicio.'),
      h('div.acciones', h('button.boton.fantasma', { onClick: () => ir('#/catalogo') }, 'Volver al catálogo')));
    return;
  }

  const gif = urlGif(ej);
  cont.append(
    h('h1.titulo', ej.n),
    h('p.chico', { style: 'margin:var(--e2) 0 var(--e4)' },
      [PATRON[ej.p]?.nombre, ej.c ? 'compuesto' : 'aislamiento', ej.e, ej.z].filter(Boolean).join(' · ')),
    gif ? h('img.demo', { src: gif, alt: `Demostración de ${ej.n}`, loading: 'lazy' }) : null,
  );

  // Historial propio, si lo hay. Es lo que convierte una ficha de catálogo en
  // información útil: qué levantaste vos, no qué músculo trabaja.
  const hist = estado.proyeccion()?.historial?.[ej.id];
  if (hist?.sesiones?.length) {
    const puntos = estado.curva1RM(ej.id);
    const ultimas = hist.sesiones.slice(-5).reverse();
    cont.append(
      h('div.separador'),
      h('span.micro', { style: 'display:block;margin-bottom:var(--e2)' },
        `Tu historial · ${hist.sesiones.length} sesiones`),
      puntos.length >= 3 ? chispa(puntos) : null,
      h('div', { style: 'margin-top:var(--e3)' }, ultimas.map((s) => h('div.entre', { style: 'padding:var(--e1) 0' },
        h('span.chico', s.dia),
        h('span.chico', { style: 'font-family:var(--fuente-num)' },
          s.series.map((x) => `${x.reps}×${x.carga || '—'}`).join('  '))))),
      hist.estancado >= 2
        ? h('p.chico', { style: 'color:var(--brasa);margin-top:var(--e2)' },
          `${hist.estancado} sesiones sin subir carga. Una más y programo una descarga del 10%.`)
        : null,
    );
  }

  const pasos = h('div', { style: 'margin-top:var(--e4)' }, h('p.chico', 'Cargando…'));
  cont.append(h('div.separador'), h('span.micro', 'Cómo se hace'), pasos);
  instrucciones(ej.id).then((lista) => {
    vaciar(pasos);
    pasos.append(lista
      ? h('ol.pasos', lista.map((t) => h('li', h('span', t))))
      : h('p.chico', 'Este ejercicio no tiene instrucciones en el dataset.'));
  });

  cont.append(
    h('div.separador'),
    h('p.chico', { style: 'color:var(--texto-tenue)' }, `Nombre original: ${ej.en}`),
    h('div.acciones', h('button.boton.fantasma', { onClick: () => history.back() }, 'Volver')),
  );
}
