/**
 * db.js — persistencia. IndexedDB, sin librerías.
 *
 * Dos stores y nada más:
 *   eventos  — append-only. Nunca se hace update ni delete de un evento.
 *   kv       — cachés y cosas descartables (clave de IA, último snapshot).
 *              Todo lo que hay acá se puede borrar sin perder información.
 *
 * La regla que sostiene el diseño: si un dato importa, es un evento. Si está en
 * `kv`, se puede regenerar. Eso hace que el respaldo sea un solo array.
 */

const NOMBRE_DB = 'norte';
const VERSION_DB = 1;

let _db = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_DB, VERSION_DB);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('eventos')) {
        const s = db.createObjectStore('eventos', { keyPath: 'id' });
        s.createIndex('ts', 'ts');
        s.createIndex('dia', 'dia');
        s.createIndex('tipo', 'tipo');
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, modo, fn) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Agrega un evento al log. Es la única forma de escribir información real. */
export async function agregarEvento(evento) {
  await tx('eventos', 'readwrite', (s) => s.add(evento));
  return evento;
}

/** Todos los eventos, ordenados por tiempo. Se lee una vez al arrancar. */
export function leerEventos() {
  return tx('eventos', 'readonly', (s) => s.index('ts').getAll());
}

export function contarEventos() {
  return tx('eventos', 'readonly', (s) => s.count());
}

export function guardarKV(clave, valor) {
  return tx('kv', 'readwrite', (s) => s.put(valor, clave));
}

export function leerKV(clave) {
  return tx('kv', 'readonly', (s) => s.get(clave));
}

export function borrarKV(clave) {
  return tx('kv', 'readwrite', (s) => s.delete(clave));
}

/**
 * Respaldo. Devuelve el log entero: es toda la información del usuario.
 * `kv` no se incluye a propósito — contiene la clave de la API, que no debe
 * viajar dentro de un archivo que se comparte o se sube a algún lado.
 */
export async function exportar() {
  const eventos = await leerEventos();
  return {
    app: 'norte',
    esquema: 1,
    exportado_el: new Date().toISOString(),
    total: eventos.length,
    eventos,
  };
}

/**
 * Importar es una fusión, no un reemplazo: los eventos que ya existen se saltan
 * por id. Así, importar dos veces el mismo respaldo no duplica nada, e importar
 * el respaldo de la PC en el celular une los dos historiales en vez de pisar uno.
 * Es la mitigación concreta de no tener sincronización.
 */
export async function importar(respaldo) {
  if (!respaldo?.eventos || !Array.isArray(respaldo.eventos)) {
    throw new Error('El archivo no tiene un array de eventos');
  }
  const existentes = new Set((await leerEventos()).map((e) => e.id));
  const nuevos = respaldo.eventos.filter((e) => e?.id && !existentes.has(e.id));
  const db = await abrir();
  await new Promise((resolve, reject) => {
    const t = db.transaction('eventos', 'readwrite');
    const store = t.objectStore('eventos');
    for (const e of nuevos) store.put(e);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return { agregados: nuevos.length, omitidos: respaldo.eventos.length - nuevos.length };
}

/** Borrado total. Solo lo llama el botón de ajustes, con confirmación escrita. */
export async function borrarTodo() {
  const db = await abrir();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['eventos', 'kv'], 'readwrite');
    t.objectStore('eventos').clear();
    t.objectStore('kv').clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
