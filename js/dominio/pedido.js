/**
 * pedido.js — traduce lo que escribís a restricciones para el motor.
 *
 * "Hoy quiero espalda y tengo 40 minutos" → { patronPreferido: 'traccion_horizontal',
 * minutos: 40 }. Esas restricciones entran a `decidir()` como un parámetro más:
 * el motor sigue siendo la única autoridad sobre qué se hace y con cuánta carga.
 *
 * POR QUÉ ESTO ES DETERMINISTA Y NO LO HACE LA IA:
 * la negociación de la sesión es la función central de la v2, y una función
 * central no puede depender de que haya red, clave y saldo. Con clave, la IA
 * interpreta frases que esta tabla no cubre y devuelve el MISMO objeto; sin
 * clave, funciona igual con menos vocabulario. La IA amplía, nunca habilita.
 *
 * Sin DOM, sin red, sin IndexedDB: se prueba en el arnés.
 */

import { ZONA_DOLOR } from './modelo.js';

/**
 * Palabra → patrón. El orden importa: se prueban de la más específica a la más
 * general, porque "peso muerto" tiene que ganarle a "peso" y "dominadas" a
 * "espalda".
 */
const SINONIMOS = [
  [/\bpeso muerto\b|\bisquio|\bglut|\bbisagra\b|\bhip thrust\b/i, 'bisagra'],
  [/\bdominad|\bpull ?up|\bjal[oó]n\b|\bpolea alta\b|\bdorsal/i, 'traccion_vertical'],
  [/\bremo\b|\bespalda\b|\btracci[oó]n horizontal\b/i, 'traccion_horizontal'],
  [/\bpress militar\b|\bhombro?s?\b|\bdeltoid|\bempuje vertical\b/i, 'empuje_vertical'],
  [/\bpecho\b|\bpress de? ?banca\b|\bbanca\b|\bpectoral|\bflexion/i, 'empuje_horizontal'],
  [/\bsentadilla|\bcu[aá]driceps\b|\bpierna/i, 'sentadilla'],
  [/\bzancada|\bestocada|\bunilateral\b|\bb[uú]lgara/i, 'zancada'],
  [/\bcore\b|\babdomin|\bplancha\b/i, 'core'],
  [/\bbrazos?\b|\bb[ií]ceps\b|\btr[ií]ceps\b|\baislamiento\b/i, 'aislamiento'],
  [/\bmovilidad\b|\bestir/i, 'movilidad'],
];

const NEGACION = /\b(sin|no quiero|nada de|evit[aá]|saca|sacame|nada|menos)\b/i;
const DOLOR = /\bme duele\b|\bdolor de\b|\bmolestia en\b/i;

/**
 * @param {string} texto
 * @returns {{patronPreferido:string|null, excluirPatrones:string[], minutos:number|null, entendido:boolean}}
 */
export function interpretar(texto) {
  const t = (texto || '').toLowerCase();
  const salida = { patronPreferido: null, excluirPatrones: [], minutos: null, entendido: false };
  if (!t.trim()) return salida;

  // ── Minutos ───────────────────────────────────────────────────────────────
  const m = t.match(/(\d{1,3})\s*(min|minutos|')/);
  if (m) salida.minutos = Math.min(180, Math.max(10, Number(m[1])));
  else if (/\bmedia hora\b/.test(t)) salida.minutos = 30;
  else if (/\buna hora\b|\b1 hora\b/.test(t)) salida.minutos = 60;
  else if (/\bhora y media\b/.test(t)) salida.minutos = 90;
  if (salida.minutos) salida.entendido = true;

  // ── Dolor mencionado en la frase: bloquea como lo haría el check ──────────
  if (DOLOR.test(t)) {
    for (const [zonaId, def] of Object.entries(ZONA_DOLOR)) {
      const nombre = def.nombre.toLowerCase().replace(' ', ' ?');
      if (new RegExp(`\\b${nombre}`, 'i').test(t) || new RegExp(`\\b${zonaId.replace('_', ' ?')}`, 'i').test(t)) {
        salida.excluirPatrones.push(...def.bloquea);
        salida.entendido = true;
      }
    }
  }

  // ── Patrones nombrados ────────────────────────────────────────────────────
  // La frase se parte en cláusulas para que "espalda pero sin dominadas" no
  // termine pidiendo y excluyendo lo mismo.
  for (const clausula of t.split(/\s*(?:,|\.|;| pero | y sin | aunque )\s*/)) {
    if (!clausula.trim()) continue;
    const negada = NEGACION.test(clausula) || DOLOR.test(clausula);
    for (const [re, patron] of SINONIMOS) {
      if (!re.test(clausula)) continue;
      if (negada) {
        if (!salida.excluirPatrones.includes(patron)) salida.excluirPatrones.push(patron);
      } else if (!salida.patronPreferido) {
        salida.patronPreferido = patron;
      }
      salida.entendido = true;
      break;
    }
  }

  // Pedir y excluir el mismo patrón es una contradicción de la frase, no del
  // motor. Gana la exclusión: es la que protege.
  if (salida.patronPreferido && salida.excluirPatrones.includes(salida.patronPreferido)) {
    salida.patronPreferido = null;
  }
  salida.excluirPatrones = [...new Set(salida.excluirPatrones)];
  return salida;
}

/** Cómo se le cuenta al usuario lo que se entendió, para que pueda corregirlo. */
export function describir(restricciones, nombrePatron) {
  const partes = [];
  if (restricciones.patronPreferido) partes.push(`meto ${nombrePatron(restricciones.patronPreferido).toLowerCase()}`);
  if (restricciones.excluirPatrones?.length) {
    partes.push(`saco ${restricciones.excluirPatrones.map((p) => nombrePatron(p).toLowerCase()).join(' y ')}`);
  }
  if (restricciones.minutos) partes.push(`${restricciones.minutos} minutos`);
  return partes.length ? `Entendí: ${partes.join(' · ')}.` : 'No entendí qué cambiar. Probá con un patrón y un tiempo.';
}
