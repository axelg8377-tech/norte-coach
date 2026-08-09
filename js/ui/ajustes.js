/**
 * ajustes.js — perfil, respaldo, IA y borrado.
 *
 * El respaldo es la pantalla más importante de acá, y por eso está arriba de todo:
 * como no hay sincronización, el archivo JSON es lo único que separa el historial
 * de perderse con el teléfono. La app avisa sola cuando pasaron dos semanas.
 */

import { h, vaciar, encabezado, fichas, aviso, hoja } from './componentes.js';
import * as estado from '../estado.js';
import * as db from '../db.js';
import { GRUPO_EQUIPO, diasEntre, diaLocal } from '../dominio/modelo.js';
import { hayClave, guardarClave, probarClave, preguntar } from '../ia/cliente.js';
import { meta } from '../dominio/catalogo.js';

export function render(cont, { ir }) {
  const p = estado.proyeccion();
  vaciar(cont);
  cont.append(encabezado('Ajustes'));

  // ── Respaldo ──────────────────────────────────────────────────────────────
  const ultimo = p.ajustes.ultimoRespaldo;
  const diasDesde = ultimo ? diasEntre(ultimo, p.hoy) : null;
  cont.append(
    h('span.micro', { style: 'display:block;margin-bottom:var(--e2)' }, 'Respaldo'),
    (diasDesde === null || diasDesde >= 14)
      ? aviso(diasDesde === null
        ? 'Nunca hiciste un respaldo. Tus datos viven solo en este teléfono: si lo perdés, se pierden.'
        : `Último respaldo hace ${diasDesde} días.`)
      : h('p.chico', `Último respaldo: ${ultimo}.`),
    h('div.acciones',
      h('button.boton.fantasma', { onClick: exportar }, 'Descargar respaldo'),
      h('button.boton.fantasma', { onClick: () => importar(cont, ir) }, 'Importar respaldo')),
    h('p.chico',
      'El respaldo es un archivo JSON con todos tus eventos. Importarlo en otro dispositivo '
      + 'fusiona los dos historiales sin duplicar nada, así que podés ir y volver entre '
      + 'el celular y la computadora. La clave de IA no viaja en el archivo.'),
  );

  // ── Perfil ────────────────────────────────────────────────────────────────
  cont.append(h('div.separador'), h('span.micro', 'Perfil'));
  const perfil = { ...p.perfil };
  cont.append(
    h('div.campo', { style: 'margin-top:var(--e3)' },
      h('span.micro', 'Días por semana'),
      h('div.fichas', [2, 3, 4, 5].map((n) => {
        const b = h('button.ficha', {
          type: 'button', 'aria-pressed': String(n === perfil.diasPorSemana),
          onClick: async (ev) => {
            for (const x of ev.currentTarget.parentElement.children) x.setAttribute('aria-pressed', 'false');
            ev.currentTarget.setAttribute('aria-pressed', 'true');
            perfil.diasPorSemana = n;
            await estado.definirPerfil(perfil);
          },
        }, `${n} días`);
        return b;
      }))),
    fichas({
      etiqueta: 'Equipo habitual',
      opciones: Object.entries(GRUPO_EQUIPO).map(([id, nombre]) => ({ id, nombre })),
      seleccion: perfil.equipo || [],
      onCambio: async (v) => { perfil.equipo = v.length ? v : ['peso_corporal']; await estado.definirPerfil(perfil); },
    }),
  );

  // ── IA ────────────────────────────────────────────────────────────────────
  cont.append(h('div.separador'), h('span.micro', 'Coach conversacional (opcional)'));
  const entradaClave = h('input.buscador', {
    type: 'password', placeholder: hayClave() ? '•••••••• (guardada)' : 'Pegá tu clave de Google AI Studio',
    'aria-label': 'Clave de la API de Gemini', style: 'margin-top:var(--e3)',
  });
  const estadoClave = h('p.chico');
  cont.append(
    h('p.chico', { style: 'margin-top:var(--e3)' },
      'La app funciona entera sin esto. Con una clave, el coach puede escribir la explicación '
      + 'del día con más contexto y contestar preguntas. La clave se guarda solo en este '
      + 'teléfono y no entra en el respaldo.'),
    entradaClave, estadoClave,
    h('div.acciones',
      h('button.boton.fantasma', {
        onClick: async (ev) => {
          const v = entradaClave.value.trim();
          if (!v) { await guardarClave(''); estadoClave.textContent = 'Clave borrada.'; return; }
          ev.currentTarget.disabled = true;
          estadoClave.textContent = 'Probando contra la API…';
          try {
            await probarClave(v);
            await guardarClave(v);
            entradaClave.value = '';
            estadoClave.textContent = 'Funciona. Ya podés pedirle explicaciones al coach.';
          } catch (e) {
            estadoClave.textContent = `No funcionó (${e.message}). La app sigue andando igual.`;
          } finally { ev.currentTarget.disabled = false; }
        },
      }, 'Probar y guardar'),
      hayClave() ? h('button.boton.plano', { onClick: () => preguntarAlgo(p) }, 'Preguntarle algo al coach') : null),
  );

  // ── Datos ─────────────────────────────────────────────────────────────────
  const m = meta();
  cont.append(
    h('div.separador'),
    h('span.micro', 'Datos'),
    h('p.chico', { style: 'margin-top:var(--e2)' },
      `${p.totalEventos} eventos registrados · ${p.hechas.length} sesiones · `
      + `${m?.total ?? '?'} ejercicios en el catálogo`),
    h('div.acciones',
      h('button.boton.alerta', { onClick: () => borrar(cont, ir) }, 'Borrar todo')),
  );

  cont.append(
    h('div.separador'),
    h('p.chico', { style: 'color:var(--texto-tenue)' },
      'Norte · datos de ejercicios de hasaneyldrm/exercises-dataset (MIT). '
      + 'Animaciones © Gym visual, usadas con atribución.'),
  );

  async function exportar() {
    const datos = await db.exportar();
    const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `norte-${p.hoy}.json` });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    await estado.cambiarAjuste('ultimoRespaldo', diaLocal());
    render(cont, { ir });
  }
}

