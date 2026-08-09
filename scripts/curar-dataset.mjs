/**
 * curar-dataset.mjs — convierte el dataset crudo de hasaneyldrm/exercises-dataset
 * en los dos archivos que consume la app.
 *
 * Por qué existe este script y no se commiteó el JSON crudo:
 *   - El crudo pesa 17 MB porque trae las instrucciones en 10 idiomas, dos veces
 *     (texto corrido + pasos). Precachear eso en un celular es inaceptable.
 *   - El dataset NO trae patrón de movimiento. Un programa de fuerza no se arma con
 *     "músculo objetivo", se arma con patrones (empuje, tracción, bisagra, sentadilla...).
 *     Esa clasificación la agrega este script y es la razón por la que el motor puede
 *     armar sesiones equilibradas en vez de listar ejercicios de un músculo.
 *   - Los nombres vienen en inglés. Se traducen con un glosario determinista y se
 *     conserva el original en `en` para poder auditar cualquier traducción.
 *
 * Uso:  node scripts/curar-dataset.mjs [ruta-al-exercises.json]
 * Sin argumento, lo baja de GitHub.
 *
 * Salidas:
 *   data/ejercicios.json     índice liviano — se carga al arrancar
 *   data/instrucciones.json  pasos en español — se carga cuando se abre un ejercicio
 *   data/dataset-meta.json   procedencia, licencia y conteos (para la pantalla de créditos)
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json';
const BASE_MEDIA = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main';

// ─────────────────────────────────────────────────────────────────────────────
// Patrones de movimiento. El orden importa: se evalúa de arriba hacia abajo y
// gana la primera regla que matchea, así que lo específico va antes que lo genérico.
// ─────────────────────────────────────────────────────────────────────────────
const PATRONES = [
  // Bisagra de cadera — antes que sentadilla, porque "romanian deadlift" tiene ambas señales
  { id: 'bisagra', re: /\b(deadlift|romanian|good morning|hip thrust|glute bridge|swing|hyperextension|back extension|pull ?through|kettlebell clean|snatch)\b/ },
  // Zancada / unilateral de pierna — antes que sentadilla
  { id: 'zancada', re: /\b(lunge|split squat|step[- ]?up|bulgarian|pistol|curtsy|sissy)\b/ },
  { id: 'sentadilla', re: /\b(squat|leg press|hack|sled 45|box jump|jump squat)\b/ },
  { id: 'traccion_vertical', re: /\b(pull[- ]?up|chin[- ]?up|pulldown|pull[- ]?down|lat pull|muscle up)\b/ },
  { id: 'traccion_horizontal', re: /\b(row|face pull|rear delt|reverse fly|inverted row|shrug|high pull)\b/ },
  { id: 'empuje_vertical', re: /\b(overhead press|shoulder press|military|push press|handstand|arnold|landmine press|z press)\b/ },
  { id: 'empuje_horizontal', re: /\b(bench press|chest press|push[- ]?up|dip|fly|flye|pec deck|chest dip|floor press)\b/ },
  { id: 'transporte', re: /\b(farmer|carry|suitcase|waiter walk|sled drag|sled push)\b/ },
  { id: 'core', re: /\b(plank|crunch|sit[- ]?up|leg raise|russian twist|ab wheel|hollow|dead bug|pallof|woodchop|v[- ]?up|bicycle|mountain climber|side bend|toe touch|flutter)\b/ },
  { id: 'movilidad', re: /\b(stretch|mobility|foam roll|roller|cat cow|thread the needle|scapular|circles|rotation exercise|yoga)\b/ },
];

// El patrón como fallback según la parte del cuerpo, cuando el nombre no dice nada.
const PATRON_POR_TARGET = {
  abs: 'core', obliques: 'core', spine: 'core',
  calves: 'aislamiento', biceps: 'aislamiento', triceps: 'aislamiento',
  forearms: 'aislamiento', traps: 'aislamiento', delts: 'aislamiento',
  quads: 'aislamiento', hamstrings: 'aislamiento', glutes: 'aislamiento',
  adductors: 'aislamiento', abductors: 'aislamiento', pectorals: 'aislamiento',
  lats: 'aislamiento', 'upper back': 'aislamiento',
  'serratus anterior': 'aislamiento', 'levator scapulae': 'movilidad',
  'cardiovascular system': 'cardio',
};

// Compuestos = mueven más de una articulación. Definen la estructura de la sesión.
const COMPUESTOS = new Set([
  'bisagra', 'zancada', 'sentadilla', 'traccion_vertical',
  'traccion_horizontal', 'empuje_vertical', 'empuje_horizontal', 'transporte',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Equipamiento. Se agrupa en categorías que se pueden preguntar en el onboarding
// con 5 casilleros, en vez de mostrarle a alguien una lista de 28 items.
// ─────────────────────────────────────────────────────────────────────────────
const GRUPO_EQUIPO = {
  'body weight': 'peso_corporal', assisted: 'peso_corporal', weighted: 'peso_corporal',
  dumbbell: 'mancuernas', kettlebell: 'mancuernas',
  barbell: 'barra', 'ez barbell': 'barra', 'olympic barbell': 'barra', 'trap bar': 'barra',
  'smith machine': 'maquinas', 'leverage machine': 'maquinas', cable: 'maquinas',
  'sled machine': 'maquinas', hammer: 'maquinas',
  band: 'bandas', 'resistance band': 'bandas', rope: 'bandas',
  'medicine ball': 'accesorios', 'stability ball': 'accesorios', 'bosu ball': 'accesorios',
  roller: 'accesorios', 'wheel roller': 'accesorios', tire: 'accesorios',
  'stationary bike': 'cardio_maquina', 'elliptical machine': 'cardio_maquina',
  'stepmill machine': 'cardio_maquina', 'skierg machine': 'cardio_maquina',
  'upper body ergometer': 'cardio_maquina',
};

// ─────────────────────────────────────────────────────────────────────────────
// Traducción de nombres. El inglés nombra "equipo + modificadores + movimiento"
// ("barbell seated overhead press"); el español nombra "movimiento + modificadores
// + equipo" ("press militar sentado con barra"). Traducir palabra por palabra
// produce "Con barra sentado press militar", que es lo que salió en el primer
// intento. Así que se reordena: se saca el equipo, se aísla el núcleo del
// movimiento, y se reensambla en orden español.
//
// El nombre original queda en el campo `en` de cada ejercicio para poder auditar
// cualquier traducción sin volver al dataset crudo.
// ─────────────────────────────────────────────────────────────────────────────

// Núcleo del movimiento. Se busca la coincidencia MÁS LARGA, así que
// "romanian deadlift" gana sobre "deadlift".
const MOVIMIENTOS = {
  'bench press': 'press de banca', 'chest press': 'press de pecho',
  'shoulder press': 'press de hombros', 'overhead press': 'press militar',
  'military press': 'press militar', 'push press': 'push press',
  'floor press': 'press en el suelo', 'landmine press': 'press landmine',
  'leg press': 'prensa de piernas', 'shoulder pres': 'press de hombros',
  'skull crusher': 'press francés', 'french press': 'press francés',
  'jm press': 'press JM', press: 'press',
  'push-up': 'flexiones', 'push up': 'flexiones', pushup: 'flexiones',
  'pull-up': 'dominadas', 'pull up': 'dominadas', pullup: 'dominadas',
  'chin-up': 'dominadas supinas', 'chin up': 'dominadas supinas',
  'lat pulldown': 'jalón al pecho', pulldown: 'jalón', 'pull-down': 'jalón',
  'pull down': 'jalón', 'muscle up': 'muscle-up',
  'romanian deadlift': 'peso muerto rumano', 'stiff leg deadlift': 'peso muerto piernas rígidas',
  'straight leg deadlift': 'peso muerto piernas rígidas', 'sumo deadlift': 'peso muerto sumo',
  'single leg deadlift': 'peso muerto a una pierna', deadlift: 'peso muerto',
  'good morning': 'buenos días', 'hip thrust': 'empuje de cadera',
  'glute bridge': 'puente de glúteos', 'hip raise': 'elevación de cadera',
  'pull through': 'pull through', 'pull-through': 'pull through',
  'potty squat': 'sentadilla profunda', 'curtsey squat': 'sentadilla cruzada',
  'air squat': 'sentadilla libre', 'wall sit': 'sentadilla isométrica en pared',
  'side bend': 'flexión lateral', 'heel touch': 'toque de talón',
  'air bike': 'bicicleta en el aire', 'toe touch': 'toque de punta',
  'front squat': 'sentadilla frontal', 'hack squat': 'sentadilla hack',
  'split squat': 'sentadilla búlgara', 'jefferson squat': 'sentadilla Jefferson',
  'sissy squat': 'sentadilla sissy', 'zercher squat': 'sentadilla Zercher',
  'jump squat': 'sentadilla con salto', 'squat jump': 'sentadilla con salto',
  'full squat': 'sentadilla profunda', 'half squat': 'media sentadilla',
  'pistol squat': 'sentadilla pistol', 'box squat': 'sentadilla al cajón',
  squat: 'sentadilla',
  'curtsy lunge': 'zancada cruzada', 'walking lunge': 'zancada caminando',
  'reverse lunge': 'zancada atrás', lunge: 'zancada',
  'step-up': 'subida al cajón', 'step up': 'subida al cajón',
  'upright row': 'remo al mentón', 'inverted row': 'remo invertido',
  'high pull': 'cargada al mentón', 'face pull': 'face pull', row: 'remo',
  shrug: 'encogimiento de hombros',
  'hammer curl': 'curl martillo', 'preacher curl': 'curl predicador',
  'concentration curl': 'curl concentrado', 'bicep curl': 'curl de bíceps',
  'biceps curl': 'curl de bíceps', 'wrist curl': 'curl de muñeca',
  'reverse curl': 'curl inverso', 'leg curl': 'curl femoral',
  'drag curl': 'curl drag', 'spider curl': 'curl araña', curl: 'curl',
  'triceps extension': 'extensión de tríceps', 'tricep extension': 'extensión de tríceps',
  'leg extension': 'extensión de piernas', 'back extension': 'extensión lumbar',
  'hip extension': 'extensión de cadera', hyperextension: 'hiperextensión',
  extension: 'extensión',
  'calf raise': 'elevación de talones', 'lateral raise': 'elevación lateral',
  'front raise': 'elevación frontal', 'rear delt raise': 'elevación posterior',
  'leg raise': 'elevación de piernas', 'knee raise': 'elevación de rodillas',
  'hip raise ': 'elevación de cadera', 'calf press': 'prensa de gemelos', raise: 'elevación',
  'pec deck': 'peck deck', 'reverse fly': 'apertura invertida',
  'rear delt fly': 'apertura posterior', fly: 'aperturas', flye: 'aperturas',
  'russian twist': 'giro ruso', 'ab wheel': 'rueda abdominal',
  'mountain climber': 'escalador', 'dead bug': 'dead bug',
  'hollow hold': 'hollow hold', 'side plank': 'plancha lateral',
  'sit-up': 'abdominales', 'sit up': 'abdominales', situp: 'abdominales',
  'v-up': 'V-up', 'v up': 'V-up', 'toe touch': 'toques de punta',
  'flutter kick': 'patada de tijera', 'woodchop': 'leñador',
  'pallof press': 'press Pallof', crunch: 'crunch', plank: 'plancha',
  'chest dip': 'fondos de pecho', 'triceps dip': 'fondos de tríceps', dip: 'fondos',
  pullover: 'pullover', pushdown: 'extensión en polea', 'push-down': 'extensión en polea',
  'push down': 'extensión en polea', kickback: 'patada de tríceps',
  thruster: 'thruster', clean: 'cargada', snatch: 'arranque', jerk: 'envión',
  swing: 'swing', 'farmers walk': 'paseo del granjero', carry: 'carga',
  'jumping jack': 'saltos de tijera', burpee: 'burpees', 'box jump': 'salto al cajón',
  'jump rope': 'saltar la cuerda', 'jump squat ': 'sentadilla con salto',
  'foam roll': 'liberación con rodillo', stretch: 'estiramiento',
  'cat cow': 'gato-camello', 'thread the needle': 'enhebrar la aguja',
  twist: 'giro', run: 'correr', walk: 'caminar', march: 'marcha',
  bridge: 'puente', pushdown_: 'extensión en polea',
};

// Cómo se nombra cada equipo en español, y si va como sufijo.
// Sale del campo `equipment` del dataset, que es confiable — no de parsear el nombre.
const EQUIPO_ES = {
  barbell: 'con barra', 'ez barbell': 'con barra Z', 'olympic barbell': 'con barra olímpica',
  'trap bar': 'con barra hexagonal', dumbbell: 'con mancuernas', kettlebell: 'con kettlebell',
  cable: 'en polea', 'smith machine': 'en multipower', 'leverage machine': 'en máquina',
  'sled machine': 'en trineo', hammer: 'en máquina Hammer',
  band: 'con banda', 'resistance band': 'con banda elástica', rope: 'con cuerda',
  'medicine ball': 'con balón medicinal', 'stability ball': 'con fitball',
  'bosu ball': 'con bosu', roller: 'con rodillo', 'wheel roller': 'con rueda',
  tire: 'con neumático', weighted: 'lastrado', assisted: 'asistido',
  'body weight': '', // el peso corporal es el default, nombrarlo es ruido
  'stationary bike': 'en bicicleta fija', 'elliptical machine': 'en elíptica',
  'stepmill machine': 'en escaladora', 'skierg machine': 'en SkiErg',
  'upper body ergometer': 'en ergómetro de brazos',
};

// Modificadores. Van entre el movimiento y el equipo.
const MODIFICADORES = {
  'behind head': 'tras nuca', 'behind neck': 'tras nuca',
  'close grip': 'agarre cerrado', 'wide grip': 'agarre ancho',
  'reverse grip': 'agarre inverso', 'neutral grip': 'agarre neutro',
  'narrow grip': 'agarre cerrado', 'clean grip': 'agarre de cargada',
  'one arm': 'a un brazo', 'single arm': 'a un brazo', 'one leg': 'a una pierna',
  'single leg': 'a una pierna', 'two legs': 'a dos piernas', 'two arm': 'a dos brazos',
  'bent over': 'inclinado', 'bent knee': 'rodilla flexionada',
  'straight leg': 'pierna recta', 'straight arm': 'brazo recto',
  'on bench': 'en banco', 'on floor': 'en el suelo',
  'parallel bars': 'en paralelas',
  incline: 'inclinado', decline: 'declinado', seated: 'sentado', standing: 'de pie',
  lying: 'tumbado', kneeling: 'de rodillas', prone: 'boca abajo', supine: 'boca arriba',
  alternate: 'alterno', alternating: 'alterno', wide: 'abierto', narrow: 'cerrado',
  overhead: 'sobre la cabeza', reverse: 'inverso', side: 'lateral', lateral: 'lateral',
  front: 'frontal', rear: 'posterior', upper: 'superior', lower: 'inferior',
  hanging: 'colgado', jumping: 'con salto', isometric: 'isométrico',
  explosive: 'explosivo', eccentric: 'excéntrico', partial: 'parcial',
  bench: 'en banco', floor: 'en el suelo', wall: 'en pared', chair: 'en silla',
  bar: 'en barra', ball: 'con pelota', bosu: 'en bosu',
  chest: 'al pecho', shoulder: 'de hombro', leg: 'de pierna', arm: 'de brazo',
  hip: 'de cadera', back: 'de espalda', neck: 'de cuello', calf: 'de gemelo',
  glute: 'de glúteo', abdominal: 'abdominal', oblique: 'oblicuo',
  bicep: 'de bíceps', biceps: 'de bíceps', tricep: 'de tríceps', triceps: 'de tríceps',
  quad: 'de cuádriceps', hamstring: 'de isquiotibiales', lat: 'dorsal',
  wrist: 'de muñeca', ankle: 'de tobillo', shin: 'de tibial', forearm: 'de antebrazo',
  hand: 'de mano', finger: 'de dedos', knee: 'de rodilla', thigh: 'de muslo',
  full: 'completo', half: 'medio', high: 'alto', low: 'bajo',
  left: 'izquierdo', right: 'derecho', slow: 'lento',
  jump: 'con salto', forward: 'hacia adelante', backward: 'hacia atrás',
  march: 'con marcha', power: 'de potencia', point: '', clap: 'con palmada',
  plyo: 'pliométrico', suspended: 'en suspensión', flag: 'bandera',
  support: 'con apoyo', reach: 'con alcance', semi: 'media', drop: 'en caída',
  stabilization: 'con estabilización', touchers: 'toques', heel: 'de talón',
  apart: 'separados', circular: 'circular', air: 'al aire', bike: 'bicicleta',
  straight: 'recto', legs: 'piernas', arms: 'brazos', bend: 'flexión',
  slingers: 'balanceo', stagger: 'escalonado', staggered: 'escalonado',
  assisted_: 'asistido', otis: 'Otis', pike: 'pica', tuck: 'agrupado',
  with: 'con', and: 'y', down: 'hacia abajo', up: 'hacia arriba', out: 'hacia afuera',
  hang: 'colgado', double: 'doble', single: 'simple', throw: 'con lanzamiento',
  towel: 'con toalla', clock: 'reloj', bicycle: 'bicicleta', scissor: 'tijera',
  frog: 'rana', spider: 'araña', crab: 'cangrejo', bear: 'oso', cobra: 'cobra',
  gluteus: 'de glúteo', piriformis: 'de piramidal', pectoralis: 'pectoral',
  latissimus: 'dorsal', dorsi: '', deltoid: 'de deltoides', adductor: 'de aductores',
  abductor: 'de abductores', erector: 'lumbar', spinae: '', rectus: '', major: 'mayor',
  minor: 'menor', anterior: 'anterior', posterior: 'posterior', medial: 'medial',
  // ruido que se descarta
  male: '', female: '', version: '', variation: '', exercise: '', v: '',
  the: '', a: '', an: '', of: '', for: '', from: '', in: '', at: '', by: '',
  to: '', on: '', or: '', your: '', both: '',
};

const CLAVES_MOV = Object.keys(MOVIMIENTOS).sort((a, b) => b.length - a.length);
const CLAVES_MOD = Object.keys(MODIFICADORES).sort((a, b) => b.length - a.length);

const CATEGORIA_ES = {
  waist: 'core', 'upper legs': 'piernas', back: 'espalda', 'lower legs': 'gemelos',
  chest: 'pecho', 'upper arms': 'brazos', cardio: 'cardio', shoulders: 'hombros',
  'lower arms': 'antebrazos', neck: 'cuello',
};

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "barbell seated overhead press" + equipment:"barbell"
 *   → equipo: "con barra" · núcleo: "press militar" · mods: ["sentado"]
 *   → "Press militar sentado con barra"
 */
