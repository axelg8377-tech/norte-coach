/**
 * catalogo.js — acceso al dataset de ejercicios ya curado.
 *
 * El índice (285 KB) se carga al arrancar y vive en memoria. Las instrucciones
 * (702 KB) se cargan la primera vez que se abre el detalle de un ejercicio: no
 * hacen falta para decidir la sesión, y cargarlas al arranque retrasaría la
 * primera pantalla sin que nadie las esté mirando.
 *
 * Campos del índice, abreviados a propósito para que el JSON pese menos:
 *   id · n(ombre es) · en(nombre original) · p(atrón) · c(ompuesto) · z(ona)
 *   t(arget) · s(ecundarios) · e(quipo) · g(rupo de equipo) · m(edia id)
 */

let _indice = null;
let _porId = null;
let _instrucciones = null;
let _meta = null;

export async function cargar(base = '.') {
  if (_indice) return _indice;
  const [ejercicios, meta] = await Promise.all([
    fetch(`${base}/data/ejercicios.json`).then((r) => r.json()),
    fetch(`${base}/data/dataset-meta.json`).then((r) => r.json()).catch(() => null),
  ]);
  _indice = ejercicios;
  _meta = meta;
  _porId = new Map(ejercicios.map((e) => [e.id, e]));
  return _indice;
}

/**
 * Carga el catálogo desde memoria, sin `fetch`. Existe para que
 * `scripts/verificar.mjs` pueda ejercitar el motor en Node: sin esto habría que
 * levantar un navegador para probar una función pura, y entonces no se probaría.
 */
export function sembrar(indice, metaObj = null, instr = null) {
  _indice = indice;
  _meta = metaObj;
  _instrucciones = instr;
  _porId = new Map(indice.map((e) => [e.id, e]));
  return _indice;
}

export function meta() { return _meta; }
export function todos() { return _indice || []; }
export function porId(id) { return _porId?.get(id) || null; }

export async function instrucciones(id, base = '.') {
  if (!_instrucciones) {
    _instrucciones = await fetch(`${base}/data/instrucciones.json`).then((r) => r.json()).catch(() => ({}));
  }
  return _instrucciones[id] || null;
}

/** URL del GIF de demostración. Solo se pide cuando el ejercicio está en pantalla. */
export function urlGif(ej) {
  if (!ej?.m || !_meta?.base_media) return null;
  return `${_meta.base_media}/videos/${ej.m}.gif`;
}

/**
 * Busca candidatos para un hueco de la sesión.
 * El orden del resultado no es alfabético ni aleatorio: prioriza los que ya
 * hiciste (para poder progresar la carga) y penaliza el que hiciste la última
 * vez en ese mismo hueco, que es lo que produce variedad sin perder progresión.
 *
 * @param {Object} f
 * @param {string} f.patron
 * @param {string[]} f.equipoDisponible   grupos de equipo habilitados hoy
 * @param {boolean} [f.soloCompuestos]
 * @param {string[]} [f.patronesBloqueados]  por dolor
 * @param {Set<string>} [f.yaEnLaSesion]
 * @param {Map<string,number>} [f.vecesHecho]
 * @param {string|null} [f.ultimoEnEsteHueco]
 */
/**
 * Movimientos canónicos por patrón. Sin esto, el desempate por "nombre más corto"
 * proponía "Sentadilla potty" como compuesto principal de la primera sesión: es un
 * ejercicio real del dataset, pero nadie empieza por ahí. Con 1.324 opciones, la
 * elección por defecto tiene que ser el movimiento básico del patrón.
 */
