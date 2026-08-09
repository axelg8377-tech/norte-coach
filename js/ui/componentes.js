/**
 * componentes.js — las piezas visuales compartidas.
 *
 * Se construye el DOM con un ayudante (`h`) en vez de `innerHTML` con plantillas.
 * Motivo concreto: los nombres de ejercicio vienen de un dataset de terceros y las
 * notas las escribe el usuario. Con `h` el texto se inserta como `textContent` y
 * no hay forma de que una comilla o un `<` rompan la pantalla o inyecten nada.
 */

/**
 * @param {string} tag  'div.clase#id'
 * @param {Object|Array|string} [props]
 * @param {...(Node|string|Array|null|false)} hijos
 */
export function h(tag, props, ...hijos) {
  const [nombre, ...resto] = tag.split(/(?=[.#])/);
  const el = document.createElement(nombre || 'div');
  for (const r of resto) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (props && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
    hijos.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'onInput') el.addEventListener('input', v);
    else if (k === 'onChange') el.addEventListener('change', v);
    else if (k === 'onSubmit') el.addEventListener('submit', v);
    else if (k === 'clase') el.className = v;
    else if (k in el && k !== 'list' && typeof v !== 'object') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function vaciar(el) { while (el.firstChild) el.firstChild.remove(); }

/** Cifra grande: el único elemento de gran tamaño que puede haber por pantalla. */
export function cifra(valor, unidad, tono = '') {
  return h('div', { clase: `cifra ${tono}`.trim() }, String(valor),
    unidad ? h('span.unidad', ' ' + unidad) : null);
}

export function encabezado(textoFecha) {
  return h('header.encabezado',
    h('span.fecha', textoFecha),
    h('span.pulso', { 'data-en-linea': navigator.onLine, 'aria-hidden': 'true' }));
}

/** Selector de 1 a 5. Es el control principal del check diario. */
export function escala({ etiqueta, valor, onCambio, pistaBaja, pistaAlta, tipo = '' }) {
  const cont = h('div.campo',
    h('span.micro', etiqueta),
    h('div', { clase: `escala ${tipo}`.trim(), role: 'group', 'aria-label': etiqueta },
      [1, 2, 3, 4, 5].map((n) => h('button', {
        type: 'button',
        'aria-pressed': String(valor === n),
        'aria-label': `${etiqueta}: ${n} de 5`,
        onClick: (ev) => {
          for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', 'false');
          ev.currentTarget.setAttribute('aria-pressed', 'true');
          onCambio(n);
        },
      }, String(n)))),
    (pistaBaja || pistaAlta) ? h('div.pistas', h('span', pistaBaja || ''), h('span', pistaAlta || '')) : null,
  );
  return cont;
}

export function fichas({ etiqueta, opciones, seleccion, onCambio, unica = false }) {
  const sel = new Set(seleccion);
  const botones = opciones.map(({ id, nombre }) => h('button.ficha', {
    type: 'button',
    'aria-pressed': String(sel.has(id)),
    onClick: () => {
      if (unica) { sel.clear(); sel.add(id); }
      else if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      opciones.forEach((o, i) => botones[i].setAttribute('aria-pressed', String(sel.has(o.id))));
      onCambio([...sel]);
    },
  }, nombre));
  return h('div.campo',
    etiqueta ? h('span.micro', etiqueta) : null,
    h('div.fichas', botones));
}

/** Hoja modal desde abajo. Se cierra con Escape y tocando el fondo. */
export function hoja(contenido, { alCerrar } = {}) {
  const cerrar = () => {
    document.removeEventListener('keydown', porTecla);
    fondo.remove();
    alCerrar?.();
  };
  const porTecla = (e) => { if (e.key === 'Escape') cerrar(); };
  const panel = h('div', { role: 'dialog', 'aria-modal': 'true' });
  const fondo = h('div.hoja', { onClick: (e) => { if (e.target === fondo) cerrar(); } }, panel);
  agregar(panel, [typeof contenido === 'function' ? contenido(cerrar) : contenido]);
  document.addEventListener('keydown', porTecla);
  document.body.append(fondo);
  panel.querySelector('button, input, [tabindex]')?.focus();
  return cerrar;
}

export function barraEquilibrio({ nombre, series, estado, maximo = 20 }) {
  return h('div.barra-fila', { 'data-estado': estado },
    h('span.etiqueta', nombre),
    h('div.barra', h('span', { style: `width:${Math.min(100, (series / maximo) * 100)}%` })),
    h('span.valor', `${series}`));
}

export function señal(s) {
  return h('div.senal', { 'data-gravedad': s.gravedad },
    h('p.que', s.texto),
    h('p.propuesta', s.propuesta),
    s.evidencia ? h('p.evidencia', s.evidencia) : null);
}

export function aviso(texto) { return h('p.aviso', texto); }

/** Un pequeño gráfico de línea en SVG. Sin librerías: son 12 puntos. */
export function chispa(puntos, { alto = 48, color = 'var(--brasa)' } = {}) {
  if (puntos.length < 2) return null;
  const vals = puntos.map((p) => p.valor);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const rango = max - min || 1;
  const ancho = 100;
  const d = puntos.map((p, i) => {
    const x = (i / (puntos.length - 1)) * ancho;
    const y = alto - ((p.valor - min) / rango) * (alto - 6) - 3;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Se construye con createElementNS y no con innerHTML. `d` sale de números y
  // `color` de una constante, así que hoy sería inofensivo — pero un innerHTML en
  // el archivo de componentes es una puerta que alguien va a usar con datos dentro
  // de seis meses. No dejarla abierta cuesta cuatro líneas.
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(alto));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
  return svg;
}