function traducirNombre(nombreEn, equipment) {
  let s = ` ${nombreEn.toLowerCase().replace(/[()]/g, ' ')} `;

  // 1. Sacar del nombre las palabras del equipo. El sufijo se decide por el campo
  //    `equipment`, que es un valor cerrado y confiable, no por parsear el nombre.
  for (const eq of Object.keys(EQUIPO_ES).sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(`(?<![a-z])${escapar(eq)}(?![a-z])`, 'g'), ' ');
  }
  s = s.replace(/(?<![a-z])(lever|machine|smith|cable|band|weighted|assisted|sled|self|body|weight)(?![a-z])/g, ' ');

  // 2. Aislar el núcleo del movimiento (coincidencia más larga primero).
  let nucleo = '';
  for (const clave of CLAVES_MOV) {
    const re = new RegExp(`(?<![a-z])${escapar(clave.trim())}(?![a-z])`);
    if (re.test(s)) { nucleo = MOVIMIENTOS[clave]; s = s.replace(re, ' '); break; }
  }

  // 3. Traducir el resto como modificadores, respetando el orden en que aparecían.
  const mods = [];
  for (const clave of CLAVES_MOD) {
    const re = new RegExp(`(?<![a-z])${escapar(clave)}(?![a-z])`, 'g');
    const pos = s.search(re);
    if (pos >= 0) {
      if (MODIFICADORES[clave]) mods.push({ pos, txt: MODIFICADORES[clave] });
      s = s.replace(re, ' ');
    }
  }
  // Lo que no está en ningún diccionario se conserva tal cual. Mejor un término en
  // inglés visible que un nombre mutilado en silencio: así se ve qué falta traducir.
  for (const resto of s.split(/\s+/).filter((w) => w.length > 1)) {
    mods.push({ pos: s.indexOf(resto), txt: resto });
  }
  mods.sort((a, b) => a.pos - b.pos);

  const partes = [nucleo, ...mods.map((m) => m.txt), EQUIPO_ES[equipment] ?? '']
    .filter(Boolean).join(' ')
    .replace(/\s+/g, ' ')
    // "Zancada con con salto": un modificador que ya trae preposición ("with" →
    // "con") seguido de otro que también la trae ("jump" → "con salto"). Se
    // colapsa acá una sola vez, en vez de cuidarlo en cada entrada del glosario.
    .replace(/\b(con|en|de|a|sin)\s+\1\b/gi, '$1')
    .trim();
  if (!partes) return nombreEn;
  return partes.charAt(0).toUpperCase() + partes.slice(1);
}

