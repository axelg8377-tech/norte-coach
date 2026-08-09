/**
 * estado.js — proyecciones sobre el log de eventos, y las acciones que lo escriben.
 *
 * Todo lo que la interfaz lee sale de acá, y nada de acá se guarda: se recalcula
 * al arrancar leyendo los eventos. Es la contracara de la decisión de db.js.
 *
 * Si mañana hace falta una métrica que hoy no existe (por ejemplo, "cuántas veces
 * entrenaste después de dormir mal"), se agrega una proyección y aparece con todo
 * el historial ya calculado. Con estado mutable habría que empezar a medir desde cero.
 */

import * as db from './db.js';
import {
  EVENTO, VERSION_ESQUEMA, HABITOS, diaLocal, diasEntre, nuevoId, calcularDisposicion,
} from './dominio/modelo.js';
import { proyectarPosteriores } from './dominio/bandit.js';
import { estimar1RM } from './dominio/progresion.js';
import { analizar, calcularRacha, adherencia4Semanas } from './dominio/adherencia.js';

let _eventos = [];
let _proy = null;
const _suscriptores = new Set();

export function suscribir(fn) { _suscriptores.add(fn); return () => _suscriptores.delete(fn); }
function avisar() { for (const fn of _suscriptores) fn(_proy); }

export async function iniciar() {
  _eventos = await db.leerEventos();
  reproyectar();
  return _proy;
}

export function proyeccion() { return _proy; }
export function eventos() { return _eventos; }

