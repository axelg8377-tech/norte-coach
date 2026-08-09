/**
 * motor.js — la política. Dado todo lo que el sistema sabe, decide el día.
 *
 * Es una FUNCIÓN PURA: no toca el DOM, no lee IndexedDB, no llama a la red, no
 * mira el reloj salvo por el parámetro `hoy`. Entra una observación, sale una
 * acción. Esa restricción es deliberada y es lo que hace que el motor se pueda
 * probar con un arnés (`scripts/verificar.mjs`) sin navegador, y que se pueda
 * reemplazar entero sin tocar una línea de interfaz.
 *
 * Es también lo único que se conserva de Gymnasium: su contrato
 * observación → política → acción → recompensa. La librería no, porque es Python
 * y no corre en un celular; el contrato sí, porque es la parte que vale.
 *
 * La sesión se arma por PATRONES DE MOVIMIENTO, no por músculos. Un programa
 * que dice "hoy pecho" produce desequilibrios en un año; uno que empareja empuje
 * con tracción y rodilla con cadera, no.
 */

import { MODO, PATRON, ZONA_DOLOR, calcularDisposicion, modoPorDisposicion } from './modelo.js';
import { prescribir, estadoVolumen } from './progresion.js';
import { candidatos } from './catalogo.js';
import { elegirBrazo, contextoDe, BRAZOS } from './bandit.js';
import { redactar, explicarDecision } from './mensajes.js';

/**
 * Rotación de 3 sesiones de cuerpo completo. Se elige cuerpo completo y no una
 * división por grupos porque con 3 días semanales cada patrón se estimula 3 veces,
 * contra 1 en una división — y la frecuencia por patrón es lo que más pesa cuando
 * el tiempo es limitado. Si alguna vez se entrena 5 días, esta tabla se cambia
 * por una división y no hay que tocar nada más del motor.
 */
const ROTACION = [
  [
    { rol: 'compuesto_pesado', patron: 'sentadilla' },
    { rol: 'compuesto', patron: 'empuje_horizontal' },
    { rol: 'compuesto', patron: 'traccion_horizontal' },
    { rol: 'accesorio', patron: null },        // null = el patrón más descuidado
    { rol: 'core', patron: 'core' },
  ],
  [
    { rol: 'compuesto_pesado', patron: 'bisagra' },
    { rol: 'compuesto', patron: 'empuje_vertical' },
    { rol: 'compuesto', patron: 'traccion_vertical' },
    { rol: 'accesorio', patron: null },
    { rol: 'core', patron: 'core' },
  ],
  [
    { rol: 'compuesto_pesado', patron: 'zancada' },
    { rol: 'compuesto', patron: 'empuje_horizontal' },
    { rol: 'compuesto', patron: 'traccion_vertical' },
    { rol: 'accesorio', patron: null },
    { rol: 'core', patron: 'core' },
  ],
];

const SESION_RECUPERACION = [
  { rol: 'core', patron: 'movilidad' },
  { rol: 'core', patron: 'movilidad' },
  { rol: 'core', patron: 'core' },
];

// Minutos estimados por rol, incluyendo descanso entre series.
const MINUTOS_POR_ROL = { compuesto_pesado: 13, compuesto: 9, accesorio: 6, core: 5 };

/**
 * La entrada en calor escala con la sesión. Fija en 8 minutos se comía el 40%
 * de una sesión de 20, y dejaba lugar para un solo ejercicio: el usuario pedía
 * media hora corta y recibía un calentamiento con un press adentro.
 */
const entradaEnCalor = (minutosDisponibles) =>
  Math.max(4, Math.min(8, Math.round(minutosDisponibles * 0.15)));

const FACTOR_INTENSIDAD = {
  [MODO.EMPUJAR]: 1.03,
  [MODO.NORMAL]: 1,
  [MODO.REDUCIR]: 0.9,
  [MODO.RECUPERAR]: 0,
};