function clasificarPatron(ex) {
  const n = ` ${ex.name.toLowerCase()} `;
  for (const { id, re } of PATRONES) if (re.test(n)) return id;
  if (ex.category === 'cardio') return 'cardio';
  return PATRON_POR_TARGET[ex.target] || 'aislamiento';
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const argRuta = process.argv[2];
  let crudo;
  if (argRuta && existsSync(argRuta)) {
    console.log(`Leyendo ${argRuta}`);
    crudo = JSON.parse(readFileSync(argRuta, 'utf8'));
  } else {
    console.log(`Bajando ${FUENTE}`);
    const r = await fetch(FUENTE);
    if (!r.ok) throw new Error(`HTTP ${r.status} al bajar el dataset`);
    crudo = await r.json();
  }
  if (!Array.isArray(crudo)) throw new Error('El dataset crudo no es un array');

  const indice = [];
  const instrucciones = {};
  const conteoPatron = {};
  const sinPasosEs = [];

  for (const ex of crudo) {
    const patron = clasificarPatron(ex);
    conteoPatron[patron] = (conteoPatron[patron] || 0) + 1;

    const pasos = ex.instruction_steps?.es
      || (ex.instructions?.es ? ex.instructions.es.split(/(?<=\.)\s+/).filter(Boolean) : null);
    if (!pasos) sinPasosEs.push(ex.id);

    indice.push({
      id: ex.id,
      n: traducirNombre(ex.name, ex.equipment),          // nombre en español
      en: ex.name,                          // original, para auditar la traducción
      p: patron,                            // patrón de movimiento (lo agrega este script)
      c: COMPUESTOS.has(patron) ? 1 : 0,    // compuesto
      z: CATEGORIA_ES[ex.category] || ex.category, // zona
      t: ex.target,                         // músculo objetivo
      s: ex.secondary_muscles || [],
      e: ex.equipment,
      g: GRUPO_EQUIPO[ex.equipment] || 'otros',
      m: ex.media_id ? `${ex.id}-${ex.media_id}` : null, // sufijo para armar la URL del GIF
    });

    if (pasos) instrucciones[ex.id] = pasos;
  }

  const meta = {
    fuente: 'https://github.com/hasaneyldrm/exercises-dataset',
    licencia_datos: 'MIT (estructura, tooling e instrucciones)',
    licencia_media: '© Gym visual — redistribuido con permiso, atribución obligatoria',
    base_media: BASE_MEDIA,
    curado_el: new Date().toISOString().slice(0, 10),
    total: indice.length,
    con_instrucciones_es: Object.keys(instrucciones).length,
    por_patron: conteoPatron,
    nota: 'El patrón de movimiento y el nombre en español los agrega scripts/curar-dataset.mjs. No vienen en el dataset original.',
  };

  writeFileSync(resolve(RAIZ, 'data/ejercicios.json'), JSON.stringify(indice));
  writeFileSync(resolve(RAIZ, 'data/instrucciones.json'), JSON.stringify(instrucciones));
  writeFileSync(resolve(RAIZ, 'data/dataset-meta.json'), JSON.stringify(meta, null, 2));

  const kb = (p) => (readFileSync(resolve(RAIZ, p)).length / 1024).toFixed(0);
  console.log(`\n  ejercicios.json     ${kb('data/ejercicios.json')} KB   (${indice.length} ejercicios)`);
  console.log(`  instrucciones.json  ${kb('data/instrucciones.json')} KB   (${Object.keys(instrucciones).length} con pasos en ES)`);
  if (sinPasosEs.length) console.log(`  sin instrucciones ES: ${sinPasosEs.length}`);
  console.log('\n  por patrón:');
  for (const [p, n] of Object.entries(conteoPatron).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p.padEnd(22)} ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
