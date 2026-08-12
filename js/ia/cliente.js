/**
 * cliente.js — la capa de IA. Estrictamente opcional.
 *
 * Contrato de la API verificado contra la API real (Improvisador, 2026-08-05):
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   cabecera x-goog-api-key
 *   cuerpo   { model, system_instruction, input, generation_config }
 *   respuesta { steps: [{type:'thought'}, {type:'model_output', content:[{type:'text', text}]}] }
 * NO es `models/{m}:generateContent`. Si algún día devuelve 404, revisar esto primero.
 *
 * ─── Reglas que no se negocian ───────────────────────────────────────────────
 * 1. Ninguna pantalla espera a la IA para pintarse. La IA amplía texto que YA
 *    está en pantalla, generado por `mensajes.js`. Si falla, no se rompe nada.
 * 2. Hay timeout. Un fetch sin timeout en un celular con una barra de señal se
 *    queda colgado para siempre y parece que la app se trabó.
 * 3. BYOK: la clave la pone el usuario y vive en IndexedDB, nunca en el repo,
 *    y nunca dentro del archivo de respaldo.
 * 4. El prompt lleva datos reales del usuario y la instrucción explícita de no
 *    inventar. Un coach que se inventa tus números es peor que no tener coach.
 */

import { leerKV, guardarKV, borrarKV } from '../db.js';
import { porId } from '../dominio/catalogo.js';

const URL_API = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODELO = 'gemini-3.6-flash';
const TIMEOUT_MS = 20000;

let _clave = null;

export async function cargarClave() {
  _clave = (await leerKV('clave_ia')) || null;
  return !!_clave;
}

export async function guardarClave(clave) {
  const limpia = (clave || '').trim();
  if (!limpia) { await borrarKV('clave_ia'); _clave = null; return false; }
  await guardarKV('clave_ia', limpia);
  _clave = limpia;
  return true;
}

export function hayIA() { return !!_clave && navigator.onLine; }
export function hayClave() { return !!_clave; }

const SISTEMA = `Sos el entrenador de una persona que usa la app Norte. No sos un chatbot.

Cómo hablás:
- Español rioplatense, vos. Directo, sin adornos.
- Nunca decís "¡vos podés!", "increíble", "excelente trabajo" ni nada parecido.
- No usás emojis, ni listas con viñetas decorativas, ni negrita de adorno.
- Máximo 4 oraciones. Si podés en 2, mejor.

Qué hacés:
- Explicás la decisión del día usando SOLO los datos que te paso.
- Si los datos muestran una inconsistencia entre lo que la persona dice y lo que hace, se la marcás sin rodeos.
- Si no hay datos suficientes para afirmar algo, lo decís en una línea en vez de inventar.

Prohibido: inventar números, pesos, fechas o tendencias que no estén en los datos. Si no está, no existe.`;