function importar(cont, ir) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  input.addEventListener('change', async () => {
    const archivo = input.files?.[0];
    if (!archivo) return;
    try {
      const texto = await archivo.text();
      const r = await db.importar(JSON.parse(texto));
      await estado.iniciar();
      hoja(() => h('div',
        h('h2.titulo', { style: 'font-size:var(--t-sub)' }, 'Importado'),
        h('p.chico', { style: 'margin-top:var(--e2)' },
          `${r.agregados} eventos nuevos. ${r.omitidos} ya estaban y se omitieron.`)));
      render(cont, { ir });
    } catch (e) {
      hoja(() => h('div',
        h('h2.titulo', { style: 'font-size:var(--t-sub)' }, 'No se pudo importar'),
        h('p.chico', { style: 'margin-top:var(--e2)' }, String(e.message))));
    }
  });
  document.body.append(input);
  input.click();
  input.remove();
}

function borrar(cont, ir) {
  hoja((cerrar) => {
    const conf = h('input.buscador', { placeholder: 'Escribí BORRAR', 'aria-label': 'Confirmación' });
    return h('div',
      h('h2.titulo', { style: 'font-size:var(--t-sub)' }, 'Esto no se puede deshacer'),
      h('p.chico', { style: 'margin:var(--e2) 0 var(--e3)' },
        'Se borra todo el historial de este dispositivo. Si no descargaste un respaldo, '
        + 'no hay forma de recuperarlo.'),
      conf,
      h('div.acciones',
        h('button.boton.alerta', {
          onClick: async () => {
            if (conf.value.trim().toUpperCase() !== 'BORRAR') { conf.focus(); return; }
            await db.borrarTodo();
            await estado.iniciar();
            cerrar();
            ir('#/inicio');
          },
        }, 'Borrar todo'),
        h('button.boton.fantasma', { onClick: cerrar }, 'Cancelar')));
  });
}

function preguntarAlgo(p) {
  hoja(() => {
    const entrada = h('input.buscador', { placeholder: '¿Por qué me duele el hombro los lunes?', 'aria-label': 'Tu pregunta' });
    const salida = h('div', { style: 'margin-top:var(--e3)' });
    return h('div',
      h('h2.titulo', { style: 'font-size:var(--t-sub);margin-bottom:var(--e3)' }, 'Preguntale al coach'),
      entrada,
      h('div.acciones', h('button.boton', {
        onClick: async (ev) => {
          const q = entrada.value.trim();
          if (!q) return;
          ev.currentTarget.disabled = true;
          vaciar(salida); salida.append(h('p.chico', 'Pensando…'));
          try {
            const r = await preguntar(q, p);
            vaciar(salida); salida.append(h('div.porque', h('p', r)));
          } catch (e) {
            vaciar(salida); salida.append(h('p.chico', `No se pudo: ${e.message}`));
          } finally { ev.currentTarget.disabled = false; }
        },
      }, 'Preguntar')),
      salida);
  });
}
