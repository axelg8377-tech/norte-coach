/**
 * sw.js — service worker.
 *
 * Al deployar HAY QUE SUBIR `CACHE`. Es la lección más cara de Improvisador:
 * tres iteraciones creyendo que un arreglo estaba mal cuando el arreglo estaba
 * bien y el service worker seguía sirviendo el archivo viejo.
 *
 * Tres estrategias, una por tipo de recurso:
 *   app shell (HTML/CSS/JS)  → precache, servido desde caché, actualizado en segundo plano
 *   datos (los dos JSON)     → precache. Son 986 KB una sola vez y son la razón
 *                              de que la app sirva sin señal en un subsuelo.
 *   GIFs de demostración     → caché bajo demanda con TOPE. Son 1.324 archivos
 *                              remotos; precachearlos serían ~180 MB y nadie
 *                              mira más de 40 ejercicios distintos por mes.
 */

const CACHE = 'norte-v1';
const CACHE_MEDIA = 'norte-media-v1';
const TOPE_MEDIA = 120; // ~15 MB de GIFs. Suficiente para varios meses de sesiones.

const PRECARGA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/estado.js',
  './js/dominio/modelo.js',
  './js/dominio/motor.js',
  './js/dominio/progresion.js',
  './js/dominio/bandit.js',
  './js/dominio/adherencia.js',
  './js/dominio/catalogo.js',
  './js/dominio/mensajes.js',
  './js/ia/cliente.js',
  './js/ui/componentes.js',
  './js/ui/inicio.js',
  './js/ui/hoy.js',
  './js/ui/sesion.js',
  './js/ui/progreso.js',
  './js/ui/buscar.js',
  './js/ui/ejercicio.js',
  './js/ui/ajustes.js',
  './data/ejercicios.json',
  './data/instrucciones.json',
  './data/dataset-meta.json',
  './iconos/icono.svg',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll falla entero si UN archivo falla. Se agregan de a uno para que un
    // icono ausente no deje la app sin service worker.
    await Promise.all(PRECARGA.map((u) => c.add(u).catch((e) => console.warn('sin cachear', u, e))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== CACHE && nombre !== CACHE_MEDIA) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // La API de Gemini nunca se cachea: una respuesta vieja del coach es peor que
  // ninguna, y además cachear respuestas de IA guardaría datos personales.
  if (url.hostname.endsWith('googleapis.com')) return;

  // GIFs de demostración: caché primero, y si hay que ir a la red, se guarda
  // recortando los más viejos para no llenar el disco del teléfono.
  if (/\.(gif|jpg|jpeg|png|webp)$/i.test(url.pathname) && url.origin !== location.origin) {
    ev.respondWith(mediaConTope(req));
    return;
  }

  // Todo lo propio: caché primero, revalidación en segundo plano.
  ev.respondWith((async () => {
    const cacheado = await caches.match(req, { ignoreSearch: true });
    const red = fetch(req).then(async (r) => {
      if (r.ok && url.origin === location.origin) {
        (await caches.open(CACHE)).put(req, r.clone());
      }
      return r;
    }).catch(() => null);

    if (cacheado) return cacheado;
    const r = await red;
    if (r) return r;
    // Navegación sin caché ni red: se devuelve el shell para que la app arranque.
    if (req.mode === 'navigate') {
      return (await caches.match('./index.html')) || Response.error();
    }
    return Response.error();
  })());
});

async function mediaConTope(req) {
  const c = await caches.open(CACHE_MEDIA);
  const cacheado = await c.match(req);
  if (cacheado) return cacheado;
  try {
    const r = await fetch(req);
    if (r.ok) {
      await c.put(req, r.clone());
      const claves = await c.keys();
      if (claves.length > TOPE_MEDIA) {
        // FIFO: las claves salen en orden de inserción.
        for (const k of claves.slice(0, claves.length - TOPE_MEDIA)) await c.delete(k);
      }
    }
    return r;
  } catch {
    // Sin red y sin caché: se devuelve 404 para que el <img> dispare su onerror
    // y la pantalla siga funcionando sin la animación.
    return new Response('', { status: 404 });
  }
}