async function emitir(tipo, datos) {
  const ts = Date.now();
  const evento = { id: nuevoId(), ts, dia: diaLocal(ts), tipo, v: VERSION_ESQUEMA, datos };
  await db.agregarEvento(evento);
  _eventos.push(evento);
  reproyectar();
  avisar();
  return evento;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proyecciones
// ─────────────────────────────────────────────────────────────────────────────

function reproyectar() {
  const hoy = diaLocal();
  const perfil = ultimoDato(EVENTO.PERFIL_DEFINIDO) || null;
  const ajustes = Object.assign({}, ...porTipo(EVENTO.AJUSTE_CAMBIADO).map((e) => e.datos));

  // ── Sesiones: se arma un registro por sesión juntando sus eventos ──────────
  const sesiones = new Map();
  const upsert = (id) => {
    if (!sesiones.has(id)) {
      sesiones.set(id, {
        sesionId: id, dia: null, plan: null, brazo: null, contexto: null,
        iniciada: false, terminada: false, saltada: false, motivoSalto: null,
        series: [], duracionMin: null, percepcion: null, ts: 0,
      });
    }
    return sesiones.get(id);
  };

  for (const e of _eventos) {
    const d = e.datos || {};
    switch (e.tipo) {
      case EVENTO.SESION_PROPUESTA: {
        const s = upsert(d.sesionId);
        s.dia = e.dia; s.plan = d.plan; s.brazo = d.brazo; s.contexto = d.contexto;
        s.disposicion = d.disposicion; s.modo = d.modo; s.ts = e.ts;
        break;
      }
      case EVENTO.SESION_INICIADA: upsert(d.sesionId).iniciada = true; break;
      case EVENTO.SERIE_REGISTRADA: upsert(d.sesionId).series.push({ ...d, ts: e.ts, dia: e.dia }); break;
      case EVENTO.SESION_TERMINADA: {
        const s = upsert(d.sesionId);
        s.terminada = true; s.duracionMin = d.duracionMin; s.percepcion = d.percepcion;
        break;
      }
      case EVENTO.SESION_SALTADA: {
        const s = upsert(d.sesionId);
        s.saltada = true; s.motivoSalto = d.motivo;
        break;
      }
    }
  }
  const listaSesiones = [...sesiones.values()].sort((a, b) => a.ts - b.ts);
  const hechas = listaSesiones.filter((s) => s.terminada);

  // ── Historial por ejercicio: lo que necesita progresion.js ────────────────
  const historial = {};
  const vecesHecho = new Map();
  for (const s of hechas) {
    const porEjercicio = new Map();
    for (const serie of s.series) {
      if (!porEjercicio.has(serie.ejercicioId)) porEjercicio.set(serie.ejercicioId, []);
      porEjercicio.get(serie.ejercicioId).push(serie);
    }
    for (const [ejId, series] of porEjercicio) {
      historial[ejId] ||= { sesiones: [], estancado: 0 };
      historial[ejId].sesiones.push({ dia: s.dia, series });
      vecesHecho.set(ejId, (vecesHecho.get(ejId) || 0) + 1);
    }
  }
  // Racha de sesiones sin subir la carga máxima: alimenta el deload.
  for (const h of Object.values(historial)) {
    let estancado = 0;
    for (let i = h.sesiones.length - 1; i > 0; i--) {
      const maxA = Math.max(0, ...h.sesiones[i].series.map((s) => s.carga || 0));
      const maxB = Math.max(0, ...h.sesiones[i - 1].series.map((s) => s.carga || 0));
      if (maxA <= maxB) estancado += 1; else break;
    }
    h.estancado = estancado;
  }

  // ── Volumen semanal por patrón (últimos 7 días) ───────────────────────────
  const volumenSemanal = {};
  for (const s of hechas) {
    if (diasEntre(s.dia, hoy) > 7) continue;
    for (const serie of s.series) {
      const patron = serie.patron || 'aislamiento';
      volumenSemanal[patron] = (volumenSemanal[patron] || 0) + 1;
    }
  }

  // ── Bandit ────────────────────────────────────────────────────────────────
  const propuestas = listaSesiones
    .filter((s) => s.brazo)
    .map((s) => ({ sesionId: s.sesionId, brazo: s.brazo, contexto: s.contexto }));
  const resultados = new Map();
  for (const s of listaSesiones) {
    if (s.terminada) resultados.set(s.sesionId, true);
    else if (s.saltada) resultados.set(s.sesionId, false);
  }
  const posteriores = proyectarPosteriores(propuestas, resultados);

  // ── Adherencia ────────────────────────────────────────────────────────────
  const intentos = listaSesiones
    .filter((s) => s.terminada || s.saltada)
    .map((s) => ({ dia: s.dia, hecha: s.terminada }));
  const checks = porTipo(EVENTO.CHECK_REGISTRADO)
    .map((e) => ({ dia: e.dia, disposicion: calcularDisposicion(e.datos), ...e.datos }));
  const resumenSesiones = hechas.map((s) => ({
    dia: s.dia,
    duracionMin: s.duracionMin,
    seriesHechas: s.series.length,
    seriesPlan: (s.plan?.bloques || []).reduce((n, b) => n + (b.series || 0), 0),
  }));

  const racha = calcularRacha(intentos, perfil?.diasPorSemana || 3);
  const senales = analizar({ intentos, checks, sesiones: resumenSesiones, hoy });

  // ── Mejor marca reciente, para el brazo "evidencia" ───────────────────────
  const mejorMarca = calcularMejorMarca(historial);

  // ── Estado de hoy ─────────────────────────────────────────────────────────
  const checkHoy = porTipo(EVENTO.CHECK_REGISTRADO).filter((e) => e.dia === hoy).pop()?.datos || null;
  const sesionHoy = listaSesiones.filter((s) => s.dia === hoy).pop() || null;
  const habitosHoy = {};
  for (const e of porTipo(EVENTO.HABITO_REGISTRADO)) {
    if (e.dia === hoy) habitosHoy[e.datos.habitoId] = e.datos.valor;
  }

  const ultimaHecha = [...hechas].reverse()[0];
  const diasSinEntrenar = ultimaHecha ? diasEntre(ultimaHecha.dia, hoy) : null;

  // Qué ejercicio se usó la última vez en cada hueco, para variar sin perder el hilo.
  const ultimosPorHueco = (listaSesiones.filter((s) => s.terminada).pop()?.plan?.bloques || [])
    .map((b) => b.ejercicio?.id || null);

  _proy = {
    hoy, perfil, ajustes,
    listaSesiones, hechas, historial, vecesHecho, volumenSemanal,
    sesionesHechas: hechas.length,
    posteriores, intentos, checks, senales, racha,
    adherencia: adherencia4Semanas(intentos, hoy),
    mejorMarca, checkHoy, sesionHoy, habitosHoy, diasSinEntrenar, ultimosPorHueco,
    totalEventos: _eventos.length,
  };
}

function porTipo(tipo) { return _eventos.filter((e) => e.tipo === tipo); }
function ultimoDato(tipo) { const l = porTipo(tipo); return l.length ? l[l.length - 1].datos : null; }

function calcularMejorMarca(historial) {
  let mejor = null;
  for (const [ejId, h] of Object.entries(historial)) {
    if (h.sesiones.length < 3) continue;
    const primera = h.sesiones[0];
    const ultima = h.sesiones[h.sesiones.length - 1];
    const desde = Math.max(0, ...primera.series.map((s) => s.carga || 0));
    const hasta = Math.max(0, ...ultima.series.map((s) => s.carga || 0));
    if (!desde || hasta <= desde) continue;
    const semanas = Math.max(1, Math.round(diasEntre(primera.dia, ultima.dia) / 7));
    const ganancia = (hasta - desde) / desde;
    if (!mejor || ganancia > mejor.ganancia) {
      mejor = { ejercicioId: ejId, desde, hasta, semanas, ganancia, nombre: null };
    }
  }
  return mejor;
}

/** Curva de 1RM estimado de un ejercicio, para la pantalla de progreso. */
export function curva1RM(ejercicioId) {
  const h = _proy?.historial?.[ejercicioId];
  if (!h) return [];
  return h.sesiones.map((s) => {
    const mejor = s.series.reduce((m, x) => {
      const e = estimar1RM(x.carga, x.reps);
      return e && (!m || e > m) ? e : m;
    }, null);
    return { dia: s.dia, valor: mejor };
  }).filter((p) => p.valor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Acciones — la única forma de escribir
// ─────────────────────────────────────────────────────────────────────────────

export const definirPerfil = (perfil) => emitir(EVENTO.PERFIL_DEFINIDO, perfil);
export const registrarCheck = (check) => emitir(EVENTO.CHECK_REGISTRADO, check);
export const proponerSesion = (plan) => emitir(EVENTO.SESION_PROPUESTA, plan);
export const iniciarSesion = (sesionId) => emitir(EVENTO.SESION_INICIADA, { sesionId });
export const registrarSerie = (datos) => emitir(EVENTO.SERIE_REGISTRADA, datos);
export const terminarSesion = (sesionId, d) => emitir(EVENTO.SESION_TERMINADA, { sesionId, ...d });
export const saltarSesion = (sesionId, motivo) => emitir(EVENTO.SESION_SALTADA, { sesionId, motivo });
export const registrarHabito = (habitoId, valor) => emitir(EVENTO.HABITO_REGISTRADO, { habitoId, valor });
export const escribirNota = (texto) => emitir(EVENTO.NOTA_ESCRITA, { texto });
export const cambiarAjuste = (clave, valor) => emitir(EVENTO.AJUSTE_CAMBIADO, { [clave]: valor });

export { HABITOS };
