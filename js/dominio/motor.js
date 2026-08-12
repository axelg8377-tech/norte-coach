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
 *
 * ─── v2 ─────────────────────────────────────────────────────────────────────
 * Tres cosas cambiaron después de usar la v1 en un gimnasio real:
 *   1. La sesión ya no es determinista. La v1 tomaba siempre `opciones[0]`, así
 *      que dos días con el mismo check daban la sesión idéntica. Ahora se sortea
 *      entre los tres primeros candidatos con peso decreciente, usando un azar
 *      SEMBRADO por el día y el número de intento: la misma entrada da siempre
 *      la misma salida (el arnés sigue sirviendo), pero pedir otra propuesta da
 *      otra sesión.
 *   2. La entrada en calor dice qué hacer. Reservaba 4-8 minutos y los dejaba en
 *      blanco, que era el hueco más visible del producto.
 *   3. El motor acepta RESTRICCIONES. Es lo que permite negociar la sesión
 *      ("hoy quiero espalda", "no tengo banco") sin que la política deje de ser
 *      la autoridad: la interfaz y la IA traducen a restricciones, el motor
 *      sigue decidiendo.
 */

import { MODO, PATRON, ZONA_DOLOR, calcularDisposicion, modoPorDisposicion, DESCANSO_POR_ROL } from './modelo.js';
import { prescribir, estadoVolumen } from './progresion.js';
import { candidatos, porId } from './catalogo.js';
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
 * Qué zonas hay que preparar para cada patrón. Es lo que hace que la entrada en
 * calor sea de la sesión de hoy y no una lista genérica de estiramientos: si hoy
 * hay sentadilla y remo, se calientan piernas y espalda, no cuello.
 */
const ZONAS_POR_PATRON = {
  sentadilla: ['piernas', 'gemelos'],
  bisagra: ['piernas', 'espalda'],
  zancada: ['piernas', 'gemelos'],
  empuje_horizontal: ['pecho', 'hombros'],
  empuje_vertical: ['hombros'],
  traccion_horizontal: ['espalda', 'hombros'],
  traccion_vertical: ['espalda', 'brazos'],
  core: ['core'],
  aislamiento: ['brazos'],
  transporte: ['core'],
  movilidad: ['core'],
  cardio: ['piernas'],
};

/**
 * Generador de números pseudoaleatorios sembrado (xorshift32).
 *
 * Por qué no `Math.random`: la sesión tiene que ser reproducible. Si al repintar
 * la pantalla el motor sorteara otra vez, la sesión cambiaría sola delante del
 * usuario, y el arnés no podría probar nada. Con semilla, la misma observación
 * da siempre la misma sesión — y "dame otra" es solo otra semilla.
 */
export function azarSembrado(semilla) {
  let x = 2463534242;
  const s = String(semilla);
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

// Peso de cada posición del podio. El canónico gana 6 de cada 10 veces: sigue
// mandando, pero deja de ser el único que aparece.
const PESOS_PODIO = [0.6, 0.25, 0.15];

function elegirDelPodio(opciones, azar) {
  if (opciones.length <= 1) return opciones[0];
  const top = opciones.slice(0, PESOS_PODIO.length);
  const pesos = PESOS_PODIO.slice(0, top.length);
  let r = azar() * pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    r -= pesos[i];
    if (r <= 0) return top[i];
  }
  return top[0];
}

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
 * @param {Object} [obs.restricciones] { patronPreferido, excluirPatrones:[], excluirEjercicios:[], minutos }
 * @param {number} [obs.intento]      cuántas veces se pidió otra propuesta hoy
 * @param {string} obs.hoy
 * @param {Function} [obs.azar]       inyectable; por defecto sembrado con hoy+intento
 */