async function llamar(prompt, { temperatura = 0.7 } = {}) {
  if (!_clave) throw new Error('sin_clave');
  if (!navigator.onLine) throw new Error('sin_red');

  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL_API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': _clave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        system_instruction: SISTEMA,
        input: prompt,
        generation_config: { temperature: temperatura, max_output_tokens: 400 },
      }),
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    const datos = await r.json();
    const texto = (datos.steps || [])
      .filter((p) => p.type === 'model_output')
      .flatMap((p) => p.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim();
    if (!texto) throw new Error('respuesta_vacia');
    return texto;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Amplía la explicación de la sesión del día. Es la única llamada que hace la app
 * por sí sola, y solo cuando el usuario la pide tocando un botón.
 */
export async function pedirLectura(plan, proy) {
  const bloques = plan.bloques
    .map((b) => `- ${b.ejercicio.n} (${b.patronNombre}): ${b.series}×${b.repsObjetivo.join('-')}${b.carga ? ` con ${b.carga} kg` : ''}`)
    .join('\n');

  const senales = (proy.senales || []).slice(0, 3)
    .map((s) => `- ${s.texto} (${s.evidencia})`).join('\n') || '- ninguna';

  const marca = proy.mejorMarca
    ? `${porId(proy.mejorMarca.ejercicioId)?.n || 'un ejercicio'}: ${proy.mejorMarca.desde} → ${proy.mejorMarca.hasta} kg en ${proy.mejorMarca.semanas} semanas`
    : 'todavía no hay progreso medible';

  const prompt = `Datos reales de hoy:
- Disposición: ${plan.disposicion}/100 (sueño ${proy.checkHoy?.sueno}/5, energía ${proy.checkHoy?.energia}/5, ánimo ${proy.checkHoy?.animo}/5)
- Modo elegido por el motor: ${plan.modo}
- Sesión: ${plan.minutosEstimados} min
${bloques}

Contexto:
- Adherencia últimas 4 semanas: ${proy.adherencia ?? 'sin datos'}%
- Racha: ${proy.racha?.actual ?? 0}
- Días sin entrenar: ${proy.diasSinEntrenar ?? 0}
- Mejor progreso: ${marca}
- Sesiones totales: ${proy.hechas?.length ?? 0}

Señales de adherencia detectadas:
${senales}

Lo que la app ya le dijo (no lo repitas):
${plan.porQue.join(' ')}

Escribí lo que un entrenador que conoce estos datos le diría hoy y que la app todavía no dijo. Si hay una contradicción entre lo que hace y lo que busca, marcala.`;

  const texto = await llamar(prompt);
  const malas = cifrasInventadas(texto, cifrasPermitidas(plan, proy));
  if (malas.length) throw new Error(`cifras_inventadas:${malas.join(',')}`);
  return texto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardia de cifras
//
// La regla 4 del encabezado prohíbe inventar números, y hasta la v2 nadie la
// verificaba: el texto se pintaba tal cual venía. Un coach que dice "venís
// levantando 80 kg" cuando levantás 60 es peor que no tener coach, porque el
// resto de lo que dice deja de ser creíble.
//
// Se miran solo las cifras que se pueden confundir con un dato: kilos,
// porcentajes y números grandes. Las chicas (repeticiones, series, una escala de
// 1 a 5) se dejan pasar a propósito: marcarlas daría falsos positivos todo el
// tiempo y un chequeo con falsos positivos se termina apagando.
// ─────────────────────────────────────────────────────────────────────────────

export function cifrasPermitidas(plan, proy = {}) {
  const s = new Set();
  const meter = (n) => { if (n != null && n !== '' && Number.isFinite(Number(n))) s.add(String(Number(n))); };

  meter(plan?.disposicion);
  meter(plan?.minutosEstimados);
  for (const b of plan?.bloques || []) {
    meter(b.series); meter(b.carga); meter(b.descanso);
    for (const r of b.repsObjetivo || []) meter(r);
  }
  for (const c of plan?.calentamiento || []) meter(Math.round((c.segundos || 0) / 60));
  meter(proy.adherencia);
  meter(proy.racha?.actual);
  meter(proy.racha?.mejor);
  meter(proy.hechas?.length);
  meter(proy.diasSinEntrenar);
  meter(proy.checkHoy?.sueno); meter(proy.checkHoy?.energia); meter(proy.checkHoy?.animo);
  meter(proy.mejorMarca?.desde); meter(proy.mejorMarca?.hasta); meter(proy.mejorMarca?.semanas);
  for (const [patron, series] of Object.entries(proy.volumenSemanal || {})) { void patron; meter(series); }
  return s;
}

export function cifrasInventadas(texto, permitidas) {
  const halladas = new Set();
  for (const m of String(texto).matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|kilos|%)/gi)) {
    halladas.add(m[1].replace(',', '.'));
  }
  for (const m of String(texto).matchAll(/(?<![\d.,%])(\d{2,})(?![\d.,]*\s*(?:seg|s\b))/g)) {
    if (Number(m[1]) >= 15) halladas.add(m[1]);
  }
  return [...halladas].filter((n) => !permitidas.has(String(Number(n))));
}

/**
 * Conversación con memoria. La v1 armaba cada prompt desde cero, así que el
 * coach no recordaba lo que vos le habías dicho dos minutos antes. Los turnos
 * viven en el log de eventos como todo lo demás.
 *
 * @param {string} pregunta
 * @param {Object} ctx { proy, plan, bloqueActivo, historia:[{quien,texto}] }
 */
