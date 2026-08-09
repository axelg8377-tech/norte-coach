/**
 * hoy.js — la pantalla principal. Es la única que importa.
 *
 * Tiene cuatro estados y muestra UNO. Nunca los cuatro con secciones colapsadas:
 * si al abrir la app hay que decidir qué mirar, la app falló.
 *
 *   sin check   → el check de 20 segundos
 *   con check   → la sesión que el motor decidió, y por qué
 *   en curso    → volver a la sesión
 *   cerrado     → qué pasó hoy + los hábitos
 */

import { h, vaciar, cifra, encabezado, escala, fichas, aviso, señal, hoja } from './componentes.js';
import * as estado from '../estado.js';
import { porId } from '../dominio/catalogo.js';
import { decidir } from '../dominio/motor.js';
import { ZONA_DOLOR, GRUPO_EQUIPO, HABITOS, MODO, nuevoId } from '../dominio/modelo.js';
import { saludoDia } from '../dominio/mensajes.js';
import { pedirLectura, hayIA } from '../ia/cliente.js';

export function render(cont, { ir }) {
  const p = estado.proyeccion();
  vaciar(cont);
  cont.append(encabezado(saludoDia(p.hoy)));

  if (!p.perfil) return ir('#/inicio');

  const s = p.sesionHoy;
  if (s && (s.terminada || s.saltada)) return cerrado(cont, p, ir);
  if (s && s.iniciada) return enCurso(cont, p, ir);
  if (s && s.plan) return propuesta(cont, p, ir, s);
  if (!p.checkHoy) return check(cont, p, ir);
  return calcularYProponer(cont, p, ir);
}

// ─── 1. El check ────────────────────────────────────────────────────────────
function check(cont, p, ir) {
  const datos = {
    sueno: null, energia: null, animo: null, dolor: {},
    minutos: p.ajustes.minutosPorDefecto || 60,
    equipoHoy: p.perfil.equipo,
  };

  const botón = h('button.boton', { disabled: true, onClick: guardar }, 'Ver la sesión de hoy');
  const revisar = () => {
    botón.disabled = !(datos.sueno && datos.energia && datos.animo);
  };

  cont.append(
    h('h1.titulo', '¿Cómo llegaste?'),
    h('p.cuerpo', { style: 'margin-top:var(--e2)' },
      'Veinte segundos. De esto sale el entrenamiento, así que contestá lo que es, no lo que te gustaría.'),
    h('div', { style: 'margin-top:var(--e5)' },
      escala({
        etiqueta: 'Sueño', valor: datos.sueno, pistaBaja: 'no dormí', pistaAlta: 'como un tronco',
        onCambio: (v) => { datos.sueno = v; revisar(); },
      }),
      escala({
        etiqueta: 'Energía', valor: datos.energia, pistaBaja: 'vacío', pistaAlta: 'con ganas',
        onCambio: (v) => { datos.energia = v; revisar(); },
      }),
      escala({
        etiqueta: 'Ánimo', valor: datos.animo, pistaBaja: 'mal', pistaAlta: 'bien',
        onCambio: (v) => { datos.animo = v; revisar(); },
      }),
      dolorSelector(datos),
      h('div.campo',
        h('span.micro', 'Tiempo que tenés'),
        h('div.fichas',
          [20, 30, 45, 60, 90].map((m) => {
            const b = h('button.ficha', {
              type: 'button', 'aria-pressed': String(m === datos.minutos),
              onClick: (ev) => {
                for (const x of ev.currentTarget.parentElement.children) x.setAttribute('aria-pressed', 'false');
                ev.currentTarget.setAttribute('aria-pressed', 'true');
                datos.minutos = m;
              },
            }, `${m} min`);
            return b;
          }))),
      fichas({
        etiqueta: 'Con qué contás hoy',
        opciones: Object.entries(GRUPO_EQUIPO).map(([id, nombre]) => ({ id, nombre })),
        seleccion: datos.equipoHoy,
        onCambio: (v) => { datos.equipoHoy = v.length ? v : ['peso_corporal']; },
      }),
    ),
    h('div.acciones', botón),
  );

  async function guardar() {
    botón.disabled = true;
    await estado.registrarCheck(datos);
    render(cont, { ir });
  }
}