export function decidir(obs) {
  const { check, perfil, historial = {}, vecesHecho = new Map(), volumenSemanal = {},
    sesionesHechas = 0, posteriores = {}, contextoMensaje = {}, ultimosPorHueco = [],
    restricciones = {}, intento = 0, hoy } = obs;

  const azar = obs.azar || azarSembrado(`${hoy}|${sesionesHechas}|${intento}`);

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

  // Lo que el usuario pidió sacar hoy. Se trata igual que el dolor a la hora de
  // filtrar, pero se explica distinto: una cosa es que el motor te proteja y
  // otra que te haga caso.
  const evitados = new Set(restricciones.excluirPatrones || []);
  for (const p of evitados) patronesBloqueados.add(p);

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

  // Patrón pedido: va SEGUNDO, detrás del compuesto pesado.
  //
  // La primera versión lo metía en el hueco libre, que está al final. Probando
  // en el navegador: "quiero espalda y tengo 30 minutos" contestaba "meto
  // tracción horizontal" y después el recorte por tiempo — que muerde desde el
  // final — la sacaba. Lo que pediste no puede ser lo primero que se cae.
  const preferido = restricciones.patronPreferido;
  if (preferido && PATRON[preferido] && !patronesBloqueados.has(preferido)) {
    const copia = plantilla.filter((h) => h.patron !== preferido).map((h) => ({ ...h }));
    const libre = copia.findIndex((h) => h.patron === null);
    if (libre >= 0) copia.splice(libre, 1);            // el hueco libre cede el lugar
    else if (copia.length >= plantilla.length) copia.pop();
    copia.splice(Math.min(1, copia.length), 0, { rol: 'compuesto', patron: preferido });
    plantilla = copia;
    ajustes.push(`Pediste ${PATRON[preferido].nombre.toLowerCase()} y lo puse segundo, para que no se caiga si hay que recortar por tiempo.`);
  }

  const minutosDisponibles = restricciones.minutos || check.minutos || 60;
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
  const yaEnLaSesion = new Set(restricciones.excluirEjercicios || []);
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

    const ej = elegirDelPodio(opciones, azar);
    yaEnLaSesion.add(ej.id);
    nombresEnLaSesion.add(ej.n);
    patronesUsados.add(patron);
    if (!vecesHecho.get(ej.id)) hayNuevo ||= ej.n;

    bloques.push(armarBloque({
      indice: i, rol: hueco.rol, patron, ejercicio: ej,
      historial, vecesHecho, factor: FACTOR_INTENSIDAD[modo] || 1,
    }));
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

  if (evitados.size) {
    ajustes.push(`Saqué ${[...evitados].map((p) => PATRON[p]?.nombre.toLowerCase() || p).join(' y ')} porque me lo pediste.`);
  }

  return {
    dia: hoy,
    disposicion,
    modo,
    origen: 'motor',
    intento,
    calentamiento: calentamiento({
      patrones: [...patronesUsados],
      equipoDisponible,
      minutos: entradaEnCalor(minutosDisponibles),
      azar,
    }),
    bloques,
    minutosEstimados: minutos,
    brazo,
    contexto,
    mensaje,
    porQue: explicarDecision({ modo, disposicion, check, bloqueados, ajustes }),
    // Se guarda la observación mínima para poder auditar después por qué el
    // motor decidió esto. Sin esto, discutir una decisión de hace tres semanas
    // es imposible.
    huella: { sesionesHechas, equipoDisponible, patronesBloqueados: [...patronesBloqueados], restricciones },
  };
}

function armarBloque({ indice, rol, patron, ejercicio, historial, vecesHecho, factor }) {
  const presc = prescribir(historial[ejercicio.id], rol, ejercicio.g, factor);
  return {
    hueco: indice,
    rol,
    patron,
    patronNombre: PATRON[patron]?.nombre || patron,
    ejercicio,
    descanso: DESCANSO_POR_ROL[rol] ?? 90,
    ...presc,
    nuevo: !vecesHecho.get(ejercicio.id),
  };
}

/**
 * La entrada en calor de HOY: movilidad de las zonas que la sesión va a cargar.
 *
 * La v1 reservaba estos minutos y los dejaba en blanco. Era el hueco más visible
 * del producto: el primer momento de la sesión, sin nada escrito, que es
 * exactamente el que más se saltea.
 */
