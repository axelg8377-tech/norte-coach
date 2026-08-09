/**
 * inicio.js — la primera vez.
 *
 * Tres preguntas, no doce. Cada pregunta del onboarding es una oportunidad de
 * abandono, así que solo se pregunta lo que el motor necesita SÍ O SÍ para
 * decidir la primera sesión: cuántos días, con qué equipo, y qué buscás.
 *
 * Todo lo demás (experiencia, cargas iniciales, lesiones viejas, preferencias)
 * el sistema lo descubre solo con las primeras tres sesiones, que es más preciso
 * que preguntarlo: nadie sabe estimar su propio 1RM en un formulario.
 */

import { h, vaciar, fichas } from './componentes.js';
import * as estado from '../estado.js';
import { GRUPO_EQUIPO } from '../dominio/modelo.js';

const OBJETIVOS = [
  { id: 'fuerza', nombre: 'Más fuerte' },
  { id: 'hipertrofia', nombre: 'Más músculo' },
  { id: 'salud', nombre: 'Sostener el hábito' },
  { id: 'recomposicion', nombre: 'Bajar grasa sin perder músculo' },
];

export function render(cont, { ir }) {
  vaciar(cont);
  const datos = { diasPorSemana: 3, equipo: ['peso_corporal'], objetivo: 'fuerza' };

  cont.append(
    h('div', { style: 'padding-top:var(--e5)' },
      h('p.micro', 'Norte'),
      h('h1.titulo', { style: 'margin:var(--e3) 0' }, 'Un entrenador que decide por vos, y te dice por qué.'),
      h('p.cuerpo',
        'No es una app de rutinas. Cada día te pregunta cómo llegaste y arma la sesión con eso: '
        + 'si dormiste mal baja el volumen, si te duele el hombro no te propone press. '
        + 'Funciona sin internet y los datos no salen de tu teléfono.'),

      h('div.separador'),

      h('div.campo',
        h('span.micro', '¿Cuántos días por semana?'),
        h('div.fichas',
          [2, 3, 4, 5].map((n) => {
            const b = h('button.ficha', {
              type: 'button', 'aria-pressed': String(n === 3),
              onClick: (ev) => {
                for (const x of ev.currentTarget.parentElement.children) x.setAttribute('aria-pressed', 'false');
                ev.currentTarget.setAttribute('aria-pressed', 'true');
                datos.diasPorSemana = n;
              },
            }, `${n} días`);
            return b;
          }))),

      fichas({
        etiqueta: '¿Con qué entrenás?',
        opciones: Object.entries(GRUPO_EQUIPO).map(([id, nombre]) => ({ id, nombre })),
        seleccion: datos.equipo,
        onCambio: (v) => { datos.equipo = v.length ? v : ['peso_corporal']; },
      }),

      fichas({
        etiqueta: '¿Qué buscás?',
        opciones: OBJETIVOS,
        seleccion: [datos.objetivo],
        unica: true,
        onCambio: (v) => { datos.objetivo = v[0]; },
      }),

      h('p.chico',
        'Con esto alcanza. Las cargas las vamos a encontrar entrenando: '
        + 'pedirte que estimes tu máximo en un formulario daría un número peor que '
        + 'el que sale de la primera sesión.'),

      h('div.acciones',
        h('button.boton', {
          onClick: async () => {
            await estado.definirPerfil(datos);
            ir('#/hoy');
          },
        }, 'Empezar')),
    ),
  );
}
