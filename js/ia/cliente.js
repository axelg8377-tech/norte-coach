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

  return llamar(prompt);
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
