/**
 * modelo.js — el vocabulario del sistema. Sin DOM, sin IndexedDB, sin red.
 *
 * DECISIÓN CENTRAL: el estado no se guarda, se deriva.
 * Lo único que se persiste es un log de eventos append-only. El perfil, el historial
 * de cargas, la racha, las posteriores del bandit y el riesgo de recaída son
 * proyecciones que se recalculan al arrancar.
 *
 * Por qué, si es más trabajo que guardar un objeto `usuario`:
 *   - Una feature que se invente dentro de un año puede leer los eventos de hoy y
 *     calcular algo que hoy no existe. Con estado mutable, ese dato ya se perdió.
 *   - Un bug en una proyección se arregla y se recalcula; no corrompe el historial.
 *   - Cada evento lleva `v` (versión de esquema), así que un cambio de formato se
 *     resuelve leyendo, no migrando destructivamente.
 * Costo aceptado: recalcular al arrancar. Con ~5 eventos por día son ~1.800 al año,
 * y proyectar eso toma milisegundos. Si algún día molesta, se agregan snapshots.
 */

export const VERSION_ESQUEMA = 1;

export const EVENTO = {
  PERFIL_DEFINIDO: 'perfil.definido',
  CHECK_REGISTRADO: 'check.registrado',
  SESION_PROPUESTA: 'sesion.propuesta',
  SESION_INICIADA: 'sesion.iniciada',
  SERIE_REGISTRADA: 'serie.registrada',
  SESION_TERMINADA: 'sesion.terminada',
  SESION_SALTADA: 'sesion.saltada',
  HABITO_REGISTRADO: 'habito.registrado',
  NOTA_ESCRITA: 'nota.escrita',
  AJUSTE_CAMBIADO: 'ajuste.cambiado',
};

// ─────────────────────────────────────────────────────────────────────────────
// Patrones de movimiento. Son la unidad con la que se arma una sesión: un
// programa equilibrado cubre patrones, no músculos. `opuesto` se usa para que
// cada sesión empareje empuje con tracción y no genere desequilibrios.
// ─────────────────────────────────────────────────────────────────────────────
export const PATRON = {
  empuje_horizontal: { nombre: 'Empuje horizontal', eje: 'tren_superior', opuesto: 'traccion_horizontal' },
  empuje_vertical: { nombre: 'Empuje vertical', eje: 'tren_superior', opuesto: 'traccion_vertical' },
  traccion_horizontal: { nombre: 'Tracción horizontal', eje: 'tren_superior', opuesto: 'empuje_horizontal' },
  traccion_vertical: { nombre: 'Tracción vertical', eje: 'tren_superior', opuesto: 'empuje_vertical' },
  sentadilla: { nombre: 'Dominante de rodilla', eje: 'tren_inferior', opuesto: 'bisagra' },
  bisagra: { nombre: 'Dominante de cadera', eje: 'tren_inferior', opuesto: 'sentadilla' },
  zancada: { nombre: 'Unilateral de pierna', eje: 'tren_inferior', opuesto: null },
  transporte: { nombre: 'Transporte', eje: 'global', opuesto: null },
  core: { nombre: 'Core', eje: 'core', opuesto: null },
  aislamiento: { nombre: 'Aislamiento', eje: 'accesorio', opuesto: null },
  movilidad: { nombre: 'Movilidad', eje: 'recuperacion', opuesto: null },
  cardio: { nombre: 'Cardio', eje: 'recuperacion', opuesto: null },
};

// Zonas del cuerpo donde se reporta dolor, y qué patrones cargan cada una.
// Si duele el hombro, el motor no propone press: no es una advertencia, es un filtro.
export const ZONA_DOLOR = {
  hombro: { nombre: 'Hombro', bloquea: ['empuje_vertical', 'empuje_horizontal'] },
  espalda_baja: { nombre: 'Espalda baja', bloquea: ['bisagra', 'sentadilla'] },
  rodilla: { nombre: 'Rodilla', bloquea: ['sentadilla', 'zancada'] },
  codo: { nombre: 'Codo', bloquea: ['traccion_horizontal', 'traccion_vertical'] },
  cadera: { nombre: 'Cadera', bloquea: ['bisagra', 'zancada'] },
};

