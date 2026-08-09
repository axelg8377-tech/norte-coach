/**
 * bandit.js — lo único que el sistema realmente aprende de vos.
 *
 * ─── Por qué esto y no aprendizaje por refuerzo de verdad ────────────────────
 * El pedido mencionaba Gymnasium. Gymnasium es Python y no corre en un navegador,
 * pero el problema de fondo es otro: el RL profundo necesita del orden de 10.000
 * episodios para converger. Un episodio acá es un día. Serían 27 años.
 *
 * Lo que sí funciona con pocos datos es un bandit contextual con priors: 4 brazos,
 * ~150 decisiones al año, y una recompensa binaria clara. En un año hay señal
 * suficiente para separar los brazos buenos de los malos, y con priors informados
 * el sistema arranca razonable desde el día 1 en vez de explorar a ciegas.
 *
 * Se conserva del contrato de Gymnasium lo que sirve: observación → política →
 * acción → recompensa, con el motor como función pura. Eso es reutilizable el día
 * que haya datos para algo más ambicioso.
 *
 * ─── Qué se aprende exactamente ──────────────────────────────────────────────
 * NO se aprende qué entrenar (eso son reglas, ver progresion.js).
 * Se aprende CÓMO PEDÍRTELO para que aparezcas. La recompensa es binaria:
 * ¿hiciste la sesión, sí o no? Es observable, inmediata y no admite interpretación.
 *
 * Muestreo de Thompson sobre una Beta por brazo. Se elige Thompson y no epsilon-greedy
 * porque explora en proporción a la incertidumbre: un brazo con 2 datos se prueba
 * seguido, uno con 40 datos y mal resultado deja de aparecer. Con pocos datos, eso
 * importa más que la diferencia de rendimiento asintótico.
 */

/**
 * Los brazos. Cada uno es una estrategia distinta de la psicología del comportamiento,
 * no cinco formas de decir lo mismo con otras palabras. Si fueran variaciones de
 * redacción, el bandit no tendría nada que descubrir.
 */
export const BRAZOS = {
  identidad: {
    nombre: 'Identidad',
    base: 'Basado en hábitos por identidad: la acción confirma quién sos, no persigue un resultado.',
    // prior optimista: es la estrategia con más respaldo para adherencia a largo plazo
    prior: { a: 3, b: 2 },
  },
  minimo_viable: {
    nombre: 'Mínimo viable',
    base: 'Reduce la barrera de entrada a algo tan chico que negarse es absurdo. Empezar es el 90%.',
    prior: { a: 3, b: 2 },
  },
  evidencia: {
    nombre: 'Evidencia de progreso',
    base: 'Feedback de competencia: muestra un número tuyo que mejoró. Funciona cuando hay progreso real que mostrar.',
    prior: { a: 2, b: 2 },
  },
  costo_de_parar: {
    nombre: 'Costo de parar',
    base: 'Aversión a la pérdida sobre una racha construida. Potente y frágil: si la racha ya se rompió, no tiene nada que agarrar.',
    prior: { a: 2, b: 3 },
  },
  curiosidad: {
    nombre: 'Curiosidad',
    base: 'Novedad como motor. Sirve contra el aburrimiento, no contra el cansancio.',
    prior: { a: 2, b: 2 },
  },
};

/**
 * Contexto. El brazo que funciona un día con energía no es el mismo que funciona
 * un día roto — por eso el bandit es contextual y no global. Se usan solo dos
 * contextos a propósito: con tres o cuatro, cada uno recibiría tan pocos datos
 * que ninguno aprendería nada. Es la restricción de datos mandando sobre la
 * elegancia del modelo.
 */
export function contextoDe(disposicion, diasSinEntrenar) {
  if (disposicion < 58 || diasSinEntrenar >= 3) return 'dificil';
  return 'normal';
}

function muestraBeta(a, b) {
  // Beta(a,b) por el cociente de dos Gamma. Con a,b enteros chicos alcanza con
  // el método de Jöhnk, que es exacto y no necesita librería.
  const gamma = (k) => {
    // Suma de exponenciales para k entero (Erlang). k acá siempre es entero ≥1.
    let s = 0;
    for (let i = 0; i < k; i++) s -= Math.log(1 - Math.random());
    return s;
  };
  const x = gamma(Math.max(1, Math.round(a)));
  const y = gamma(Math.max(1, Math.round(b)));
  return x / (x + y);
}

/**
 * Elige el brazo para hoy.
 * @param {Object} posteriores  { [contexto]: { [brazo]: {a, b} } }
 * @param {string} contexto
 * @param {string[]} disponibles  brazos aplicables hoy (ej.: sin racha, "costo_de_parar" no aplica)
 */
export function elegirBrazo(posteriores, contexto, disponibles = Object.keys(BRAZOS)) {
  const delContexto = posteriores?.[contexto] || {};
  let mejor = null;
  let mejorMuestra = -1;
  for (const id of disponibles) {
    const prior = BRAZOS[id].prior;
    const p = delContexto[id] || { a: 0, b: 0 };
    const m = muestraBeta(prior.a + p.a, prior.b + p.b);
    if (m > mejorMuestra) { mejorMuestra = m; mejor = id; }
  }
  return mejor || 'identidad';
}

/** Proyecta las posteriores desde el log de eventos. */
export function proyectarPosteriores(propuestas, resultados) {
  const post = {};
  for (const p of propuestas) {
    const res = resultados.get(p.sesionId);
    if (res === undefined) continue; // sesión todavía abierta: no es dato aún
    post[p.contexto] ||= {};
    post[p.contexto][p.brazo] ||= { a: 0, b: 0 };
    if (res) post[p.contexto][p.brazo].a += 1;
    else post[p.contexto][p.brazo].b += 1;
  }
  return post;
}

/** Tasa observada por brazo, para poder mirar qué aprendió. Sin esto es una caja negra. */
export function resumen(posteriores) {
  const filas = [];
  for (const [contexto, brazos] of Object.entries(posteriores || {})) {
    for (const [brazo, { a, b }] of Object.entries(brazos)) {
      const n = a + b;
      filas.push({
        contexto, brazo, nombre: BRAZOS[brazo]?.nombre || brazo,
        intentos: n, exitos: a,
        tasa: n ? a / n : null,
        // Con menos de 8 observaciones la tasa no significa nada y no se muestra
        // como conclusión. Decir "el 100% de 2" es mentir con un número real.
        confiable: n >= 8,
      });
    }
  }
  return filas.sort((x, y) => y.intentos - x.intentos);
}