function dolorSelector(datos) {
  const cont = h('div.campo', h('span.micro', 'Te duele algo'));
  const lista = h('div.fichas');
  const detalle = h('div', { style: 'margin-top:var(--e3)' });

  for (const [id, z] of Object.entries(ZONA_DOLOR)) {
    lista.append(h('button.ficha', {
      type: 'button', 'aria-pressed': 'false',
      onClick: (ev) => {
        const activo = ev.currentTarget.getAttribute('aria-pressed') === 'true';
        ev.currentTarget.setAttribute('aria-pressed', String(!activo));
        if (activo) { delete datos.dolor[id]; }
        else { datos.dolor[id] = 3; }
        pintarDetalle();
      },
    }, z.nombre));
  }

  function pintarDetalle() {
    vaciar(detalle);
    for (const id of Object.keys(datos.dolor)) {
      detalle.append(escala({
        etiqueta: `Cuánto duele: ${ZONA_DOLOR[id].nombre.toLowerCase()}`,
        valor: datos.dolor[id], tipo: 'dolor',
        pistaBaja: 'molestia', pistaAlta: 'no puedo',
        onCambio: (v) => { datos.dolor[id] = v; },
      }));
    }
    if (Object.keys(datos.dolor).length) {
      detalle.append(aviso('De 3 para arriba saco los ejercicios que cargan esa zona. No los marco en rojo: no aparecen.'));
    }
  }

  cont.append(lista, detalle);
  return cont;
}

// ─── 2. Calcular la propuesta ───────────────────────────────────────────────
async function calcularYProponer(cont, p, ir) {
  const plan = decidir({
    check: p.checkHoy,
    perfil: p.perfil,
    historial: p.historial,
    vecesHecho: p.vecesHecho,
    volumenSemanal: p.volumenSemanal,
    sesionesHechas: p.sesionesHechas,
    posteriores: p.posteriores,
    contextoMensaje: {
      racha: p.racha.actual,
      adherencia: p.adherencia,
      mejorMarca: p.mejorMarca ? { ...p.mejorMarca, nombre: nombreDe(p.mejorMarca.ejercicioId) } : null,
      diasSinEntrenar: p.diasSinEntrenar ?? 0,
    },
    ultimosPorHueco: p.ultimosPorHueco,
    hoy: p.hoy,
  });

  await estado.proponerSesion({
    sesionId: nuevoId('s'),
    plan,
    brazo: plan.brazo,
    contexto: plan.contexto,
    disposicion: plan.disposicion,
    modo: plan.modo,
  });
  render(cont, { ir });
}

const nombreDe = (id) => porId(id)?.n || 'ese ejercicio';

// ─── 3. La propuesta ────────────────────────────────────────────────────────
function propuesta(cont, p, ir, sesion) {
  const plan = sesion.plan;
  const recuperacion = plan.modo === MODO.RECUPERAR;

  cont.append(
    h('div.aparece',
      h('h1.titulo', plan.mensaje.titulo),
      plan.mensaje.cuerpo ? h('p.cuerpo', { style: 'margin-top:var(--e2)' }, plan.mensaje.cuerpo) : null,

      h('div', { style: 'margin-top:var(--e5);margin-bottom:var(--e4)' },
        cifra(plan.minutosEstimados, 'min', recuperacion ? 'frio' : 'brasa'),
        h('p.chico', { style: 'margin-top:var(--e2)' },
          [etiquetaModo(plan.modo), `${plan.bloques.length} ejercicios`,
            `disposición ${plan.disposicion}`].join(' · '))),

      h('div.bloques', plan.bloques.map((b) => bloque(b, ir))),

      h('div.porque', plan.porQue.map((t) => h('p', t))),

      hayIA() ? h('button.boton.plano', { onClick: (ev) => ampliar(ev, plan, p) },
        'Pedirle al coach que lo explique mejor') : null,

      h('div.acciones',
        h('button.boton', {
          clase: recuperacion ? 'boton frio' : 'boton',
          onClick: async () => { await estado.iniciarSesion(sesion.sesionId); ir('#/sesion'); },
        }, recuperacion ? 'Hacer la recuperación' : 'Empezar'),
        h('button.boton.plano', { onClick: () => noPuedo(cont, p, ir, sesion) }, 'Hoy no puedo')),
    ),
  );
}

function etiquetaModo(m) {
  return { empujar: 'día para empujar', normal: 'sesión completa', reducir: 'volumen reducido', recuperar: 'recuperación' }[m] || m;
}

function bloque(b, ir) {
  const rango = `${b.repsObjetivo[0]}-${b.repsObjetivo[1]}`;
  const carga = b.carga ? ` · ${b.carga} kg` : '';
  return h('div.bloque', { 'data-nuevo': String(!!b.nuevo) },
    h('div',
      h('div.patron', b.patronNombre),
      h('button', {
        clase: 'nombre',
        style: 'background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit;font-weight:500',
        onClick: () => ir(`#/ejercicio/${b.ejercicio.id}`),
      }, b.ejercicio.n)),
    h('div.prescripcion', `${b.series}×${rango}${carga}`),
    b.motivo ? h('div.motivo', b.motivo) : null,
    b.deload ? h('div.motivo', { style: 'color:var(--brasa)' }, 'Descarga programada') : null);
}

