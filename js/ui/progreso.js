/**
 * progreso.js — qué está pasando de verdad.
 *
 * Regla de la pantalla: nada que no pueda cambiar una decisión. Ni calorías
 * inventadas, ni medallas, ni "nivel 7". Cuatro cosas, en este orden:
 *   1. Adherencia — el único número que predice el resultado a un año.
 *   2. Señales de recaída — lo accionable.
 *   3. Equilibrio por patrón — lo que evita el desbalance que se paga en 3 años.
 *   4. Qué aprendió el coach sobre vos — con los datos a la vista, no como magia.
 */

import { h, vaciar, cifra, encabezado, barraEquilibrio, señal, chispa, aviso } from './componentes.js';
import * as estado from '../estado.js';
import { equilibrio } from '../dominio/motor.js';
import { resumen as resumenBandit } from '../dominio/bandit.js';
import { porId } from '../dominio/catalogo.js';
import { estimar1RM } from '../dominio/progresion.js';

export function render(cont) {
  const p = estado.proyeccion();
  vaciar(cont);
  cont.append(encabezado('Progreso'));

  if (!p.hechas.length) {
    cont.append(
      h('h1.titulo', 'Todavía no hay nada que mostrar.'),
      h('p.cuerpo', { style: 'margin-top:var(--e3)' },
        'Después de tres sesiones esta pantalla empieza a tener sentido. Antes de eso, '
        + 'cualquier gráfico sería decoración.'));
    return;
  }

  // ── 1. Adherencia ─────────────────────────────────────────────────────────
  cont.append(
    h('div', { style: 'margin-bottom:var(--e5)' },
      cifra(p.adherencia ?? 0, '% de adherencia', 'brasa'),
      h('p.chico', { style: 'margin-top:var(--e3)' },
        `Últimas 4 semanas · ${p.hechas.length} sesiones en total`
        + (p.racha.actual ? ` · racha de ${p.racha.actual}` : ' · sin racha activa'))),
  );

  // ── 2. Señales ────────────────────────────────────────────────────────────
  if (p.senales.length) {
    cont.append(
      h('span.micro', { style: 'display:block;margin-bottom:var(--e3)' }, 'Lo que estoy viendo'),
      h('div', { style: 'margin-bottom:var(--e5)' }, p.senales.map(señal)));
  }

  // ── 3. Equilibrio por patrón ──────────────────────────────────────────────
  const eq = equilibrio(p.volumenSemanal);
  const descuidados = eq.filter((e) => e.estado === 'descuidado');
  cont.append(
    h('div.separador'),
    h('span.micro', { style: 'display:block;margin-bottom:var(--e3)' }, 'Volumen de la semana, por patrón'),
    h('div', eq.map((e) => barraEquilibrio({
      nombre: e.nombre, series: e.series, estado: e.estado, maximo: 22,
    }))),
    h('p.chico', { style: 'margin-top:var(--e3)' },
      descuidados.length
        ? `${descuidados.map((d) => d.nombre.toLowerCase()).join(' y ')} está por debajo de 6 series. `
          + 'El hueco libre de las próximas sesiones va a ir ahí solo.'
        : 'Todos los patrones están en rango. Esto es lo que evita que en dos años tengas '
          + 'un empuje fuerte y una espalda que no acompaña.'),
  );

  // ── 4. Ejercicios con progreso medible ────────────────────────────────────
  const conCurva = Object.entries(p.historial)
    .map(([id, hist]) => ({
      id,
      nombre: porId(id)?.n || id,
      puntos: hist.sesiones.map((s) => ({
        dia: s.dia,
        valor: s.series.reduce((m, x) => {
          const e = estimar1RM(x.carga, x.reps);
          return e && (!m || e > m) ? e : m;
        }, null),
      })).filter((x) => x.valor),
    }))
    .filter((x) => x.puntos.length >= 3)
    .sort((a, b) => b.puntos.length - a.puntos.length)
    .slice(0, 5);

  if (conCurva.length) {
    cont.append(
      h('div.separador'),
      h('span.micro', { style: 'display:block;margin-bottom:var(--e3)' }, 'Fuerza estimada'),
      ...conCurva.map((c) => {
        const primero = c.puntos[0].valor;
        const ultimo = c.puntos[c.puntos.length - 1].valor;
        const delta = Math.round((ultimo - primero) * 10) / 10;
        return h('div', { style: 'margin-bottom:var(--e4)' },
          h('div.entre',
            h('span.chico', c.nombre),
            h('span.chico', {
              style: delta > 0 ? 'color:var(--brasa);font-family:var(--fuente-num)' : 'font-family:var(--fuente-num)',
            }, `${delta > 0 ? '+' : ''}${delta} kg`)),
          chispa(c.puntos));
      }),
      h('p.chico', 'Estimación de 1RM con la fórmula de Epley sobre tu mejor serie. '
        + 'Es una estimación para ver tendencia, no un número para ir a levantar.'),
    );
  }

  // ── 5. Qué aprendió el coach ──────────────────────────────────────────────
  const filas = resumenBandit(p.posteriores);
  cont.append(
    h('div.separador'),
    h('span.micro', { style: 'display:block;margin-bottom:var(--e3)' }, 'Qué aprendí sobre vos'),
  );

  if (!filas.some((f) => f.confiable)) {
    cont.append(aviso(
      `Todavía no lo suficiente. Llevo ${filas.reduce((n, f) => n + f.intentos, 0)} observaciones `
      + 'y necesito al menos 8 por estrategia antes de afirmar nada. '
      + 'Prefiero decirte esto antes que mostrarte un porcentaje de dos datos.'));
  } else {
    for (const f of filas.filter((x) => x.confiable)) {
      cont.append(h('div.entre', { style: 'padding:var(--e1) 0' },
        h('span.chico', `${f.nombre} · ${f.contexto === 'dificil' ? 'días difíciles' : 'días normales'}`),
        h('span.chico', { style: 'font-family:var(--fuente-num)' },
          `${Math.round(f.tasa * 100)}% · ${f.intentos}`)));
    }
    const mejor = filas.filter((x) => x.confiable).sort((a, b) => b.tasa - a.tasa)[0];
    cont.append(h('p.chico', { style: 'margin-top:var(--e3)' },
      `Aparecés más cuando te lo planteo desde "${mejor.nombre.toLowerCase()}". `
      + 'Por eso lo uso más seguido — pero sigo probando los otros, porque lo que funciona cambia.'));
  }
}