export async function conversar(pregunta, { proy = {}, plan = null, bloqueActivo = null, historia = [] } = {}) {
  const turnos = historia.slice(-6)
    .map((t) => `${t.quien === 'vos' ? 'Persona' : 'Vos (entrenador)'}: ${t.texto}`)
    .join('\n');

  const sesion = plan
    ? `Sesión de hoy (${plan.modo}, ${plan.minutosEstimados} min):\n`
      + plan.bloques.map((b) => `- ${b.ejercicio.n}: ${b.series}×${b.repsObjetivo.join('-')}${b.carga ? ` con ${b.carga} kg` : ''}`).join('\n')
    : 'Todavía no hay sesión decidida para hoy.';

  const enCurso = bloqueActivo
    ? `\nAhora mismo está haciendo: ${bloqueActivo.ejercicio.n} (${bloqueActivo.patronNombre}), ${bloqueActivo.series}×${bloqueActivo.repsObjetivo.join('-')}${bloqueActivo.carga ? ` con ${bloqueActivo.carga} kg` : ''}. Está entre series, con el celular en la mano y sudado: contestá corto.`
    : '';

  const prompt = `${turnos ? `Conversación previa:\n${turnos}\n\n` : ''}Pregunta ahora: ${pregunta}

${sesion}${enCurso}

Contexto:
- ${proy.hechas?.length ?? 0} sesiones registradas · adherencia ${proy.adherencia ?? 'sin datos'}%
- Objetivo: ${proy.perfil?.objetivo ?? 'sin definir'} · entrena ${proy.perfil?.diasPorSemana ?? '?'} días por semana
- Señales activas: ${(proy.senales || []).map((s) => s.texto).join(' · ') || 'ninguna'}

Contestá con esos datos. Si necesitás información que no tenés, decilo en una línea.`;

  return llamar(prompt, { temperatura: 0.5 });
}

/**
 * Traduce una frase a restricciones para el motor. `dominio/pedido.js` ya lo
 * hace sin red; esto se usa solo cuando esa tabla no entendió nada, y devuelve
 * el mismo objeto. La IA nunca escribe la sesión: escribe el pedido.
 */
export async function interpretarPedido(texto) {
  const prompt = `Convertí este pedido de entrenamiento en JSON y no escribas nada más:
"${texto}"

Formato exacto:
{"patronPreferido": null, "excluirPatrones": [], "minutos": null}

Valores válidos de patrón: empuje_horizontal, empuje_vertical, traccion_horizontal, traccion_vertical, sentadilla, bisagra, zancada, core, aislamiento.
minutos: número entero o null. Si el pedido no dice nada de un campo, dejalo en null o en lista vacía.`;

  const bruto = await llamar(prompt, { temperatura: 0 });
  const json = bruto.match(/\{[\s\S]*\}/);
  if (!json) throw new Error('respuesta_no_json');
  const r = JSON.parse(json[0]);
  return {
    patronPreferido: r.patronPreferido || null,
    excluirPatrones: Array.isArray(r.excluirPatrones) ? r.excluirPatrones : [],
    minutos: Number.isFinite(Number(r.minutos)) ? Number(r.minutos) : null,
    entendido: true,
  };
}

/** Pregunta libre desde ajustes. El usuario escribe, el coach responde con contexto. */
export async function preguntar(texto, proy) {
  const prompt = `Pregunta: ${texto}

Contexto del usuario:
- ${proy.hechas?.length ?? 0} sesiones registradas
- Adherencia 4 semanas: ${proy.adherencia ?? 'sin datos'}%
- Objetivo: ${proy.perfil?.objetivo ?? 'sin definir'}
- Entrena ${proy.perfil?.diasPorSemana ?? '?'} días por semana
- Señales activas: ${(proy.senales || []).map((s) => s.texto).join(' · ') || 'ninguna'}

Contestá con esos datos. Si la pregunta necesita información que no tenés, decilo.`;
  return llamar(prompt, { temperatura: 0.5 });
}

/** Verifica que la clave sirva, sin gastar una llamada real de coaching. */
export async function probarClave(clave) {
  const anterior = _clave;
  _clave = (clave || '').trim();
  try {
    await llamar('Contestá exactamente: ok', { temperatura: 0 });
    return true;
  } catch (e) {
    _clave = anterior;
    throw e;
  }
}