export function calentamiento({ patrones = [], equipoDisponible = ['peso_corporal'], minutos = 6, azar = Math.random }) {
  const zonas = new Set();
  for (const p of patrones) for (const z of ZONAS_POR_PATRON[p] || []) zonas.add(z);

  // El peso corporal entra SIEMPRE, aunque no esté marcado en el check. Los 61
  // movimientos de movilidad del catálogo son de peso corporal, bandas o
  // accesorios: filtrando por el equipo del día, alguien que marca solo "barra y
  // mancuernas" se quedaba sin entrada en calor y volvíamos al hueco en blanco
  // de la v1. Estirar no necesita equipo.
  const pool = candidatos({
    patron: 'movilidad',
    equipoDisponible: [...new Set(['peso_corporal', ...equipoDisponible])],
    vecesHecho: new Map(),
  });
  if (!pool.length) return [];

  // Movimientos cortos y varios, no tres estiramientos de casi tres minutos:
  // la primera versión repartía los 8 minutos entre 3 movimientos y daba 165
  // segundos cada uno, que nadie sostiene. Se usa el 70% del tiempo en
  // movilidad; el resto queda para la entrada general (caminar, bici).
  const cuantos = Math.max(2, Math.min(5, Math.round(minutos / 1.5)));
  const segundos = Math.min(90, Math.max(45,
    Math.round((minutos * 60 * 0.7) / cuantos / 15) * 15));
  const elegidos = [];
  const zonasUsadas = new Set();

  // Una por zona de la sesión, en orden. Si sobran huecos, se completan con lo
  // que quede: es mejor tres movimientos de dos zonas que un hueco vacío.
  for (const z of zonas) {
    if (elegidos.length >= cuantos) break;
    const deLaZona = pool.filter((e) => e.z === z && !elegidos.some((x) => x.ejercicio.id === e.id));
    if (!deLaZona.length) continue;
    elegidos.push({ ejercicio: elegirDelPodio(deLaZona, azar), zona: z, segundos });
    zonasUsadas.add(z);
  }
  while (elegidos.length < cuantos) {
    const resto = pool.filter((e) => !elegidos.some((x) => x.ejercicio.id === e.id));
    if (!resto.length) break;
    const ej = elegirDelPodio(resto, azar);
    elegidos.push({ ejercicio: ej, zona: ej.z, segundos });
  }
  return elegidos;
}

/**
 * Un bloque suelto, para agregar un ejercicio a la sesión de hoy desde el
 * catálogo. El rol se infiere del ejercicio si no se dice, y la prescripción
 * sale del historial como en cualquier otro bloque: agregar algo a mano no
 * significa quedarse sin progresión.
 */
export function bloqueDe(ejercicio, { historial = {}, vecesHecho = new Map(), rol = null, indice = 0, factor = 1 } = {}) {
  const elRol = rol || (ejercicio.p === 'core' ? 'core' : ejercicio.c === 1 ? 'compuesto' : 'accesorio');
  return armarBloque({ indice, rol: elRol, patron: ejercicio.p, ejercicio, historial, vecesHecho, factor });
}

/**
 * Alternativas para sustituir un bloque en el momento. "La máquina está ocupada"
 * es la causa número uno de sesión abandonada en un gimnasio lleno, y la v1
 * solo ofrecía saltear el ejercicio, que castiga el historial.
 */
export function alternativas(bloque, { equipoDisponible, vecesHecho = new Map(), yaEnLaSesion = new Set(), limite = 6 }) {
  const lista = candidatos({
    patron: bloque.patron,
    equipoDisponible,
    soloCompuestos: bloque.rol === 'compuesto_pesado',
    yaEnLaSesion: new Set([...yaEnLaSesion, bloque.ejercicio.id]),
    vecesHecho,
  });
  return lista.slice(0, limite);
}

/**
 * Sustituye un ejercicio conservando el hueco, el rol y el patrón. La
 * prescripción se recalcula contra el historial del ejercicio NUEVO: mantener la
 * carga del anterior sería la forma más rápida de sugerir una barbaridad.
 */
export function sustituir(bloque, ejercicioNuevo, { historial = {}, vecesHecho = new Map(), factor = 1 }) {
  return armarBloque({
    indice: bloque.hueco,
    rol: bloque.rol,
    patron: ejercicioNuevo.p === bloque.patron ? bloque.patron : ejercicioNuevo.p,
    ejercicio: ejercicioNuevo,
    historial,
    vecesHecho,
    factor,
  });
}

