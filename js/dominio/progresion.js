/**
 * progresion.js — cuánta carga toca hoy en cada ejercicio.
 *
 * DECISIÓN: esto NO lo aprende un modelo. Es doble progresión con autorregulación
 * por RIR, que son reglas establecidas de programación de fuerza.
 *
 * Por qué no aprenderlo:
 *   Una política aprendida necesita miles de episodios para separar señal de ruido.
 *   Entrenando 3 veces por semana, un ejercicio concreto se ve ~150 veces al año.
 *   Un algoritmo que "aprende" con 150 muestras ruidosas no descubre nada que las
 *   reglas ya no digan, y además puede recomendar una barbaridad con confianza.
 *   Las reglas de progresión están bien estudiadas; el lugar donde sí hay que
 *   aprender es la adherencia, y eso vive en bandit.js.
 *
 * RIR = Repeticiones en Reserva. Cuántas te quedaban al terminar la serie.
 * RIR 0 = fallo. RIR 3 = te quedaban tres. Es la señal que dice si la carga
 * es la correcta, y la reporta el usuario, no un sensor.
 */

/** Rango de repeticiones objetivo según el rol del ejercicio en la sesión. */
export const RANGOS = {
  compuesto_pesado: { min: 4, max: 6, rirObjetivo: 2, incremento: 0.05 },
  compuesto: { min: 6, max: 10, rirObjetivo: 2, incremento: 0.04 },
  accesorio: { min: 10, max: 15, rirObjetivo: 1, incremento: 0.05 },
  core: { min: 8, max: 20, rirObjetivo: 1, incremento: 0.10 },
};

/** Salto mínimo de carga realista según el equipo. Sumar 0,7 kg no existe. */
export const SALTO_MINIMO = {
  barra: 2.5,        // el disco más chico de un par
  mancuernas: 2,     // el salto habitual entre mancuernas
  maquinas: 2.5,
  bandas: 0,         // no hay carga: se progresa en repeticiones
  peso_corporal: 0,
  accesorios: 0,
  cardio_maquina: 0,
};

export function redondearCarga(kg, grupoEquipo) {
  const salto = SALTO_MINIMO[grupoEquipo] ?? 2.5;
  if (!salto) return null;
  return Math.max(salto, Math.round(kg / salto) * salto);
}

/**
 * Decide la prescripción de hoy para un ejercicio, mirando la última vez que se hizo.
 *
 * @param {Object} historial  Proyección del ejercicio: { sesiones: [{dia, series:[{reps,carga,rir}]}], estancado }
 * @param {'compuesto_pesado'|'compuesto'|'accesorio'|'core'} rol
 * @param {string} grupoEquipo
 * @param {number} factorIntensidad  1 = normal · 0.9 = día flojo · 1.03 = día para empujar
 * @returns {{series:number, repsObjetivo:[number,number], carga:number|null, motivo:string, deload:boolean}}
 */
export function prescribir(historial, rol, grupoEquipo, factorIntensidad = 1) {
  const r = RANGOS[rol] || RANGOS.compuesto;
  const series = rol === 'compuesto_pesado' ? 4 : rol === 'core' ? 3 : 3;
  const ultima = historial?.sesiones?.[historial.sesiones.length - 1];

  // Primera vez: no hay nada que progresar. Se pide una serie de tanteo y el
  // usuario elige la carga. Nunca se inventa un número: sugerir 40 kg a alguien
  // que nunca hizo el ejercicio es la forma más rápida de lesionarlo o frustrarlo.
  if (!ultima || !ultima.series?.length) {
    return {
      series, repsObjetivo: [r.min, r.max], carga: null, deload: false,
      motivo: SALTO_MINIMO[grupoEquipo]
        ? 'Primera vez. Elegí una carga con la que llegues al tope del rango dejando 2 en reserva.'
        : `Primera vez. Sin carga que elegir: buscá llegar a ${r.max} repeticiones limpias.`,
    };
  }

  const cargaAnterior = ultima.series.reduce((m, s) => Math.max(m, s.carga || 0), 0);
  const repsMin = Math.min(...ultima.series.map((s) => s.reps || 0));
  const rirMin = Math.min(...ultima.series.map((s) => (s.rir ?? r.rirObjetivo)));
  const llegoAlTope = repsMin >= r.max;
  const quedoCorto = repsMin < r.min;

  // Deload: tres sesiones seguidas sin progresar es una señal de fatiga acumulada,
  // no de falta de voluntad. Se baja 10% y se reconstruye. Sin esto, la app
  // empuja hasta que la persona abandona, que es el modo de falla clásico.
  if (historial.estancado >= 3) {
    return {
      series, repsObjetivo: [r.min, r.max],
      carga: redondearCarga(cargaAnterior * 0.9, grupoEquipo),
      deload: true,
      motivo: 'Tres sesiones sin avanzar. Bajo 10% para descargar y volver a subir desde ahí.',
    };
  }

  let carga = cargaAnterior;
  let motivo;

  if (llegoAlTope && rirMin >= r.rirObjetivo) {
    // Doble progresión: se completó el rango con reserva → sube la carga y se
    // vuelve al piso del rango de repeticiones.
    const subida = Math.max(
      SALTO_MINIMO[grupoEquipo] ?? 2.5,
      cargaAnterior * r.incremento,
    );
    carga = redondearCarga(cargaAnterior + subida, grupoEquipo);
    motivo = `Cerraste ${repsMin} con ${rirMin} en reserva. Sube la carga.`;
  } else if (llegoAlTope) {
    motivo = 'Llegaste al tope pero al límite. Misma carga, buscá que salga más limpio.';
  } else if (quedoCorto) {
    carga = redondearCarga(cargaAnterior * 0.93, grupoEquipo);
    motivo = `Te quedaste en ${repsMin}, por debajo de ${r.min}. Bajo un poco para volver al rango.`;
  } else {
    motivo = `Vas por ${repsMin} de ${r.max}. Misma carga, sumá repeticiones.`;
  }

  if (carga && factorIntensidad !== 1) {
    carga = redondearCarga(carga * factorIntensidad, grupoEquipo);
  }

  return { series, repsObjetivo: [r.min, r.max], carga, deload: false, motivo };
}

/**
 * Estimación de 1RM con la fórmula de Epley. Se usa solo para mostrar tendencia
 * en la pantalla de progreso, nunca para prescribir: es una estimación, y por
 * encima de ~10 repeticiones deja de ser confiable, así que ahí devuelve null.
 */
export function estimar1RM(carga, reps) {
  if (!carga || !reps || reps > 10) return null;
  return Math.round(carga * (1 + reps / 30) * 10) / 10;
}

/**
 * Volumen semanal por patrón, en series efectivas. Es la métrica que gobierna
 * si un patrón está descuidado. El rango de referencia para hipertrofia son
 * ~10-20 series semanales por grupo; por debajo de 6 el patrón está abandonado.
 */
export const VOLUMEN = { minimo: 6, objetivo: 12, techo: 22 };

export function estadoVolumen(series) {
  if (series < VOLUMEN.minimo) return 'descuidado';
  if (series > VOLUMEN.techo) return 'excesivo';
  return 'ok';
}