const BASICOS = {
  sentadilla: [
    /^(barbell |dumbbell )?full squat$/i, /^(air |bodyweight )?squat$/i,
    /^(barbell |dumbbell )?front squat$/i, /^goblet squat$/i,
    /^(lever |sled )?leg press$/i, /^(barbell )?hack squat$/i, /^potty squat$/i,
  ],
  bisagra: [
    /^(barbell |dumbbell )?deadlift$/i, /^(barbell |dumbbell )?romanian deadlift$/i,
    /^(barbell |dumbbell )?hip thrust$/i, /^glute bridge$/i, /^(barbell )?good morning$/i,
  ],
  zancada: [
    /^(dumbbell |barbell )?split squat$/i, /^(bodyweight |dumbbell |barbell )?lunge$/i,
    /^(dumbbell )?step-?up$/i, /\blunge\b/i,
  ],
  empuje_horizontal: [
    /^(barbell |dumbbell )?bench press$/i, /^push-?up$/i, /^(lever |cable )?chest press$/i,
    /^(chest |triceps )?dip$/i, /\bpush-?up\b/i,
  ],
  empuje_vertical: [
    /^(barbell |dumbbell )?overhead press$/i, /^(dumbbell |lever )?shoulder press$/i,
    /^(barbell )?military press$/i, /\bshoulder press\b/i,
  ],
  traccion_horizontal: [
    /^(barbell |dumbbell )?bent over row$/i, /^inverted row$/i,
    /^(barbell |dumbbell |cable )?row$/i, /\brow\b/i,
  ],
  traccion_vertical: [
    /^pull-?up$/i, /^chin-?up$/i, /^(cable )?lat pulldown$/i, /\bpull-?up\b/i, /\bpulldown\b/i,
  ],
  core: [/^plank$/i, /^dead bug$/i, /^hollow hold$/i, /\bplank\b/i, /\bleg raise\b/i, /\bcrunch\b/i],
  movilidad: [/\bstretch\b/i],
};

// Un nombre con palabras en inglés sin traducir señala una entrada rara del
// dataset ("Sentadilla con salto bodyweight en caída"). No es solo estética:
// esas entradas suelen ser variantes exóticas, no el movimiento del patrón.
// Los \b importan: sin ellos "on" hace juego dentro de "con" y medio catálogo
// queda marcado como sucio. Ya pasó.
const RESTO_INGLES = /\b(with|the|and|on|to|hold|down|up|over|under|two|one|side|throw|support|reach|legs|arms|bike|air|bodyweight|twist|stagger|pike|tuck|clap|plyo|suspended|flag|sphinx|cocoons)\b/i;

export function candidatos(f) {
  const bloqueados = new Set(f.patronesBloqueados || []);
  if (bloqueados.has(f.patron)) return [];

  // Se excluye por id Y por nombre visible. Varios ejercicios distintos del
  // dataset traducen al mismo nombre en español ("inverted row" y "bodyweight
  // inverted row" son ambos "Remo invertido"), y dos filas idénticas en la
  // pantalla parecen un bug aunque técnicamente sean ejercicios distintos.
  const nombresUsados = f.nombresEnLaSesion || new Set();
  let lista = (_indice || []).filter((e) =>
    e.p === f.patron
    && f.equipoDisponible.includes(e.g)
    && (!f.soloCompuestos || e.c === 1)
    && !(f.yaEnLaSesion?.has(e.id))
    && !nombresUsados.has(e.n),
  );

  const veces = f.vecesHecho || new Map();
  // Posición en la lista canónica: 0 es el movimiento por defecto del patrón.
  // 99 = no está en la lista.
  const rango = (e) => {
    const lista = BASICOS[f.patron];
    if (!lista) return 99;
    const i = lista.findIndex((re) => re.test(e.en));
    return i < 0 ? 99 : i;
  };
  const sucio = (e) => (RESTO_INGLES.test(e.n) ? 1 : 0);

  lista.sort((a, b) => {
    if (a.id === f.ultimoEnEsteHueco) return 1;
    if (b.id === f.ultimoEnEsteHueco) return -1;
    const va = veces.get(a.id) || 0;
    const vb = veces.get(b.id) || 0;
    if (va !== vb) return vb - va;                  // conocidos primero: hay historial que progresar
    const ra = rango(a);
    const rb = rango(b);
    if (ra !== rb) return ra - rb;                  // el movimiento canónico del patrón
    const sa = sucio(a);
    const sb = sucio(b);
    if (sa !== sb) return sa - sb;                  // los nombres a medio traducir, últimos
    if (a.c !== b.c) return b.c - a.c;              // compuestos antes que aislamiento
    return a.n.length - b.n.length;                 // a igualdad, el nombre más simple
  });
  return lista;
}

