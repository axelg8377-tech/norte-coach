/**
 * progreso.js — qué está pasando de verdad.
 *
 * Regla de la pantalla: nada que no pueda cambiar una decisión. Ni calorías
 * inventadas, ni medallas, ni "nivel 7".
 *
 * ─── v2 ─────────────────────────────────────────────────────────────────────
 * La v1 estaba ordenada por métrica: abría con "% de adherencia", un número que
 * solo significa algo si ya sabés cómo se calcula, y seguía con curvas de 1RM
 * dibujadas sin ejes ni valores. Contestaba preguntas que nadie se hace.
 *
 * Ahora está ordenada por PREGUNTA, y cada bloque cierra con qué hacer con eso:
 *   1. ¿Estoy más fuerte que hace un mes?
 *   2. ¿Estoy cumpliendo?          ← calendario, que se lee de un vistazo
 *   3. ¿Qué tengo flojo?
 *   4. ¿Qué aprendió el coach sobre mí?
 *
 * Y cuando todavía no hay datos, se muestra el CAMINO en vez del vacío. La v1
 * contestaba cuatro veces "todavía es pronto" y no decía cuánto falta.
 */

import { h, vaciar, cifra, encabezado, barraEquilibrio, señal, chispa, aviso } from './componentes.js';
import * as estado from '../estado.js';
import { equilibrio } from '../dominio/motor.js';
import { resumen as resumenBandit } from '../dominio/bandit.js';
import { porId } from '../dominio/catalogo.js';
import { estimar1RM } from '../dominio/progresion.js';
import { sumarDias, diasEntre } from '../dominio/modelo.js';

const SESIONES_PARA_CURVA = 3;