/**
 * @param {Object} obs  Observación completa del sistema
 * @param {Object} obs.check          { sueno, energia, animo, dolor:{zona:0..5}, minutos, equipoHoy }
 * @param {Object} obs.perfil         { diasPorSemana, equipo:[], experiencia }
 * @param {Object} obs.historial      { [ejercicioId]: {sesiones:[], estancado} }
 * @param {Map}    obs.vecesHecho     ejercicioId → cantidad
 * @param {Object} obs.volumenSemanal { patron: seriesEfectivas }
 * @param {number} obs.sesionesHechas para la rotación
 * @param {Object} obs.posteriores    del bandit
 * @param {Object} obs.contextoMensaje { racha, adherencia, mejorMarca, diasSinEntrenar }
 * @param {Array}  obs.ultimosPorHueco ejercicioId elegido la vez pasada en cada hueco
 * @param {string} obs.hoy
 * @param {Function} [obs.azar]        inyectable para que el arnés sea determinista
 */
export function decidir(obs) {
  const { check, perfil, historial = {}, vecesHecho = new Map(), volumenSemanal = {},
    sesionesHechas = 0, posteriores = {}, contextoMensaje = {}, ultimosPorHueco = [], hoy } = obs;

  const disposicion = calcularDisposicion(check);
  const modo = modoPorDisposicion(disposicion);

  // ── Dolor: bloquea patrones. No advierte, filtra. ──────────────────────────
  const bloqueados = [];
  const patronesBloqueados = new Set();
  for (const [zona, nivel] of Object.entries(check.dolor || {})) {
    const def = ZONA_DOLOR[zona];
    if (nivel < 3 || !def) continue;
    for (const p of def.bloquea) patronesBloqueados.add(p);
    bloqueados.push({
      zona: def.nombre.toLowerCase(),
      nivel,
      patron: def.bloquea.map((p) => PATRON[p]?.nombre.toLowerCase()).join(' y '),
    });
  }

  // ── Equipo disponible hoy: puede ser menos que el del perfil (viaje, casa) ──
  const equipoDisponible = check.equipoHoy?.length ? check.equipoHoy : (perfil?.equipo || ['peso_corporal']);

  // ── Cuántos huecos entran en el tiempo que hay ─────────────────────────────
  const plantillaBase = modo === MODO.RECUPERAR
    ? SESION_RECUPERACION
    : ROTACION[sesionesHechas % ROTACION.length];

  let plantilla = plantillaBase;
  const ajustes = [];

  if (modo === MODO.REDUCIR) {
    plantilla = plantillaBase.filter((h) => h.rol === 'compuesto_pesado' || h.rol === 'compuesto');
  }

  const minutosDisponibles = check.minutos || 60;
  while (plantilla.length > 1) {
    const est = estimarMinutos(plantilla, minutosDisponibles);
    if (est <= minutosDisponibles) break;
    // Se recorta desde el final: el último hueco es el menos importante.
    plantilla = plantilla.slice(0, -1);
  }
  if (plantilla.length < plantillaBase.length && modo !== MODO.REDUCIR) {
    ajustes.push(`Dijiste que tenés ${minutosDisponibles} minutos, así que dejé ${plantilla.length} ejercicios en vez de ${plantillaBase.length}. Los que saqué son los accesorios, no los principales.`);
  }

  // ── Elegir el ejercicio de cada hueco ──────────────────────────────────────
  const yaEnLaSesion = new Set();
  const nombresEnLaSesion = new Set();
  const patronesUsados = new Set();
  const bloques = [];
  let hayNuevo = null;

  plantilla.forEach((hueco, i) => {
    let patron = hueco.patron;

    // Hueco de accesorio: va al patrón con menos volumen esta semana.
    // El hueco de accesorio va al patrón más descuidado, pero nunca a uno que ya
    // está en la sesión de hoy: repetirlo daría dos bloques casi iguales seguidos.
    if (patron === null) {
      patron = patronMasDescuidado(volumenSemanal, new Set([...patronesBloqueados, ...patronesUsados]));
    }

    // Patrón bloqueado por dolor → se intenta el opuesto, y si no, se salta el hueco.
    if (patronesBloqueados.has(patron)) {
      const alternativo = PATRON[patron]?.opuesto;
      if (alternativo && !patronesBloqueados.has(alternativo)) {
        ajustes.push(`Cambié ${PATRON[patron].nombre.toLowerCase()} por ${PATRON[alternativo].nombre.toLowerCase()}.`);
        patron = alternativo;
      } else {
        return;
      }
    }

    const opciones = candidatos({
      patron,
      equipoDisponible,
      soloCompuestos: hueco.rol === 'compuesto_pesado',
      patronesBloqueados: [...patronesBloqueados],
      yaEnLaSesion,
      nombresEnLaSesion,
      vecesHecho,
      ultimoEnEsteHueco: ultimosPorHueco[i] || null,
    });

    if (!opciones.length) {
      ajustes.push(`No hay ningún ejercicio de ${PATRON[patron]?.nombre.toLowerCase() || patron} con el equipo que marcaste. Ese hueco queda vacío hoy.`);
      return;
    }

    const ej = opciones[0];
    yaEnLaSesion.add(ej.id);
    nombresEnLaSesion.add(ej.n);
    patronesUsados.add(patron);
    if (!vecesHecho.get(ej.id)) hayNuevo ||= ej.n;

    const presc = prescribir(
      historial[ej.id],
      hueco.rol,
      ej.g,
      FACTOR_INTENSIDAD[modo] || 1,
    );

    bloques.push({
      hueco: i,
      rol: hueco.rol,
      patron,
      patronNombre: PATRON[patron]?.nombre || patron,
      ejercicio: ej,
      ...presc,
      nuevo: !vecesHecho.get(ej.id),
    });
  });

  // ── El mensaje: qué brazo del bandit lo pide ───────────────────────────────
  const contexto = contextoDe(disposicion, contextoMensaje.diasSinEntrenar ?? 0);
  const disponibles = Object.keys(BRAZOS).filter((b) => {
    if (b === 'costo_de_parar' && !(contextoMensaje.racha > 1)) return false;
    if (b === 'evidencia' && !contextoMensaje.mejorMarca) return false;
    if (b === 'curiosidad' && !hayNuevo) return false;
    return true;
  });
  const brazo = elegirBrazo(posteriores, contexto, disponibles);
  const minutos = estimarMinutos(plantilla, minutosDisponibles);
  const mensaje = redactar(brazo, { ...contextoMensaje, ejercicioNuevo: hayNuevo, minutos, dia: hoy, disposicion, modo });

  return {
    dia: hoy,
    disposicion,
    modo,
    bloques,
    minutosEstimados: minutos,
    brazo,
    contexto,
    mensaje,
    porQue: explicarDecision({ modo, disposicion, check, bloqueados, ajustes }),
    // Se guarda la observación mínima para poder auditar después por qué el
    // motor decidió esto. Sin esto, discutir una decisión de hace tres semanas
    // es imposible.
    huella: { sesionesHechas, equipoDisponible, patronesBloqueados: [...patronesBloqueados] },
  };
}