const sinAcento = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Búsqueda por texto para el explorador del catálogo.
 *
 * La v1 era `includes()` del string entero sobre tres campos, y cortaba con
 * `.slice(limite)` ANTES de ordenar por nada: los resultados eran los primeros
 * del índice, no los mejores. Y "press banca" no encontraba "Press de banca con
 * barra", porque esa cadena exacta no existe en ningún nombre.
 *
 * Ahora: se parte la consulta en palabras, se exigen todas (AND), y se puntúa.
 * El puntaje es lo que hace que el movimiento básico aparezca arriba y las
 * variantes exóticas del dataset abajo.
 *
 * @param {string} texto
 * @param {Object|number} [opciones]  número = límite, por compatibilidad
 * @param {number} [opciones.limite]
 * @param {string} [opciones.patron]
 * @param {string[]} [opciones.equipo]  grupos de equipo
 * @param {string} [opciones.zona]
 */
export function buscar(texto, opciones = {}) {
  const o = typeof opciones === 'number' ? { limite: opciones } : opciones;
  const { limite = 60, patron = null, equipo = null, zona = null } = o;

  const base = (_indice || []).filter((e) =>
    (!patron || e.p === patron)
    && (!equipo?.length || equipo.includes(e.g))
    && (!zona || e.z === zona));

  const q = sinAcento(texto).trim();
  if (!q) {
    // Sin consulta, el orden tampoco puede ser el del archivo: se muestran los
    // compuestos y los nombres limpios primero, que es lo que alguien busca
    // cuando abre el catálogo a mirar.
    return base
      .map((e) => ({ e, s: (e.c === 1 ? 10 : 0) - (RESTO_INGLES.test(e.n) ? 8 : 0) - e.n.length / 50 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limite)
      .map((x) => x.e);
  }

  const tokens = q.split(/\s+/).filter((t) => t.length > 1 || tokens0(q));
  const salida = [];
  for (const e of base) {
    const nombre = sinAcento(e.n);
    const ingles = sinAcento(e.en);
    const musculos = sinAcento(`${e.t} ${(e.s || []).join(' ')}`);
    const todo = `${nombre} ${ingles} ${musculos}`;

    if (!tokens.every((t) => todo.includes(t))) continue;

    let s = 0;
    if (nombre.startsWith(q)) s += 100;
    else if (nombre.includes(q)) s += 60;
    else if (ingles.includes(q)) s += 40;

    for (const t of tokens) {
      if (new RegExp(`\\b${escapar(t)}`).test(nombre)) s += 20;
      else if (nombre.includes(t)) s += 10;
      else if (ingles.includes(t)) s += 5;
      else s += 3;
    }

    // El movimiento canónico del patrón le gana a la variante exótica. Sin
    // esto, buscar "sentadilla" devolvía primero la sentadilla sissy: existe en
    // el dataset, pero nadie la está buscando cuando escribe esa palabra.
    const rango = (BASICOS[e.p] || []).findIndex((re) => re.test(e.en));
    if (rango >= 0) s += 30 - rango * 4;

    if (e.c === 1) s += 8;                              // compuestos primero
    if (RESTO_INGLES.test(e.n)) s -= 15;                // nombres a medio traducir
    s -= e.n.length / 40;                               // a igualdad, el más simple

    salida.push({ e, s });
  }

  return salida.sort((a, b) => b.s - a.s).slice(0, limite).map((x) => x.e);
}

// Una consulta de una sola letra no se descarta entera: "z" no busca nada útil,
// pero descartar todos los tokens dejaría la lista completa como resultado, que
// es peor que no encontrar nada.
const tokens0 = (q) => q.length === 1;
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Zonas presentes en el catálogo, para los filtros del explorador. */
export function zonas() {
  return [...new Set((_indice || []).map((e) => e.z).filter(Boolean))].sort();
}

export function porPatron() {
  const m = {};
  for (const e of _indice || []) (m[e.p] ||= []).push(e);
  return m;
}
