/**
 * adherencia.js — detectar la recaída antes de que pase.
 *
 * El pedido decía "debe anticiparse a mis recaídas". Anticiparse no es mandar una
 * notificación cuando ya faltaste tres días: eso es constatar. Anticiparse es
 * encontrar el patrón que precede al abandono y nombrarlo mientras todavía se
 * puede hacer algo.
 *
 * Cuatro señales, todas calculables con pocos datos y todas verificables por el
 * usuario. Nada de "riesgo de abandono: 73%" salido de un modelo que nadie puede
 * auditar; si el sistema dice algo, tiene que poder mostrar de dónde lo sacó.
 */

import { diaLocal, diasEntre, nombreDiaSemana, DIAS_SEMANA } from './modelo.js';

export const SENAL = {
  DIAS_DEBILES: 'dias_debiles',
  DISPOSICION_CAYENDO: 'disposicion_cayendo',
  SESIONES_ACORTANDOSE: 'sesiones_acortandose',
  VENTANA_CRITICA: 'ventana_critica',
};

/**
 * @param {Object} p
 * @param {Array<{dia:string, hecha:boolean}>} p.intentos   un registro por día con sesión propuesta
 * @param {Array<{dia:string, disposicion:number}>} p.checks
 * @param {Array<{dia:string, duracionMin:number, seriesHechas:number, seriesPlan:number}>} p.sesiones
 * @param {string} p.hoy
 */
export function analizar({ intentos = [], checks = [], sesiones = [], hoy = diaLocal() }) {
  const senales = [];

  // ── 1. Días de la semana en los que fallás sistemáticamente ────────────────
  // Necesita al menos 3 observaciones del mismo día para decir algo. Con 2 es
  // una coincidencia disfrazada de patrón.
  const porDia = {};
  for (const i of intentos) {
    const d = nombreDiaSemana(i.dia);
    porDia[d] ||= { total: 0, fallados: 0 };
    porDia[d].total += 1;
    if (!i.hecha) porDia[d].fallados += 1;
  }
  for (const [dia, { total, fallados }] of Object.entries(porDia)) {
    if (total >= 3 && fallados / total >= 0.6) {
      senales.push({
        tipo: SENAL.DIAS_DEBILES,
        gravedad: fallados / total >= 0.8 ? 'alta' : 'media',
        dia,
        texto: `Los ${dia} faltás ${fallados} de ${total} veces.`,
        // La propuesta no es "esforzate más". Es cambiar el diseño del día,
        // que es lo único sobre lo que se puede actuar.
        propuesta: `Ese día el problema no sos vos, es el horario. Mové el entreno de los ${dia} a otro día, o dejalo como sesión corta de 20 minutos.`,
        evidencia: `${fallados}/${total} sesiones no hechas`,
      });
    }
  }

  // ── 2. La disposición viene cayendo ────────────────────────────────────────
  // Compara la media de los últimos 7 días contra la de los 7 anteriores.
  const recientes = checks.filter((c) => diasEntre(c.dia, hoy) <= 7);
  const previos = checks.filter((c) => {
    const d = diasEntre(c.dia, hoy);
    return d > 7 && d <= 14;
  });
  if (recientes.length >= 3 && previos.length >= 3) {
    const media = (a) => a.reduce((s, c) => s + c.disposicion, 0) / a.length;
    const caida = media(previos) - media(recientes);
    if (caida >= 12) {
      senales.push({
        tipo: SENAL.DISPOSICION_CAYENDO,
        gravedad: caida >= 20 ? 'alta' : 'media',
        texto: `Tu disposición bajó ${Math.round(caida)} puntos respecto de la semana pasada.`,
        propuesta: 'Esto casi siempre es sueño o carga acumulada, no falta de ganas. Una semana de descarga ahora evita tres semanas sin entrenar después.',
        evidencia: `${Math.round(media(previos))} → ${Math.round(media(recientes))}`,
      });
    }
  }

  // ── 3. Las sesiones se están acortando ─────────────────────────────────────
  // Terminar la mitad de las series es la antesala de no aparecer. Se detecta
  // antes de que haya una sola falta.
  const ult4 = sesiones.slice(-4);
  if (ult4.length >= 3) {
    const completitud = ult4.map((s) => (s.seriesPlan ? s.seriesHechas / s.seriesPlan : 1));
    const cayendo = completitud.every((c, i) => i === 0 || c <= completitud[i - 1] + 0.01);
    const ultima = completitud[completitud.length - 1];
    if (cayendo && ultima < 0.7) {
      senales.push({
        tipo: SENAL.SESIONES_ACORTANDOSE,
        gravedad: 'media',
        texto: `Tus últimas sesiones se van acortando: la última la cerraste al ${Math.round(ultima * 100)}%.`,
        propuesta: 'Prefiero bajar el plan a lo que sí terminás. Una sesión de 3 ejercicios completada vale más que una de 6 abandonada.',
        evidencia: completitud.map((c) => `${Math.round(c * 100)}%`).join(' → '),
      });
    }
  }

  // ── 4. Ventana crítica ─────────────────────────────────────────────────────
  // El día 3 sin entrenar es donde una pausa se convierte en abandono. Es la
  // señal más simple y la que más veces acierta.
  const ultimaHecha = [...intentos].reverse().find((i) => i.hecha);
  const dias = ultimaHecha ? diasEntre(ultimaHecha.dia, hoy) : null;
  if (dias !== null && dias >= 3) {
    senales.push({
      tipo: SENAL.VENTANA_CRITICA,
      gravedad: dias >= 7 ? 'alta' : 'media',
      texto: `${dias} días sin entrenar.`,
      propuesta: dias >= 7
        ? 'Volver después de una semana no es retomar el plan donde lo dejaste. Bajo las cargas 10% y armo una sesión corta: el objetivo de hoy es volver, no rendir.'
        : 'El tercer día es donde una pausa se vuelve un abandono. Hoy alcanza con 15 minutos.',
      evidencia: `última sesión: ${ultimaHecha.dia}`,
    });
  }

  const orden = { alta: 0, media: 1, baja: 2 };
  senales.sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
  return senales;
}

/**
 * Racha en días con sesión hecha. Se cuenta con tolerancia: los días que no
 * tocaba entrenar no la rompen. Una racha que se rompe por descansar castiga
 * exactamente lo que hay que fomentar.
 */
export function calcularRacha(intentos, diasPorSemana = 3) {
  const hechas = intentos.filter((i) => i.hecha).map((i) => i.dia).sort();
  if (!hechas.length) return { actual: 0, mejor: 0 };
  const huecoTolerado = Math.ceil(7 / diasPorSemana) + 1;
  let actual = 1;
  let mejor = 1;
  for (let i = 1; i < hechas.length; i++) {
    if (diasEntre(hechas[i - 1], hechas[i]) <= huecoTolerado) actual += 1;
    else actual = 1;
    mejor = Math.max(mejor, actual);
  }
  // Si el hueco desde la última hasta hoy ya se pasó, la racha está cortada.
  if (diasEntre(hechas[hechas.length - 1], diaLocal()) > huecoTolerado) actual = 0;
  return { actual, mejor };
}

/** Adherencia de las últimas 4 semanas, en porcentaje. */
export function adherencia4Semanas(intentos, hoy = diaLocal()) {
  const rango = intentos.filter((i) => diasEntre(i.dia, hoy) <= 28);
  if (!rango.length) return null;
  return Math.round((rango.filter((i) => i.hecha).length / rango.length) * 100);
}

export { DIAS_SEMANA };
