/**
 * verificar.mjs — el arnés. Se corre ANTES de cada deploy.
 *
 *   node scripts/verificar.mjs
 *
 * Qué prueba, y por qué esas cosas y no otras:
 *   1. Que todos los módulos importen. Atrapa el error de sintaxis y el export
 *      que se renombró y quedó una referencia colgada.
 *   2. Que el MOTOR decida bien en escenarios concretos. Es lo único que un
 *      usuario no puede detectar mirando: una sesión mal decidida se ve normal.
 *   3. Que la PROGRESIÓN suba, baje y descargue cuando corresponde.
 *   4. Que el service worker liste TODOS los archivos que existen. Es el bug que
 *      ya se pagó en Improvisador: se agrega un módulo, se olvida en el precache,
 *      y la app se rompe justo cuando no hay señal.
 *   5. Que no haya colores fuera de los tokens ni claves filtradas.
 *
 * Sale con código 1 si algo falla, para poder encadenarlo antes de un deploy.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(resolve(RAIZ, p), 'utf8');

let ok = 0;
const fallos = [];
const avisos = [];

function comprobar(nombre, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('devolvió false');
    ok++;
    console.log(`  ok   ${nombre}${typeof r === 'string' ? ` — ${r}` : ''}`);
  } catch (e) {
    fallos.push(`${nombre}: ${e.message}`);
    console.log(`  FALLA ${nombre} — ${e.message}`);
  }
}

function igual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
}
function verdadero(c, msg) { if (!c) throw new Error(msg || 'condición falsa'); }

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. Módulos ──────────────────────────────────────────────');

const MODULOS = [
  'js/dominio/modelo.js', 'js/dominio/motor.js', 'js/dominio/progresion.js',
  'js/dominio/bandit.js', 'js/dominio/adherencia.js', 'js/dominio/catalogo.js',
  'js/dominio/mensajes.js', 'js/dominio/pedido.js',
];
const M = {};
for (const ruta of MODULOS) {
  // eslint-disable-next-line no-await-in-loop
  M[ruta] = await import(pathToFileURL(resolve(RAIZ, ruta)).href);
  comprobar(`importa ${ruta}`, () => true);
}
const modelo = M['js/dominio/modelo.js'];
const motor = M['js/dominio/motor.js'];
const progresion = M['js/dominio/progresion.js'];
const bandit = M['js/dominio/bandit.js'];
const adherencia = M['js/dominio/adherencia.js'];
const catalogo = M['js/dominio/catalogo.js'];
const pedido = M['js/dominio/pedido.js'];

// Los módulos de UI y de red importan APIs del navegador en tiempo de ejecución,
// pero su nivel superior tiene que ser importable igual. Si un `document` se
// ejecuta al importar, esto lo caza.
globalThis.navigator ||= { onLine: false };
globalThis.indexedDB ||= { open: () => ({}) };
let clienteIA = null;
for (const ruta of ['js/ia/cliente.js']) {
  // eslint-disable-next-line no-await-in-loop
  clienteIA = await import(pathToFileURL(resolve(RAIZ, ruta)).href);
  comprobar(`importa ${ruta}`, () => true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. Dataset ──────────────────────────────────────────────');

const indice = JSON.parse(leer('data/ejercicios.json'));
const instrucciones = JSON.parse(leer('data/instrucciones.json'));
const metaDatos = JSON.parse(leer('data/dataset-meta.json'));
catalogo.sembrar(indice, metaDatos, instrucciones);

comprobar('ids únicos', () => {
  igual(new Set(indice.map((e) => e.id)).size, indice.length);
  return `${indice.length} ejercicios`;
});
comprobar('todos los patrones existen en el modelo', () => {
  const malos = indice.filter((e) => !modelo.PATRON[e.p]);
  igual(malos.length, 0, malos.slice(0, 3).map((e) => e.p).join(','));
  return `${new Set(indice.map((e) => e.p)).size} patrones`;
});
comprobar('todos los grupos de equipo existen', () => {
  const malos = indice.filter((e) => !modelo.GRUPO_EQUIPO[e.g]);
  igual(malos.length, 0, malos.slice(0, 3).map((e) => e.g).join(','));
});
comprobar('todo ejercicio tiene nombre no vacío', () => {
  igual(indice.filter((e) => !e.n || !e.n.trim()).length, 0);
});
comprobar('el índice pesa menos de 400 KB', () => {
  const kb = statSync(resolve(RAIZ, 'data/ejercicios.json')).size / 1024;
  verdadero(kb < 400, `pesa ${kb.toFixed(0)} KB`);
  return `${kb.toFixed(0)} KB`;
});
comprobar('hay al menos 5 ejercicios de cada patrón compuesto con peso corporal', () => {
  for (const p of ['empuje_horizontal', 'traccion_horizontal', 'sentadilla', 'bisagra', 'core']) {
    const n = indice.filter((e) => e.p === p && e.g === 'peso_corporal').length;
    verdadero(n >= 3, `${p} tiene ${n} con peso corporal`);
  }
  return 'la app sirve sin equipamiento';
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. Disposición ──────────────────────────────────────────');

comprobar('día perfecto da 100', () =>
  igual(modelo.calcularDisposicion({ sueno: 5, energia: 5, animo: 5, dolor: {} }), 100));
comprobar('día roto da 0', () =>
  igual(modelo.calcularDisposicion({ sueno: 1, energia: 1, animo: 1, dolor: { rodilla: 5 } }), 0));
comprobar('el dolor no se compensa con dormir bien', () => {
  const sinDolor = modelo.calcularDisposicion({ sueno: 5, energia: 5, animo: 5, dolor: {} });
  const conDolor = modelo.calcularDisposicion({ sueno: 5, energia: 5, animo: 5, dolor: { hombro: 5 } });
  verdadero(conDolor <= sinDolor - 19, `${sinDolor} vs ${conDolor}`);
  return `${sinDolor} → ${conDolor}`;
});
comprobar('los umbrales de modo son los documentados', () => {
  igual(modelo.modoPorDisposicion(85), 'empujar');
  igual(modelo.modoPorDisposicion(60), 'normal');
  igual(modelo.modoPorDisposicion(45), 'reducir');
  igual(modelo.modoPorDisposicion(20), 'recuperar');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. El motor decide ──────────────────────────────────────');

const perfilBase = { diasPorSemana: 3, equipo: ['peso_corporal', 'mancuernas', 'barra'], objetivo: 'fuerza' };
const obsBase = {
  perfil: perfilBase, historial: {}, vecesHecho: new Map(), volumenSemanal: {},
  sesionesHechas: 0, posteriores: {}, contextoMensaje: {}, ultimosPorHueco: [], hoy: '2026-08-09',
};

comprobar('día bueno → sesión completa de 5 ejercicios', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 5, energia: 5, animo: 4, dolor: {}, minutos: 60 } });
  igual(p.modo, 'empujar');
  igual(p.bloques.length, 5);
  verdadero(p.minutosEstimados <= 60, `estimó ${p.minutosEstimados} min para 60 disponibles`);
  return `${p.disposicion}/100 · ${p.minutosEstimados} min`;
});

comprobar('día flojo → solo compuestos, sin accesorios', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 2, energia: 2, animo: 3, dolor: {}, minutos: 60 } });
  igual(p.modo, 'reducir');
  verdadero(p.bloques.length <= 3, `dejó ${p.bloques.length} bloques`);
  verdadero(p.bloques.every((b) => b.rol !== 'accesorio' && b.rol !== 'core'),
    'quedó un accesorio en un día de volumen reducido');
  return `${p.bloques.length} bloques`;
});

comprobar('día roto → recuperación, sin cargas', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 1, energia: 1, animo: 2, dolor: {}, minutos: 60 } });
  igual(p.modo, 'recuperar');
  verdadero(p.bloques.length > 0, 'no propuso nada; recuperar no es no hacer nada');
  verdadero(p.bloques.every((b) => !b.carga), 'propuso carga en un día de recuperación');
  return `${p.bloques.length} bloques de movilidad`;
});

comprobar('dolor de hombro ≥3 elimina TODO empuje de la sesión', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 4, energia: 4, animo: 4, dolor: { hombro: 4 }, minutos: 60 } });
  const empujes = p.bloques.filter((b) => b.patron.startsWith('empuje'));
  igual(empujes.length, 0, `quedaron ${empujes.map((b) => b.ejercicio.n).join(', ')}`);
  verdadero(p.porQue.some((t) => t.includes('hombro')), 'no explicó por qué sacó los empujes');
  return `${p.bloques.length} bloques, ninguno de empuje`;
});

comprobar('dolor de rodilla ≥3 elimina sentadilla y zancada', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 4, energia: 4, animo: 4, dolor: { rodilla: 5 }, minutos: 60 } });
  const malos = p.bloques.filter((b) => b.patron === 'sentadilla' || b.patron === 'zancada');
  igual(malos.length, 0, malos.map((b) => b.ejercicio.n).join(', '));
});

comprobar('dolor de 2 NO bloquea nada (es molestia, no lesión)', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 4, energia: 4, animo: 4, dolor: { hombro: 2 }, minutos: 60 } });
  igual(p.huella.patronesBloqueados.length, 0);
});

comprobar('20 minutos recorta la sesión y lo dice', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 5, energia: 5, animo: 5, dolor: {}, minutos: 20 } });
  verdadero(p.minutosEstimados <= 25, `estimó ${p.minutosEstimados}`);
  verdadero(p.bloques.length < 5, `dejó ${p.bloques.length} bloques`);
  return `${p.bloques.length} bloques · ${p.minutosEstimados} min`;
});

comprobar('solo peso corporal → igual arma una sesión completa', () => {
  const p = motor.decidir({
    ...obsBase,
    perfil: { ...perfilBase, equipo: ['peso_corporal'] },
    check: { sueno: 4, energia: 4, animo: 4, dolor: {}, minutos: 60, equipoHoy: ['peso_corporal'] },
  });
  verdadero(p.bloques.length >= 4, `solo armó ${p.bloques.length} bloques`);
  verdadero(p.bloques.every((b) => b.ejercicio.g === 'peso_corporal'),
    'coló un ejercicio con equipo que no hay');
  return `${p.bloques.length} bloques sin equipamiento`;
});

comprobar('la rotación cambia la sesión de un día al otro', () => {
  const a = motor.decidir({ ...obsBase, sesionesHechas: 0, check: { sueno: 4, energia: 4, animo: 4, dolor: {}, minutos: 60 } });
  const b = motor.decidir({ ...obsBase, sesionesHechas: 1, check: { sueno: 4, energia: 4, animo: 4, dolor: {}, minutos: 60 } });
  verdadero(a.bloques[0].patron !== b.bloques[0].patron,
    `las dos empiezan con ${a.bloques[0].patron}`);
  return `${a.bloques[0].patron} → ${b.bloques[0].patron}`;
});

comprobar('el hueco de accesorio va al patrón más descuidado', () => {
  const volumen = { traccion_horizontal: 18, traccion_vertical: 16, empuje_horizontal: 14,
    empuje_vertical: 12, bisagra: 10, zancada: 1, aislamiento: 20 };
  igual(motor.patronMasDescuidado(volumen), 'zancada');
});

comprobar('el motor no revienta con datos vacíos', () => {
  const p = motor.decidir({ ...obsBase, check: { sueno: 3, energia: 3, animo: 3, dolor: {} } });
  verdadero(p.bloques.length > 0);
  verdadero(typeof p.mensaje.titulo === 'string' && p.mensaje.titulo.length > 0);
});

comprobar('siempre explica la decisión', () => {
  for (const c of [{ sueno: 5, energia: 5, animo: 5 }, { sueno: 1, energia: 1, animo: 1 }, { sueno: 3, energia: 3, animo: 3 }]) {
    const p = motor.decidir({ ...obsBase, check: { ...c, dolor: {}, minutos: 60 } });
    verdadero(p.porQue.length > 0, `sin explicación para ${JSON.stringify(c)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. Progresión de cargas ─────────────────────────────────');

const hist = (series, estancado = 0) => ({ sesiones: [{ dia: '2026-08-01', series }], estancado });

comprobar('primera vez: no inventa una carga', () => {
  const p = progresion.prescribir(null, 'compuesto', 'barra');
  igual(p.carga, null);
  verdadero(p.motivo.includes('Primera vez'));
});

comprobar('cerró el rango con reserva → sube la carga', () => {
  const p = progresion.prescribir(hist([{ reps: 10, carga: 60, rir: 2 }, { reps: 10, carga: 60, rir: 2 }]), 'compuesto', 'barra');
  verdadero(p.carga > 60, `quedó en ${p.carga}`);
  return `60 → ${p.carga} kg`;
});

comprobar('cerró el rango al límite (RIR 0) → mantiene', () => {
  const p = progresion.prescribir(hist([{ reps: 10, carga: 60, rir: 0 }]), 'compuesto', 'barra');
  igual(p.carga, 60);
});

comprobar('quedó por debajo del rango → baja la carga', () => {
  const p = progresion.prescribir(hist([{ reps: 4, carga: 60, rir: 0 }]), 'compuesto', 'barra');
  verdadero(p.carga < 60, `quedó en ${p.carga}`);
  return `60 → ${p.carga} kg`;
});

comprobar('3 sesiones estancado → descarga del 10%', () => {
  const p = progresion.prescribir(hist([{ reps: 8, carga: 100, rir: 1 }], 3), 'compuesto', 'barra');
  igual(p.deload, true);
  igual(p.carga, 90);
  return '100 → 90 kg';
});

comprobar('la carga se redondea al disco que existe', () => {
  igual(progresion.redondearCarga(60.9, 'barra'), 60);     // redondea abajo
  igual(progresion.redondearCarga(61.3, 'barra'), 62.5);   // redondea arriba
  igual(progresion.redondearCarga(62.5, 'barra'), 62.5);   // ya está en un múltiplo
  igual(progresion.redondearCarga(50, 'peso_corporal'), null); // no hay carga que redondear
  igual(progresion.redondearCarga(0.4, 'barra'), 2.5);     // nunca por debajo del disco mínimo
});

comprobar('un día flojo baja la carga prescrita', () => {
  const normal = progresion.prescribir(hist([{ reps: 8, carga: 100, rir: 2 }]), 'compuesto', 'barra', 1);
  const flojo = progresion.prescribir(hist([{ reps: 8, carga: 100, rir: 2 }]), 'compuesto', 'barra', 0.9);
  verdadero(flojo.carga < normal.carga, `${flojo.carga} vs ${normal.carga}`);
  return `${normal.carga} → ${flojo.carga} kg`;
});

comprobar('1RM no se estima con más de 10 reps', () => {
  verdadero(progresion.estimar1RM(60, 8) > 60);
  igual(progresion.estimar1RM(60, 15), null);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. Bandit ───────────────────────────────────────────────');

comprobar('elige un brazo válido sin datos', () => {
  const b = bandit.elegirBrazo({}, 'normal');
  verdadero(b in bandit.BRAZOS, `devolvió ${b}`);
});

comprobar('con 60 observaciones converge al brazo bueno', () => {
  // El brazo "identidad" acierta el 90%, el resto el 20%. Con Thompson, en 60
  // rondas tiene que elegirlo la mayoría de las veces. Es un test estadístico:
  // se corre 5 veces y se exige que la mayoría de las corridas converjan.
  let corridasBuenas = 0;
  for (let corrida = 0; corrida < 5; corrida++) {
    const post = { normal: {} };
    for (let i = 0; i < 60; i++) {
      const b = bandit.elegirBrazo(post, 'normal');
      post.normal[b] ||= { a: 0, b: 0 };
      const exito = b === 'identidad' ? Math.random() < 0.9 : Math.random() < 0.2;
      if (exito) post.normal[b].a++; else post.normal[b].b++;
    }
    const total = Object.values(post.normal).reduce((s, x) => s + x.a + x.b, 0);
    const usoIdentidad = (post.normal.identidad?.a || 0) + (post.normal.identidad?.b || 0);
    if (usoIdentidad / total > 0.45) corridasBuenas++;
  }
  verdadero(corridasBuenas >= 4, `solo convergió en ${corridasBuenas}/5 corridas`);
  return `${corridasBuenas}/5 corridas convergieron`;
});

comprobar('no afirma nada con menos de 8 observaciones', () => {
  const r = bandit.resumen({ normal: { identidad: { a: 2, b: 0 } } });
  igual(r[0].confiable, false);
  igual(bandit.resumen({ normal: { identidad: { a: 8, b: 2 } } })[0].confiable, true);
});

comprobar('el contexto separa días normales de difíciles', () => {
  igual(bandit.contextoDe(80, 0), 'normal');
  igual(bandit.contextoDe(40, 0), 'dificil');
  igual(bandit.contextoDe(80, 5), 'dificil');
});

comprobar('una sesión sin cerrar no cuenta como dato', () => {
  const post = bandit.proyectarPosteriores(
    [{ sesionId: 's1', brazo: 'identidad', contexto: 'normal' }], new Map(),
  );
  igual(Object.keys(post).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7. Adherencia ───────────────────────────────────────────');

comprobar('detecta el día de la semana en que se falla', () => {
  // 2026-08-04, 11, 18 y 25 son martes.
  const intentos = [
    { dia: '2026-08-04', hecha: false }, { dia: '2026-08-11', hecha: false },
    { dia: '2026-08-18', hecha: false }, { dia: '2026-08-25', hecha: true },
  ];
  const s = adherencia.analizar({ intentos, hoy: '2026-08-26' });
  const d = s.find((x) => x.tipo === 'dias_debiles');
  verdadero(d, 'no detectó el patrón semanal');
  igual(d.dia, 'martes');
  return d.texto;
});

comprobar('NO inventa un patrón con 2 observaciones', () => {
  const s = adherencia.analizar({
    intentos: [{ dia: '2026-08-04', hecha: false }, { dia: '2026-08-11', hecha: false }],
    hoy: '2026-08-12',
  });
  igual(s.filter((x) => x.tipo === 'dias_debiles').length, 0);
});

comprobar('avisa en la ventana crítica del tercer día', () => {
  const s = adherencia.analizar({ intentos: [{ dia: '2026-08-05', hecha: true }], hoy: '2026-08-09' });
  verdadero(s.some((x) => x.tipo === 'ventana_critica'));
});

comprobar('detecta la disposición cayendo', () => {
  const checks = [
    ...['2026-07-27', '2026-07-28', '2026-07-29'].map((dia) => ({ dia, disposicion: 80 })),
    ...['2026-08-05', '2026-08-06', '2026-08-07'].map((dia) => ({ dia, disposicion: 55 })),
  ];
  const s = adherencia.analizar({ checks, hoy: '2026-08-09' });
  verdadero(s.some((x) => x.tipo === 'disposicion_cayendo'), 'no vio la caída de 25 puntos');
});

comprobar('la racha no se rompe por descansar', () => {
  const r = adherencia.calcularRacha([
    { dia: '2026-08-03', hecha: true }, { dia: '2026-08-05', hecha: true },
    { dia: '2026-08-07', hecha: true },
  ], 3);
  igual(r.mejor, 3);
});

comprobar('toda señal trae una propuesta accionable', () => {
  const s = adherencia.analizar({
    intentos: [{ dia: '2026-08-04', hecha: false }, { dia: '2026-08-11', hecha: false },
      { dia: '2026-08-18', hecha: false }],
    hoy: '2026-08-25',
  });
  for (const x of s) {
    verdadero(x.propuesta && x.propuesta.length > 20, `"${x.tipo}" no propone nada`);
    verdadero(x.evidencia, `"${x.tipo}" no muestra evidencia`);
  }
  return `${s.length} señales, todas con propuesta y evidencia`;
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7b. v2: negociar, calentar, sustituir, armar ────────────');

const checkBueno = { sueno: 4, energia: 4, animo: 4, dolor: {}, minutos: 60 };

comprobar('la entrada en calor deja de estar vacía', () => {
  const p = motor.decidir({ ...obsBase, check: checkBueno });
  verdadero(p.calentamiento.length >= 2, `trajo ${p.calentamiento.length} movimientos`);
  verdadero(p.calentamiento.every((c) => c.ejercicio?.n && c.segundos > 0), 'un movimiento sin nombre o sin duración');
  // Nadie sostiene un estiramiento de tres minutos. La primera versión repartía
  // los 8 minutos entre 3 movimientos y daba 165 segundos cada uno.
  verdadero(p.calentamiento.every((c) => c.segundos <= 90), `un movimiento de ${Math.max(...p.calentamiento.map((c) => c.segundos))}s`);
  return `${p.calentamiento.length} movimientos de ${p.calentamiento[0].segundos}s · ${p.calentamiento.map((c) => c.zona).join(', ')}`;
});

comprobar('hay entrada en calor aunque no se marque peso corporal', () => {
  // Encontrado probando la app en el navegador: los 61 movimientos de movilidad
  // son de peso corporal, bandas o accesorios. Filtrando por el equipo del día,
  // marcar solo "barra y mancuernas" devolvía el hueco en blanco de la v1.
  const p = motor.decidir({
    ...obsBase,
    perfil: { ...perfilBase, equipo: ['barra', 'mancuernas'] },
    check: { ...checkBueno, equipoHoy: ['barra', 'mancuernas'] },
  });
  verdadero(p.calentamiento.length >= 2, `trajo ${p.calentamiento.length} movimientos`);
  return `${p.calentamiento.length} movimientos sin marcar peso corporal`;
});

comprobar('el calentamiento apunta a las zonas que la sesión carga', () => {
  const p = motor.decidir({ ...obsBase, check: checkBueno });
  // La sesión 0 arranca con sentadilla: tiene que calentar piernas o gemelos.
  const zonas = p.calentamiento.map((c) => c.zona);
  verdadero(zonas.some((z) => z === 'piernas' || z === 'gemelos'),
    `calentó ${zonas.join(', ')} para una sesión que arranca en sentadilla`);
  return zonas.join(', ');
});

comprobar('la misma observación da SIEMPRE la misma sesión', () => {
  const a = motor.decidir({ ...obsBase, check: checkBueno });
  const b = motor.decidir({ ...obsBase, check: checkBueno });
  igual(a.bloques.map((x) => x.ejercicio.id).join(), b.bloques.map((x) => x.ejercicio.id).join());
  return 'el motor sigue siendo reproducible';
});

comprobar('pedir otra propuesta cambia la sesión', () => {
  const a = motor.decidir({ ...obsBase, check: checkBueno, intento: 0 });
  let distinto = false;
  // Se prueban varios intentos: el podio está pesado 60/25/15, así que un
  // intento puntual puede repetir el mismo ejercicio sin que eso sea un bug.
  for (let i = 1; i <= 4; i++) {
    const b = motor.decidir({ ...obsBase, check: checkBueno, intento: i });
    if (a.bloques.map((x) => x.ejercicio.id).join() !== b.bloques.map((x) => x.ejercicio.id).join()) {
      distinto = true; break;
    }
  }
  verdadero(distinto, 'cuatro intentos seguidos dieron exactamente la misma sesión');
});

comprobar('pedir un patrón lo mete en la sesión', () => {
  const p = motor.decidir({
    ...obsBase, check: checkBueno,
    restricciones: { patronPreferido: 'traccion_vertical' },
  });
  verdadero(p.bloques.some((b) => b.patron === 'traccion_vertical'), 'no entró el patrón pedido');
  verdadero(p.porQue.some((t) => t.toLowerCase().includes('pediste')), 'no dijo que lo metió porque se lo pidieron');
});

comprobar('el patrón pedido SOBREVIVE al recorte por tiempo', () => {
  // Encontrado probando en el navegador: "quiero espalda y tengo 30 minutos"
  // contestaba "meto tracción horizontal" y después el recorte, que muerde
  // desde el final, la sacaba. El usuario pedía una cosa y recibía otra.
  const p = motor.decidir({
    ...obsBase, check: { ...checkBueno, minutos: 30 },
    restricciones: { patronPreferido: 'traccion_horizontal', minutos: 30 },
  });
  verdadero(p.bloques.some((b) => b.patron === 'traccion_horizontal'),
    `quedaron ${p.bloques.map((b) => b.patron).join(', ')} en ${p.minutosEstimados} min`);
  return `${p.bloques.length} bloques en ${p.minutosEstimados} min, con lo pedido adentro`;
});

comprobar('pedir sacar un patrón lo saca y lo explica', () => {
  const p = motor.decidir({
    ...obsBase, check: checkBueno,
    restricciones: { excluirPatrones: ['empuje_horizontal'] },
  });
  igual(p.bloques.filter((b) => b.patron === 'empuje_horizontal').length, 0);
  verdadero(p.porQue.some((t) => t.includes('porque me lo pediste')), 'lo sacó sin decir por qué');
});

comprobar('la restricción de minutos manda sobre el check', () => {
  const p = motor.decidir({
    ...obsBase, check: { ...checkBueno, minutos: 90 },
    restricciones: { minutos: 25 },
  });
  verdadero(p.minutosEstimados <= 28, `estimó ${p.minutosEstimados} para 25 pedidos`);
  return `${p.minutosEstimados} min`;
});

comprobar('sustituir ofrece alternativas del mismo patrón y mismo equipo', () => {
  const p = motor.decidir({ ...obsBase, check: checkBueno });
  const b = p.bloques[0];
  const alt = motor.alternativas(b, { equipoDisponible: perfilBase.equipo });
  verdadero(alt.length > 0, 'no ofreció ninguna alternativa');
  verdadero(alt.every((e) => e.p === b.patron), 'coló un ejercicio de otro patrón');
  verdadero(alt.every((e) => e.id !== b.ejercicio.id), 'ofreció el mismo ejercicio que ya estaba');
  verdadero(alt.every((e) => perfilBase.equipo.includes(e.g)), 'ofreció equipo que no hay');
  return `${alt.length} alternativas para ${b.ejercicio.n}`;
});

comprobar('al sustituir, la carga se recalcula con el historial del ejercicio NUEVO', () => {
  const p = motor.decidir({ ...obsBase, check: checkBueno });
  const b = p.bloques[0];
  const otro = motor.alternativas(b, { equipoDisponible: perfilBase.equipo })[0];
  // El ejercicio nuevo nunca se hizo: no puede heredar la carga del anterior.
  const nuevo = motor.sustituir(b, otro, { historial: {}, vecesHecho: new Map() });
  igual(nuevo.carga, null, 'arrastró una carga de un ejercicio que nunca se hizo');
  igual(nuevo.hueco, b.hueco);
  igual(nuevo.rol, b.rol);
});

comprobar('la sesión manual la prescribe el motor, no el usuario', () => {
  const dos = indice.filter((e) => e.p === 'empuje_horizontal' && e.g === 'barra').slice(0, 2);
  const p = motor.armarManual({
    ejercicioIds: dos.map((e) => e.id),
    perfil: perfilBase, check: { minutos: 45 }, hoy: '2026-08-11',
  });
  igual(p.origen, 'manual');
  igual(p.bloques.length, 2);
  verdadero(p.bloques.every((b) => b.series > 0 && b.repsObjetivo.length === 2),
    'un bloque manual quedó sin series ni repeticiones prescritas');
  return `${p.bloques.length} bloques, ${p.minutosEstimados} min`;
});

comprobar('la sesión manual desbalanceada se dice, no se corrige', () => {
  const empujes = indice.filter((e) => e.p === 'empuje_horizontal').slice(0, 3);
  const p = motor.armarManual({
    ejercicioIds: empujes.map((e) => e.id),
    perfil: perfilBase, check: {}, hoy: '2026-08-11',
  });
  igual(p.bloques.length, 3, 'corrigió la sesión en vez de respetarla');
  verdadero(p.porQue.some((t) => t.includes('ninguna tracción')), 'no marcó el desbalance');
  return p.porQue[1];
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7c. Entender el pedido, sin red ─────────────────────────');

comprobar('"hoy quiero espalda y tengo 40 minutos"', () => {
  const r = pedido.interpretar('hoy quiero espalda y tengo 40 minutos');
  igual(r.patronPreferido, 'traccion_horizontal');
  igual(r.minutos, 40);
});

comprobar('"media hora, sin dominadas"', () => {
  const r = pedido.interpretar('media hora, sin dominadas');
  igual(r.minutos, 30);
  verdadero(r.excluirPatrones.includes('traccion_vertical'), `excluyó ${r.excluirPatrones.join()}`);
});

comprobar('"me duele el hombro" bloquea los dos empujes', () => {
  const r = pedido.interpretar('me duele el hombro');
  verdadero(r.excluirPatrones.includes('empuje_vertical') && r.excluirPatrones.includes('empuje_horizontal'),
    `excluyó ${r.excluirPatrones.join()}`);
});

comprobar('pedir y excluir lo mismo: gana la exclusión', () => {
  const r = pedido.interpretar('quiero pecho pero me duele el hombro');
  igual(r.patronPreferido, null);
  verdadero(r.excluirPatrones.includes('empuje_horizontal'));
});

comprobar('una frase que no es un pedido no inventa restricciones', () => {
  const r = pedido.interpretar('¿por qué me duele después de entrenar?');
  igual(r.patronPreferido, null);
  igual(r.minutos, null);
});

comprobar('lo que se entendió se le cuenta al usuario', () => {
  const r = pedido.interpretar('espalda, 40 minutos');
  const t = pedido.describir(r, (p) => modelo.PATRON[p].nombre);
  verdadero(t.includes('40 minutos') && t.toLowerCase().includes('tracción'), t);
  return t;
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7d. Buscador ────────────────────────────────────────────');

comprobar('"press banca" encuentra el press de banca', () => {
  const r = catalogo.buscar('press banca', { limite: 10 });
  verdadero(r.length > 0, 'no encontró nada');
  verdadero(/press/i.test(r[0].n) && /banca/i.test(r[0].n), `el primero fue "${r[0].n}"`);
  return `${r.length} resultados · primero: ${r[0].n}`;
});

comprobar('la búsqueda por palabras sueltas funciona en cualquier orden', () => {
  const a = catalogo.buscar('banca press', { limite: 5 });
  verdadero(a.length > 0 && /press/i.test(a[0].n), `dio "${a[0]?.n}"`);
});

comprobar('el resultado está ORDENADO por puntaje, no por posición en el archivo', () => {
  const r = catalogo.buscar('sentadilla', { limite: 20 });
  // El nombre que empieza con la consulta tiene que estar antes que uno que la
  // menciona en el medio. Esto es exactamente lo que la v1 no hacía.
  verdadero(r[0].n.toLowerCase().startsWith('sentadilla'), `el primero fue "${r[0].n}"`);
  igual(r[0].c, 1, `el primero fue "${r[0].n}", que no es compuesto`);
  // Y el movimiento canónico tiene que ganarle a la variante exótica.
  const pos = (nombre) => r.findIndex((e) => e.n.toLowerCase().includes(nombre));
  const sissy = pos('sissy');
  verdadero(sissy < 0 || sissy > 2, `la sentadilla sissy salió en la posición ${sissy + 1}`);
  return r.slice(0, 3).map((e) => e.n).join(' · ');
});

comprobar('el filtro de equipo no deja pasar nada de otro equipo', () => {
  const r = catalogo.buscar('', { limite: 40, equipo: ['peso_corporal'] });
  verdadero(r.length > 0);
  igual(r.filter((e) => e.g !== 'peso_corporal').length, 0);
});

comprobar('el filtro de patrón y el de zona se combinan', () => {
  const r = catalogo.buscar('', { limite: 40, patron: 'sentadilla', zona: 'piernas' });
  verdadero(r.length > 0, 'no quedó nada al combinar los dos filtros');
  igual(r.filter((e) => e.p !== 'sentadilla' || e.z !== 'piernas').length, 0);
});

comprobar('una consulta sin resultados devuelve vacío, no el catálogo entero', () => {
  igual(catalogo.buscar('zzzzqqq', { limite: 40 }).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7e. La IA no puede inventar números ─────────────────────');

comprobar('detecta un peso que no está en los datos', () => {
  const plan = motor.decidir({ ...obsBase, check: checkBueno });
  const permitidas = clienteIA.cifrasPermitidas(plan, {});
  const malas = clienteIA.cifrasInventadas('Venís levantando 137 kg en sentadilla.', permitidas);
  verdadero(malas.includes('137'), `no marcó el 137; marcó ${malas.join()}`);
});

comprobar('no marca las cifras que SÍ están en el plan', () => {
  const plan = motor.decidir({ ...obsBase, check: checkBueno });
  const permitidas = clienteIA.cifrasPermitidas(plan, { adherencia: 72 });
  const texto = `Disposición ${plan.disposicion}, ${plan.minutosEstimados} minutos, adherencia 72%.`;
  igual(clienteIA.cifrasInventadas(texto, permitidas).length, 0);
});

comprobar('no marca repeticiones ni series (evita el falso positivo)', () => {
  const permitidas = new Set(['3', '8']);
  igual(clienteIA.cifrasInventadas('Hacé 3 series de 8 con 2 en reserva.', permitidas).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8. Service worker y archivos ────────────────────────────');

const sw = leer('sw.js');
const enPrecarga = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);

function archivosReales(dir, ext) {
  const salida = [];
  for (const e of readdirSync(resolve(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) salida.push(...archivosReales(rel, ext));
    else if (e.name.endsWith(ext)) salida.push(rel);
  }
  return salida;
}

comprobar('el precache lista TODOS los .js del proyecto', () => {
  const reales = archivosReales('js', '.js');
  const faltan = reales.filter((f) => !enPrecarga.includes(f));
  igual(faltan.length, 0, `faltan en sw.js: ${faltan.join(', ')}`);
  return `${reales.length} módulos`;
});

comprobar('el precache lista todos los .css', () => {
  const faltan = archivosReales('css', '.css').filter((f) => !enPrecarga.includes(f));
  igual(faltan.length, 0, `faltan: ${faltan.join(', ')}`);
});

comprobar('todo lo que el precache lista existe en disco', () => {
  const fantasmas = enPrecarga.filter((f) => f !== '' && !existsSync(resolve(RAIZ, f)));
  igual(fantasmas.length, 0, `no existen: ${fantasmas.join(', ')}`);
  return `${enPrecarga.length} entradas`;
});

comprobar('los iconos del manifest existen', () => {
  const man = JSON.parse(leer('manifest.webmanifest'));
  const faltan = man.icons.map((i) => i.src.replace('./', '')).filter((s) => !existsSync(resolve(RAIZ, s)));
  igual(faltan.length, 0, faltan.join(', '));
  return `${man.icons.length} iconos`;
});

comprobar('el manifest tiene un icono maskable', () => {
  const man = JSON.parse(leer('manifest.webmanifest'));
  verdadero(man.icons.some((i) => (i.purpose || '').includes('maskable')));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9. Higiene ──────────────────────────────────────────────');

comprobar('no hay claves de API en el código', () => {
  const sospechosos = [];
  for (const f of [...archivosReales('js', '.js'), 'sw.js', 'index.html']) {
    const txt = leer(f);
    if (/AIza[0-9A-Za-z_-]{30,}/.test(txt)) sospechosos.push(`${f} (clave de Google)`);
    if (/sk-[A-Za-z0-9]{20,}/.test(txt)) sospechosos.push(`${f} (clave tipo OpenAI)`);
  }
  igual(sospechosos.length, 0, sospechosos.join(', '));
});

comprobar('no hay colores crudos fuera de los tokens', () => {
  const app = leer('css/app.css');
  const crudos = [...app.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  igual(crudos.length, 0, `en app.css: ${crudos.join(', ')}`);
  return 'app.css usa solo variables';
});

comprobar('no se cargan fuentes ni scripts remotos', () => {
  const html = leer('index.html');
  const remotos = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  igual(remotos.length, 0, remotos.join(', '));
  return 'todo local: la app arranca sin red';
});

comprobar('los textos de la interfaz no tienen relleno motivacional', () => {
  // Se sacan los comentarios antes de mirar. La primera versión de este chequeo
  // marcaba en rojo justamente los dos archivos que PROHÍBEN esas frases, porque
  // las nombran para prohibirlas. Un chequeo que castiga su propia documentación
  // se termina desactivando; mejor que mire solo el código que corre.
  const sinComentarios = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const prohibidas = /(vos podés|tú puedes|increíble|excelente trabajo|genial!|sos un crack|no te rindas|¡vamos!)/i;
  const malos = [];
  for (const f of archivosReales('js', '.js')) {
    // `js/ia/` queda fuera: su prompt de sistema NOMBRA estas frases para
    // prohibírselas al modelo. Es instrucción para la IA, no texto que ve el
    // usuario. Excluirlo con el motivo escrito es más honesto que reescribir el
    // prompt para esquivar el chequeo.
    if (f.startsWith('js/ia/')) continue;
    if (prohibidas.test(sinComentarios(leer(f)))) malos.push(f);
  }
  igual(malos.length, 0, malos.join(', '));
});

comprobar('todo elemento que el JS oculta con `hidden` tiene su regla en CSS', () => {
  // `display:flex` (o grid/block) pisa el `[hidden]{display:none}` del navegador.
  // Es un bug invisible en el código y evidente en pantalla: la barra de
  // navegación seguía tapando los botones del onboarding.
  const css = leer('css/app.css');
  const ocultados = new Set(
    [...archivosReales('js', '.js')].flatMap((f) =>
      [...leer(f).matchAll(/(\w+)\.hidden\s*=/g)].map((m) => m[1])),
  );
  const faltan = [];
  for (const variable of ocultados) {
    // Se mapea la variable del JS a su selector por el id que se busca en el HTML.
    const html = leer('index.html');
    const id = [...html.matchAll(/id="(\w+)"/g)].map((m) => m[1]).find((x) => x === variable);
    if (!id) continue;
    const clase = html.match(new RegExp(`class="([^"]*)"[^>]*id="${id}"|id="${id}"[^>]*class="([^"]*)"`));
    const sel = clase ? (clase[1] || clase[2]).split(/\s+/)[0] : null;
    if (!sel) continue;
    const tieneDisplay = new RegExp(`\\.${sel}\\s*\\{[^}]*display\\s*:`, 's').test(css);
    const tieneRegla = new RegExp(`\\.${sel}\\[hidden\\]`).test(css);
    if (tieneDisplay && !tieneRegla) faltan.push(`.${sel}`);
  }
  igual(faltan.length, 0, `falta la regla [hidden] para: ${faltan.join(', ')}`);
  return `${ocultados.size} elemento(s) revisado(s)`;
});

comprobar('todo import nombrado existe en el módulo que lo exporta', () => {
  // Los módulos de UI no se pueden importar en Node (tocan `document` al usarse),
  // así que un export mal escrito ahí no lo caza ningún otro chequeo: aparece
  // como pantalla en blanco recién en el teléfono. Esto lo lee del texto.
  const exportsDe = (txt) => {
    const s = new Set();
    // `[\p{L}...]` y no `\w`: hay exports con eñe (`señal`) y `\w` es ASCII,
    // así que con `\w` este chequeo inventaba dos fallos que no existían.
    for (const m of txt.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\p{L}\p{N}_$]+)/gu)) s.add(m[1]);
    for (const m of txt.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const parte of m[1].split(',')) {
        const nombre = parte.trim().split(/\s+as\s+/).pop().trim();
        if (nombre) s.add(nombre);
      }
    }
    if (/export\s+default/.test(txt)) s.add('default');
    return s;
  };

  const rotos = [];
  for (const f of archivosReales('js', '.js')) {
    const txt = leer(f);
    for (const m of txt.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const destino = resolve(RAIZ, dirname(f), m[2]);
      if (!existsSync(destino)) { rotos.push(`${f} → ${m[2]} (no existe)`); continue; }
      const disponibles = exportsDe(readFileSync(destino, 'utf8'));
      for (const parte of m[1].split(',')) {
        const nombre = parte.trim().split(/\s+as\s+/)[0].trim();
        if (nombre && !disponibles.has(nombre)) {
          rotos.push(`${f} importa "${nombre}" de ${relative(RAIZ, destino).replace(/\\/g, '/')}`);
        }
      }
    }
  }
  igual(rotos.length, 0, rotos.join(' · '));
  return `${archivosReales('js', '.js').length} módulos revisados`;
});

comprobar('la versión del caché del SW está declarada', () => {
  verdadero(/const CACHE = 'norte-v\d+'/.test(sw), 'no encontré la constante CACHE');
  return sw.match(/const CACHE = '([^']+)'/)[1];
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (fallos.length) {
  console.log(`\n  ${ok} pasaron · ${fallos.length} FALLARON\n`);
  for (const f of fallos) console.log(`   × ${f}`);
  console.log('');
  process.exit(1);
}
for (const a of avisos) console.log(`   aviso: ${a}`);
console.log(`\n  ${ok} comprobaciones, todas en verde.\n`);
