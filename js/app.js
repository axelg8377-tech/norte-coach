/**
 * app.js — arranque y ruteo.
 *
 * Orden del arranque, que importa:
 *   1. Registrar el service worker (para que la segunda visita sea offline).
 *   2. Cargar el índice de ejercicios y el log de eventos EN PARALELO.
 *      Son las dos únicas cosas que bloquean la primera pantalla, y no dependen
 *      entre sí, así que esperarlas en serie duplicaría el tiempo de arranque.
 *   3. Pintar.
 *
 * El ruteo es por hash. No por History API: la app se sirve desde GitHub Pages,
 * que no puede reescribir rutas, así que un `/progreso` real daría 404 al recargar.
 */

import * as estado from './estado.js';
import * as catalogo from './dominio/catalogo.js';
import { cargarClave } from './ia/cliente.js';
import { h, vaciar } from './ui/componentes.js';

export const APP_VERSION = '1.0.0';

const RUTAS = {
  inicio: () => import('./ui/inicio.js'),
  hoy: () => import('./ui/hoy.js'),
  sesion: () => import('./ui/sesion.js'),
  progreso: () => import('./ui/progreso.js'),
  catalogo: () => import('./ui/buscar.js'),
  ejercicio: () => import('./ui/ejercicio.js'),
  ajustes: () => import('./ui/ajustes.js'),
};

const cont = document.getElementById('app');
const nav = document.getElementById('nav');

function ir(hash) {
  if (location.hash === hash) rutear();
  else location.hash = hash;
}

function parsear() {
  const partes = (location.hash.replace(/^#\/?/, '') || 'hoy').split('/');
  return { ruta: partes[0] || 'hoy', params: { id: partes[1] } };
}

let pintando = false;
async function rutear() {
  if (pintando) return;
  pintando = true;
  try {
    const { ruta, params } = parsear();
    const cargar = RUTAS[ruta] || RUTAS.hoy;

    // El onboarding manda: sin perfil no hay ninguna otra pantalla que tenga sentido.
    if (!estado.proyeccion()?.perfil && ruta !== 'inicio') {
      location.hash = '#/inicio';
      return;
    }

    const modulo = await cargar();
    modulo.render(cont, { ir, params });

    nav.hidden = ruta === 'inicio';
    for (const a of nav.querySelectorAll('a')) {
      const activa = a.dataset.ruta === ruta
        || (ruta === 'ejercicio' && a.dataset.ruta === 'catalogo')
        || (ruta === 'sesion' && a.dataset.ruta === 'hoy');
      if (activa) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    cont.scrollIntoView({ block: 'start' });
  } catch (e) {
    console.error(e);
    vaciar(cont);
    cont.append(
      h('h1.titulo', 'Algo se rompió.'),
      h('p.cuerpo', { style: 'margin-top:var(--e3)' }, String(e?.message || e)),
      h('p.chico', { style: 'margin-top:var(--e3)' },
        'Tus datos están intactos: nada de esto los toca. Recargá la página.'),
      h('div.acciones', h('button.boton', { onClick: () => location.reload() }, 'Recargar')));
  } finally {
    pintando = false;
  }
}

async function arrancar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sin SW la app sigue andando */ });
  }

  try {
    await Promise.all([catalogo.cargar('.'), estado.iniciar(), cargarClave()]);
  } catch (e) {
    vaciar(cont);
    cont.append(
      h('h1.titulo', 'No pudo arrancar.'),
      h('p.cuerpo', { style: 'margin-top:var(--e3)' },
        'No se pudo cargar el catálogo de ejercicios. Si es la primera vez que abrís la app, '
        + 'necesitás internet una sola vez para que se guarde todo.'),
      h('p.chico', { style: 'margin-top:var(--e3)' }, String(e?.message || e)),
      h('div.acciones', h('button.boton', { onClick: () => location.reload() }, 'Reintentar')));
    return;
  }

  window.addEventListener('hashchange', rutear);
  // El punto de conexión del encabezado se repinta al cambiar el estado de red.
  for (const ev of ['online', 'offline']) {
    window.addEventListener(ev, () => {
      for (const p of document.querySelectorAll('.pulso')) p.dataset.enLinea = String(navigator.onLine);
    });
  }
  await rutear();
}

arrancar();