function noPuedo(cont, p, ir, sesion) {
  hoja((cerrar) => h('div',
    h('h2.titulo', { style: 'font-size:var(--t-sub)' }, '¿Qué pasó?'),
    h('p.chico', { style: 'margin:var(--e2) 0 var(--e4)' },
      'No hay que justificarse. Es el dato con el que aprendo cuándo fallo en pedirte las cosas.'),
    h('div.pila',
      [
        ['sin_tiempo', 'No tengo tiempo'],
        ['sin_ganas', 'No tengo ganas'],
        ['dolor', 'Me duele algo'],
        ['imprevisto', 'Se me cruzó algo'],
        ['descanso', 'Necesito descansar'],
      ].map(([id, txt]) => h('button.boton.fantasma', {
        onClick: async () => {
          await estado.saltarSesion(sesion.sesionId, id);
          cerrar();
          render(cont, { ir });
        },
      }, txt)))));
}

async function ampliar(ev, plan, p) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Pensando…';
  try {
    const texto = await pedirLectura(plan, p);
    btn.replaceWith(h('div.porque', h('p', texto)));
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'No se pudo. Reintentar';
  }
}

// ─── 4. Sesión en curso ─────────────────────────────────────────────────────
function enCurso(cont, p, ir) {
  cont.append(
    h('h1.titulo', 'Estás en el medio.'),
    h('div', { style: 'margin-top:var(--e5)' },
      cifra(p.sesionHoy.series.length, 'series hechas', 'brasa')),
    h('div.acciones', h('button.boton', { onClick: () => ir('#/sesion') }, 'Volver a la sesión')));
}

// ─── 5. Después ─────────────────────────────────────────────────────────────
function cerrado(cont, p, ir) {
  const s = p.sesionHoy;
  cont.append(
    h('h1.titulo', s.terminada ? 'Cerrado.' : 'Hoy no fue.'),
    h('div', { style: 'margin-top:var(--e4);margin-bottom:var(--e4)' },
      s.terminada
        ? cifra(s.series.length, 'series', 'brasa')
        : cifra(p.racha.actual, 'de racha', '')),
    h('p.cuerpo', s.terminada
      ? `${s.duracionMin ? `${s.duracionMin} minutos. ` : ''}Mañana se recalcula todo con esto adentro.`
      : 'Queda registrado. No es una falta moral: es un dato que uso para pedirte las cosas mejor.'),

    p.senales.length ? h('div', { style: 'margin-top:var(--e5)' },
      h('span.micro', { style: 'display:block;margin-bottom:var(--e3)' }, 'Lo que estoy viendo'),
      p.senales.slice(0, 2).map(señal)) : null,

    h('div.separador'),
    h('span.micro', { style: 'display:block;margin-bottom:var(--e2)' }, 'El resto del día'),
    listaHabitos(p),
  );
}

function listaHabitos(p) {
  const cont = h('div');
  for (const hb of HABITOS) {
    const valor = p.habitosHoy[hb.id] ?? (hb.tipo === 'si_no' ? false : 0);
    const cumplido = hb.tipo === 'si_no' ? valor === true : valor >= hb.meta;
    const fila = h('div.habito', { 'data-cumplido': String(cumplido) },
      h('span.nombre', hb.nombre));

    if (hb.tipo === 'si_no') {
      fila.append(h('div.control',
        h('button', {
          'aria-label': `Marcar ${hb.nombre}`,
          onClick: async () => { await estado.registrarHabito(hb.id, !valor); refrescar(); },
        }, valor ? '✓' : '·')));
    } else {
      const muestra = h('span.valor', `${valor}/${hb.meta}`);
      fila.append(h('div.control',
        h('button', { 'aria-label': `Restar a ${hb.nombre}`, onClick: async () => { await estado.registrarHabito(hb.id, Math.max(0, valor - 1)); refrescar(); } }, '−'),
        muestra,
        h('button', { 'aria-label': `Sumar a ${hb.nombre}`, onClick: async () => { await estado.registrarHabito(hb.id, valor + 1); refrescar(); } }, '+')));
    }
    cont.append(fila);
  }
  function refrescar() {
    const nuevo = listaHabitos(estado.proyeccion());
    cont.replaceWith(nuevo);
  }
  return cont;
}
