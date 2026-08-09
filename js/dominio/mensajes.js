/**
 * mensajes.js — cómo el coach te pide la sesión.
 *
 * Un brazo del bandit elige la ESTRATEGIA; acá está la redacción de cada una.
 * Todo es determinista y funciona sin internet. Cuando hay red y clave de IA,
 * `ia/cliente.js` puede reescribir esto con más contexto — pero nunca es
 * necesario: si la IA falla, el mensaje que se muestra es este y nadie se entera.
 *
 * Regla de escritura, y es la que más importa del producto: ningún mensaje
 * dice "¡vos podés!". Si un mensaje no contiene un dato tuyo o una acción
 * concreta, no se muestra. La motivación genérica es exactamente lo que hace
 * que la gente desinstale una app de hábitos en la semana tres.
 */

import { nombreDiaSemana } from './modelo.js';

const elegir = (arr, semilla) => arr[Math.abs(semilla) % arr.length];

/**
 * @param {string} brazo
 * @param {Object} ctx  { racha, adherencia, mejorMarca, ejercicioNuevo, minutos,
 *                        diasSinEntrenar, dia, disposicion, modo }
 * @returns {{titulo:string, cuerpo:string}}
 */
export function redactar(brazo, ctx) {
  const s = ctx.dia ? ctx.dia.split('-').join('') | 0 : 0;

  switch (brazo) {
    case 'identidad':
      return {
        titulo: elegir([
          'Hoy entrenás.',
          'Te toca.',
          'Es un día de los tuyos.',
        ], s),
        cuerpo: ctx.adherencia != null && ctx.adherencia >= 60
          ? `Sos alguien que entrena ${ctx.adherencia}% de los días que se lo propone. Hoy es uno de esos días.`
          : 'Esto no es por el resultado de hoy. Es por seguir siendo alguien que aparece.',
      };

    case 'minimo_viable':
      return {
        titulo: 'Solo el primer ejercicio.',
        cuerpo: `Empezá por el primero. Si después querés cortar, cortás y queda registrado igual. Casi nunca vas a querer cortar, pero el trato es real: ${ctx.minutos ? `${Math.round(ctx.minutos / 4)} minutos` : '10 minutos'} y sos libre.`,
      };

    case 'evidencia':
      return {
        titulo: ctx.mejorMarca ? 'Mirá esto antes de empezar.' : 'Hoy sumás un dato.',
        cuerpo: ctx.mejorMarca
          ? `${ctx.mejorMarca.nombre}: ${ctx.mejorMarca.desde} kg → ${ctx.mejorMarca.hasta} kg en ${ctx.mejorMarca.semanas} semanas. Eso no pasó solo.`
          : 'Todavía no hay suficientes sesiones para mostrarte una curva. Hoy es una de las que la construye.',
      };

    case 'costo_de_parar':
      return {
        titulo: ctx.racha > 1 ? `Llevás ${ctx.racha} seguidas.` : 'No dejes que se corte.',
        cuerpo: ctx.racha > 1
          ? `Construir ${ctx.racha} sesiones seguidas te llevó semanas. Perderlas lleva un día.`
          : 'Estás a una sesión de volver a tener una racha.',
      };

    case 'curiosidad':
      return {
        titulo: ctx.ejercicioNuevo ? 'Hoy hay algo que no probaste.' : 'Sesión distinta.',
        cuerpo: ctx.ejercicioNuevo
          ? `${ctx.ejercicioNuevo} entra hoy por primera vez. Vas a tener que buscarle la carga; eso es parte de la sesión.`
          : 'Cambié el orden y el acento respecto de la última. No es la misma rutina.',
      };

    default:
      return { titulo: 'Hoy entrenás.', cuerpo: '' };
  }
}

/**
 * El "por qué" de la sesión. Esto se muestra SIEMPRE, sin importar el brazo,
 * y es lo que separa un entrenador de un generador de rutinas: el usuario tiene
 * que poder discutir la decisión, y para discutirla necesita verla.
 */
export function explicarDecision({ modo, disposicion, check, bloqueados, ajustes }) {
  const partes = [];

  const causa = [];
  if (check?.sueno <= 2) causa.push('dormiste poco');
  if (check?.energia <= 2) causa.push('la energía está baja');
  if (check?.animo <= 2) causa.push('el ánimo está bajo');
  if (check?.sueno >= 4 && check?.energia >= 4) causa.push('venís descansado y con energía');

  switch (modo) {
    case 'empujar':
      partes.push(`Disposición ${disposicion}/100${causa.length ? `: ${causa.join(' y ')}` : ''}. Es un día para intentar subir carga en el primer ejercicio.`);
      break;
    case 'normal':
      partes.push(`Disposición ${disposicion}/100. La sesión va completa, como estaba planeada.`);
      break;
    case 'reducir':
      partes.push(`Disposición ${disposicion}/100${causa.length ? ` porque ${causa.join(' y ')}` : ''}. Saqué los accesorios y dejé los compuestos con 10% menos de carga. El estímulo principal se mantiene; lo que baja es el volumen, que es lo que más fatiga acumula.`);
      break;
    case 'recuperar':
      partes.push(`Disposición ${disposicion}/100${causa.length ? `: ${causa.join(' y ')}` : ''}. Entrenar fuerte hoy te costaría más de lo que te daría. Movilidad y caminata: cuenta como día cumplido, no como día perdido.`);
      break;
  }

  if (bloqueados?.length) {
    partes.push(`Sacé ${bloqueados.map((b) => b.patron).join(' y ')} porque reportaste dolor en ${bloqueados.map((b) => b.zona).join(' y ')}. No es una advertencia: esos ejercicios directamente no están en la lista de hoy.`);
  }
  if (ajustes?.length) partes.push(...ajustes);

  return partes;
}

export function saludoDia(dia) {
  const n = nombreDiaSemana(dia);
  return `${n} ${Number(dia.slice(-2))}`;
}
