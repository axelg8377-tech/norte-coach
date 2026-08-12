/**
 * coach.js — el coach, al frente.
 *
 * En la v1 el coach era un botón que ampliaba un párrafo una vez por día, y la
 * conversación estaba enterrada a tres toques adentro de Ajustes. El producto se
 * llama coach y la IA no decidía nada. Acá vive el panel que se usa desde la
 * pantalla de hoy y desde la sesión en curso.
 *
 * Dos reglas que ordenan este archivo:
 *
 * 1. **Escribir siempre hace algo, con clave o sin ella.** Lo que escribís pasa
 *    primero por `dominio/pedido.js`, que es determinista: si el texto es un
 *    pedido de sesión ("hoy espalda, 40 minutos"), se rearma la sesión sin
 *    tocar la red. La IA se usa para conversar y para entender frases que la
 *    tabla no cubre — nunca es lo que habilita la función.
 * 2. **La sesión la sigue decidiendo el motor.** Acá nunca se escribe un
 *    ejercicio ni una carga: se arman restricciones y se llama a `decidir()`.
 */

import { h, vaciar } from './componentes.js';
import * as estado from '../estado.js';
import { interpretar, describir } from '../dominio/pedido.js';
import { PATRON } from '../dominio/modelo.js';
import { hayIA, hayClave, conversar, interpretarPedido } from '../ia/cliente.js';

const nombrePatron = (p) => PATRON[p]?.nombre || p;

/**
 * @param {Object} op
 * @param {Object} op.p              proyección
 * @param {Object} [op.plan]         plan del día, si ya existe
 * @param {Object} [op.bloqueActivo] bloque en curso, si se está entrenando
 * @param {Function} [op.alRearmar]  (restricciones) => void — si falta, no se negocia
 * @param {string} [op.marcador]     texto de ejemplo del campo
 */
export function panelCoach({ p, plan = null, bloqueActivo = null, alRearmar = null, marcador }) {
  const hilo = h('div.hilo');
  const entrada = h('input.buscador', {
    type: 'text',
    placeholder: marcador || (alRearmar ? 'Hoy quiero espalda y tengo 40 minutos' : '¿Subo el peso en este?'),
    'aria-label': 'Escribile al coach',
  });
  const enviar = h('button.boton.compacto', { onClick: () => procesar() }, 'Enviar');

  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') procesar(); });

  const cont = h('div.coach',
    h('div.coach-cabecera',
      h('span.micro', 'Coach'),
      hayClave() ? null : h('span.micro', { style: 'color:var(--texto-tenue)' }, 'sin clave: solo cambios de sesión')),
    hilo,
    h('div.coach-entrada', entrada, enviar));

  pintarHilo();

  function pintarHilo() {
    vaciar(hilo);
    const deHoy = (p.conversacion || []).filter((t) => t.dia === p.hoy).slice(-6);
    for (const t of deHoy) {
      hilo.append(h('p', { clase: `turno ${t.quien}` }, t.texto));
    }
  }

  function decir(quien, texto) {
    hilo.append(h('p', { clase: `turno ${quien}` }, texto));
    hilo.scrollTop = hilo.scrollHeight;
    return estado.registrarTurnoCoach(quien, texto);
  }

  async function procesar() {
    const texto = entrada.value.trim();
    if (!texto) return;
    entrada.value = '';
    enviar.disabled = true;
    await decir('vos', texto);

    try {
      // 1. ¿Es un pedido de sesión? Esto no necesita red.
      let pedido = interpretar(texto);
      if (!pedido.entendido && alRearmar && hayIA()) {
        try { pedido = await interpretarPedido(texto); } catch { /* queda el determinista */ }
      }

      if (alRearmar && pedido.entendido && (pedido.patronPreferido || pedido.excluirPatrones.length || pedido.minutos)) {
        await decir('coach', describir(pedido, nombrePatron));
        await alRearmar(pedido);
        return;
      }

      // 2. Si no, es una pregunta.
      if (!hayIA()) {
        await decir('coach', hayClave()
          ? 'Estás sin conexión. Puedo cambiar la sesión igual: pedime un patrón y un tiempo.'
          : 'Para conversar necesito la clave de Gemini, que se carga en Ajustes. Sin ella igual puedo cambiar la sesión: pedime un patrón y un tiempo.');
        return;
      }

      const pensando = h('p.turno.coach', 'Pensando…');
      hilo.append(pensando);
      const r = await conversar(texto, {
        proy: estado.proyeccion(), plan, bloqueActivo,
        historia: (estado.proyeccion().conversacion || []).slice(-8),
      });
      pensando.remove();
      await decir('coach', r);
    } catch (e) {
      hilo.append(h('p.turno.error', `No se pudo: ${e.message}`));
    } finally {
      enviar.disabled = false;
      entrada.focus();
    }
  }

  return cont;
}