function estimarMinutos(plantilla, minutosDisponibles = 60) {
  return entradaEnCalor(minutosDisponibles)
    + plantilla.reduce((s, h) => s + (MINUTOS_POR_ROL[h.rol] || 6), 0);
}

/**
 * El patrón que menos volumen recibió esta semana, entre los que se pueden
 * accesorizar. Esto es lo que evita el desequilibrio a un año: el hueco libre
 * de cada sesión va solo donde falta.
 */
export function patronMasDescuidado(volumenSemanal, bloqueados = new Set()) {
  const elegibles = ['traccion_horizontal', 'traccion_vertical', 'empuje_horizontal',
    'empuje_vertical', 'bisagra', 'zancada', 'aislamiento'];
  let peor = 'aislamiento';
  let min = Infinity;
  for (const p of elegibles) {
    if (bloqueados.has(p)) continue;
    const v = volumenSemanal[p] || 0;
    if (v < min) { min = v; peor = p; }
  }
  return peor;
}

/** Diagnóstico de equilibrio para la pantalla de progreso. */
export function equilibrio(volumenSemanal) {
  return Object.entries(PATRON)
    .filter(([, d]) => d.eje === 'tren_superior' || d.eje === 'tren_inferior')
    .map(([id, d]) => {
      const series = volumenSemanal[id] || 0;
      return { patron: id, nombre: d.nombre, series, estado: estadoVolumen(series) };
    })
    .sort((a, b) => a.series - b.series);
}