/**
 * Sesión armada a mano.
 *
 * DECISIÓN REABIERTA (2026-08-11). La v1 lo prohibía con un motivo bueno: si se
 * puede armar la sesión a mano, el motor sobra y la app vuelve a ser una planilla
 * con animaciones. Axel la reabrió después de usarla en un gimnasio.
 *
 * La forma en que se reabre conserva el motor: vos elegís QUÉ, el motor sigue
 * diciendo cuántas series, cuántas repeticiones y con cuánto peso según tu
 * historial — y escribe el diagnóstico de lo que estás dejando afuera. La sesión
 * queda marcada con `origen: 'manual'` para poder comparar, a las 20 sesiones,
 * adherencia y equilibrio contra las del motor. Si las manuales salen peor en
 * las dos, el dato cierra la discusión sin necesidad de opinar.
 */
export function armarManual(obs) {
  const { ejercicioIds = [], check = {}, perfil, historial = {}, vecesHecho = new Map(),
    volumenSemanal = {}, hoy, minutos } = obs;

  const disposicion = calcularDisposicion({ sueno: 3, energia: 3, animo: 3, dolor: {}, ...check });
  const modo = modoPorDisposicion(disposicion);
  const equipoDisponible = check.equipoHoy?.length ? check.equipoHoy : (perfil?.equipo || ['peso_corporal']);

  const bloques = [];
  const patronesUsados = new Set();
  ejercicioIds.forEach((id, i) => {
    const ej = porId(id);
    if (!ej) return;
    const rol = ej.p === 'core' ? 'core'
      : (i === 0 && ej.c === 1) ? 'compuesto_pesado'
        : ej.c === 1 ? 'compuesto' : 'accesorio';
    patronesUsados.add(ej.p);
    bloques.push(armarBloque({
      indice: i, rol, patron: ej.p, ejercicio: ej,
      historial, vecesHecho, factor: 1,
    }));
  });

  const minutosDisponibles = minutos || check.minutos || 60;
  const estimado = entradaEnCalor(minutosDisponibles)
    + bloques.reduce((s, b) => s + (MINUTOS_POR_ROL[b.rol] || 6), 0);

  return {
    dia: hoy,
    disposicion,
    modo,
    origen: 'manual',
    calentamiento: calentamiento({
      patrones: [...patronesUsados],
      equipoDisponible,
      minutos: entradaEnCalor(minutosDisponibles),
      azar: azarSembrado(`${hoy}|manual`),
    }),
    bloques,
    minutosEstimados: estimado,
    brazo: null,
    contexto: null,
    mensaje: { titulo: 'La armaste vos.', cuerpo: `${bloques.length} ejercicios, ${estimado} minutos estimados. Las series, las repeticiones y la carga las sigo calculando yo con tu historial.` },
    porQue: diagnosticoManual(bloques, volumenSemanal),
    huella: { equipoDisponible, ejercicioIds, manual: true },
  };
}

/**
 * Lo que el motor tiene para decir de una sesión que no armó. No la corrige: la
 * describe. Es la diferencia entre una planilla y un entrenador que te deja
 * hacer lo que querés y te dice qué estás dejando afuera.
 */
export function diagnosticoManual(bloques, volumenSemanal = {}) {
  const partes = [];
  const cuenta = {};
  for (const b of bloques) cuenta[b.patron] = (cuenta[b.patron] || 0) + 1;

  const empujes = (cuenta.empuje_horizontal || 0) + (cuenta.empuje_vertical || 0);
  const tracciones = (cuenta.traccion_horizontal || 0) + (cuenta.traccion_vertical || 0);

  partes.push(`Sesión armada a mano: ${bloques.length} ejercicios. La prescripción de cada uno sale de tu historial igual que siempre.`);

  if (empujes && !tracciones) {
    partes.push(`Hay ${empujes} empuje${empujes > 1 ? 's' : ''} y ninguna tracción. Sostenido en el tiempo, eso es el hombro adelantado que se paga en dos años.`);
  } else if (tracciones && !empujes) {
    partes.push(`Hay ${tracciones} tracci${tracciones > 1 ? 'ones' : 'ón'} y ningún empuje.`);
  }

  const flojos = Object.entries(volumenSemanal).length
    ? equilibrio(volumenSemanal).filter((e) => e.estado === 'descuidado' && !cuenta[e.patron])
    : [];
  if (flojos.length) {
    partes.push(`Esta semana ${flojos.slice(0, 2).map((f) => f.nombre.toLowerCase()).join(' y ')} está por debajo de 6 series y hoy tampoco entra.`);
  }
  return partes;
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