export const GRUPO_EQUIPO = {
  peso_corporal: 'Peso corporal',
  mancuernas: 'Mancuernas',
  barra: 'Barra y discos',
  maquinas: 'Máquinas y poleas',
  bandas: 'Bandas elásticas',
  accesorios: 'Accesorios',
  cardio_maquina: 'Máquinas de cardio',
};

// Los hábitos del ecosistema que NO tienen pantalla propia en la v1.
// Se registran con un toque y alimentan al motor igual que el check.
export const HABITOS = [
  { id: 'agua', nombre: 'Hidratación', unidad: 'vasos', meta: 8, tipo: 'contador' },
  { id: 'proteina', nombre: 'Proteína en cada comida', tipo: 'si_no' },
  { id: 'pasos', nombre: 'Caminata', unidad: 'min', meta: 30, tipo: 'contador' },
  { id: 'pantallas', nombre: 'Sin pantallas 1h antes de dormir', tipo: 'si_no' },
  { id: 'movilidad', nombre: 'Movilidad', unidad: 'min', meta: 10, tipo: 'contador' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Disposición (readiness). Es el número que gobierna la decisión del día.
//
// Los pesos no son arbitrarios y tampoco son ciencia exacta: el sueño y la
// energía percibida son los dos predictores más consistentes de rendimiento
// agudo en la literatura de autorregulación, así que pesan más. El dolor no
// promedia — vetea. Un dolor de 4 en la rodilla no se compensa con haber
// dormido bien; bloquea el patrón, y eso se resuelve en el motor, no acá.
// ─────────────────────────────────────────────────────────────────────────────
export const PESOS_DISPOSICION = { sueno: 0.35, energia: 0.30, animo: 0.15, dolor: 0.20 };

/**
 * @param {{sueno:number, energia:number, animo:number, dolor:Object<string,number>}} check
 *        sueño/energía/ánimo en 1..5 · dolor: { zona: 0..5 }
 * @returns {number} 0..100
 */
export function calcularDisposicion(check) {
  const norm = (v) => (Math.min(5, Math.max(1, v)) - 1) / 4; // 1..5 → 0..1
  const dolorMax = Math.max(0, ...Object.values(check.dolor || {}), 0);
  const dolorNorm = 1 - Math.min(5, dolorMax) / 5;
  const bruto =
    PESOS_DISPOSICION.sueno * norm(check.sueno) +
    PESOS_DISPOSICION.energia * norm(check.energia) +
    PESOS_DISPOSICION.animo * norm(check.animo) +
    PESOS_DISPOSICION.dolor * dolorNorm;
  return Math.round(bruto * 100);
}

/** Las cuatro respuestas del motor a la disposición del día. */
export const MODO = {
  EMPUJAR: 'empujar',       // ≥78 — día para intentar un récord
  NORMAL: 'normal',         // 58-77 — la sesión como estaba planeada
  REDUCIR: 'reducir',       // 40-57 — solo los compuestos, sin accesorios
  RECUPERAR: 'recuperar',   // <40 — movilidad y caminata, no es un día perdido
};

export function modoPorDisposicion(d) {
  if (d >= 78) return MODO.EMPUJAR;
  if (d >= 58) return MODO.NORMAL;
  if (d >= 40) return MODO.REDUCIR;
  return MODO.RECUPERAR;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de fecha. Todo se indexa por día local en formato AAAA-MM-DD.
// Se usa la fecha local a propósito: el día del usuario es el que ve en su reloj,
// no el UTC. Guardar UTC acá haría que un entrenamiento de las 22:00 en Argentina
// cuente como del día siguiente.
// ─────────────────────────────────────────────────────────────────────────────
export function diaLocal(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function diasEntre(diaA, diaB) {
  const a = new Date(`${diaA}T00:00:00`);
  const b = new Date(`${diaB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

export function sumarDias(dia, n) {
  const d = new Date(`${dia}T00:00:00`);
  d.setDate(d.getDate() + n);
  return diaLocal(d.getTime());
}

export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function nombreDiaSemana(dia) {
  return DIAS_SEMANA[new Date(`${dia}T00:00:00`).getDay()];
}

export function nuevoId(prefijo = 'e') {
  return `${prefijo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