export function render(cont) {
  const p = estado.proyeccion();
  vaciar(cont);
  cont.append(encabezado('Progreso'));

  if (!p.hechas.length) {
    cont.append(
      h('h1.titulo', 'Acá todavía no hay nada.'),
      h('p.cuerpo', { style: 'margin-top:var(--e3)' },
        `Esta pantalla necesita ${SESIONES_PARA_CURVA} sesiones para decir algo que sirva. `
        + 'Llevás 0. Antes de eso, cualquier gráfico sería decoración.'),
      camino(0),
    );
    return;
  }

  // ── 1. ¿Estoy más fuerte? ─────────────────────────────────────────────────
  cont.append(h('h1.titulo', { style: 'font-size:var(--t-sub)' }, '¿Estoy más fuerte?'));

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
    .filter((x) => x.puntos.length >= SESIONES_PARA_CURVA)
    .sort((a, b) => b.puntos.length - a.puntos.length)
    .slice(0, 5);

  if (!conCurva.length) {
    cont.append(
      h('p.cuerpo', { style: 'margin-top:var(--e3)' },
        `Todavía no. Hace falta repetir un mismo ejercicio con carga ${SESIONES_PARA_CURVA} veces `
        + 'para que la comparación signifique algo.'),
      camino(p.hechas.length));
  } else {
    for (const c of conCurva) {
      const primero = c.puntos[0].valor;
      const ultimo = c.puntos[c.puntos.length - 1].valor;
      const delta = Math.round((ultimo - primero) * 10) / 10;
      const pct = primero ? Math.round((delta / primero) * 100) : 0;
      const semanas = Math.max(1, Math.round(diasEntre(c.puntos[0].dia, c.puntos[c.puntos.length - 1].dia) / 7));
      cont.append(h('div', { style: 'margin-bottom:var(--e4)' },
        h('div.entre',
          h('span.chico', c.nombre),
          h('span.chico', {
            style: `font-family:var(--fuente-num);${delta > 0 ? 'color:var(--brasa)' : ''}`,
          }, `${delta > 0 ? '+' : ''}${delta} kg · ${pct > 0 ? '+' : ''}${pct}%`)),
        chispa(c.puntos),
        h('p.micro', { style: 'color:var(--texto-3)' },
          `${primero} → ${ultimo} kg estimados en ${semanas} semana${semanas > 1 ? 's' : ''}`)));
    }
    const subiendo = conCurva.filter((c) => c.puntos[c.puntos.length - 1].valor > c.puntos[0].valor).length;
    cont.append(h('p.chico',
      `${subiendo} de ${conCurva.length} ejercicios subieron. `
      + (subiendo < conCurva.length
        ? 'En los que no, mirá el RIR que venís cargando: si es 0 en todas las series, no hay margen para subir y toca descargar.'
        : 'Estimación de 1RM con la fórmula de Epley sobre tu mejor serie. Es para ver tendencia, no un número para ir a levantar.')));
  }

  // ── 2. ¿Estoy cumpliendo? ─────────────────────────────────────────────────
  cont.append(
    h('div.separador'),
    h('h1.titulo', { style: 'font-size:var(--t-sub)' }, '¿Estoy cumpliendo?'),
    calendario(p),
    h('p.chico', { style: 'margin-top:var(--e3)' },
      `${p.adherencia ?? 0}% de adherencia en las últimas 4 semanas · ${p.hechas.length} sesiones en total`
      + (p.racha.actual ? ` · racha de ${p.racha.actual}` : ' · sin racha activa')),
  );

  if (p.senales.length) {
    cont.append(
      h('span.micro', { style: 'display:block;margin:var(--e4) 0 var(--e3)' }, 'Lo que estoy viendo'),
      h('div', p.senales.map(señal)));
  }

  // ── 3. ¿Qué tengo flojo? ──────────────────────────────────────────────────
  const eq = equilibrio(p.volumenSemanal);
  const descuidados = eq.filter((e) => e.estado === 'descuidado');
  cont.append(
    h('div.separador'),
    h('h1.titulo', { style: 'font-size:var(--t-sub)' }, '¿Qué tengo flojo?'),
    h('span.micro', { style: 'display:block;margin:var(--e3) 0' }, 'Series de esta semana, por patrón'),
    h('div', eq.map((e) => barraEquilibrio({
      nombre: e.nombre, series: e.series, estado: e.estado, maximo: 22,
    }))),
    h('p.chico', { style: 'margin-top:var(--e3)' },
      descuidados.length
        ? `${descuidados.map((d) => d.nombre.toLowerCase()).join(' y ')} está por debajo de 6 series. `
          + 'El hueco libre de las próximas sesiones va a ir ahí solo. Si querés forzarlo, pedímelo al coach y lo meto hoy.'
        : 'Todos los patrones están en rango. Esto es lo que evita que en dos años tengas '
          + 'un empuje fuerte y una espalda que no acompaña.'),
  );

  // ── 4. Qué aprendió el coach ──────────────────────────────────────────────
  const filas = resumenBandit(p.posteriores);
  const observaciones = filas.reduce((n, f) => n + f.intentos, 0);
  cont.append(
    h('div.separador'),
    h('h1.titulo', { style: 'font-size:var(--t-sub)' }, '¿Qué aprendí sobre vos?'),
  );

  if (!filas.some((f) => f.confiable)) {
    cont.append(aviso(
      `Llevo ${observaciones} observaciones y necesito 8 por estrategia antes de afirmar nada. `
      + `Faltan ${Math.max(1, 8 - observaciones)} sesiones cerradas. `
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

/**
 * Cuatro semanas de celdas. Es la única forma de contestar "¿estoy cumpliendo?"
 * sin que haya que entender de dónde sale un porcentaje.
 */
function calendario(p) {
  const porDia = new Map();
  for (const i of p.intentos) porDia.set(i.dia, i.hecha ? 'hecha' : 'fallada');

  const celdas = [];
  for (let n = 27; n >= 0; n--) {
    const dia = sumarDias(p.hoy, -n);
    const est = porDia.get(dia) || (dia === p.hoy ? 'hoy' : 'vacio');
    celdas.push(h('span.dia', {
      'data-estado': est,
      title: `${dia}: ${{ hecha: 'entrenaste', fallada: 'no fue', hoy: 'hoy', vacio: 'descanso' }[est]}`,
    }));
  }
  return h('div', { style: 'margin-top:var(--e3)' },
    h('div.calendario', celdas),
    h('div.pistas', h('span', 'hace 4 semanas'), h('span', 'hoy')));
}

/** El camino, cuando todavía no hay datos. Un vacío sin número no orienta. */
function camino(hechas) {
  const faltan = Math.max(0, SESIONES_PARA_CURVA - hechas);
  if (!faltan) return null;
  return h('div', { style: 'margin-top:var(--e4)' },
    h('div.barra', h('span', { style: `width:${(hechas / SESIONES_PARA_CURVA) * 100}%` })),
    h('p.chico', { style: 'margin-top:var(--e2)' },
      `${hechas} de ${SESIONES_PARA_CURVA} sesiones. Faltan ${faltan}.`));
}
