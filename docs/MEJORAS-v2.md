# Norte v2 — 15 mejoras, con el código a la vista

> **Estado: las 15 están construidas** (2026-08-11, mismo día). El arnés pasó de 59 a 90
> comprobaciones, todas en verde, y el flujo completo se probó a mano en el navegador. Las tres
> olas se hicieron de una porque Axel lo pidió así; el paso que sigue sí es usarla dos semanas
> antes de tocar nada más. Los porqués de las decisiones estructurales quedaron en
> `DECISIONES.md` D-09 a D-12, y lo que el navegador encontró y el arnés no veía, también.

Escrito el 2026-08-11 después de que Axel usara la v1 en un gimnasio real. Las quejas
textuales fueron cinco: no deja reiniciar una sesión, hacer la rutina es malísimo, el coach
no toma protagonismo, el buscador es pobre, el progreso no se entiende.

Cada mejora lleva **dónde está el problema en el código**, no una idea suelta. El orden no es
por gusto: la ola 1 es lo que hace que la app moleste hoy, y hasta que no esté, el resto no
se nota.

Antes y después de cada una: `node scripts/verificar.mjs` en verde.

---

## Diagnóstico de raíz

Tres decisiones de la v1 explican casi todas las quejas juntas:

1. **El día es inmutable.** El log es append-only y correcto, pero la interfaz nunca aprendió
   a emitir un evento de arrepentimiento. Una vez que se guarda el check, el día quedó
   decidido hasta las 00:00. Eso es lo que se siente como "no me deja reiniciar".
2. **El coach es un botón, no un interlocutor.** `pedirLectura()` amplía un párrafo una vez
   por día (`hoy.js:188`) y `preguntar()` está enterrado a tres toques adentro de Ajustes
   (`ajustes.js:96`). El producto se llama coach y la IA no decide nada.
3. **El motor es determinista y no negocia.** `motor.js:185` toma siempre `opciones[0]`. El
   parámetro `obs.azar` está documentado en la firma (línea 93) y **no se usa en el cuerpo**.
   Dos días con el mismo check dan exactamente la misma sesión, sin forma de discutirla.

---

## Ola 1 — sacar lo que molesta (5 mejoras, todas de complejidad baja)

### M-01 · Rehacer el día
**Dónde:** `hoy.js:29-33`. El router mira `p.sesionHoy` y, si tiene `plan`, entra a
`propuesta()` para siempre. La única salida es "Hoy no puedo", que registra un fallo, o
"Borrar todo" en Ajustes, que borra el historial entero.

**Qué se hace:** evento nuevo `SESION_DESCARTADA` y dos botones en la propuesta: *rehacer el
check* y *otra propuesta*. No se borra nada: el descarte es otro evento y la proyección de
`estado.js:162` toma la última sesión del día que no esté descartada. El log sigue diciendo
la verdad, incluido que descartaste tres veces.

**Por qué primero:** es la queja número uno y hoy no tiene salida que no sea destructiva.

### M-02 · Abandonar una sesión empezada sin ensuciar los datos
**Dónde:** `sesion.js:27-28` y `sesion.js:160-168`. Si iniciaste, la única puerta es "Terminar
acá", que emite `SESION_TERMINADA`. Una sesión de dos series entra como sesión hecha: sube
la adherencia (`estado.js:142-144`), premia al brazo del bandit (`estado.js:135-138`) y
contamina la progresión.

**Qué se hace:** botón *descartar esta sesión* que emite `SESION_DESCARTADA` y devuelve a la
propuesta. Distinguir tres finales que hoy son dos: terminada, cortada (cuenta, con marca de
parcial) y descartada (no cuenta para nada).

### M-03 · Sustituir un ejercicio en el momento
**Dónde:** `sesion.js:100` ofrece *saltear*, que registra las series faltantes con reps 0
(`sesion.js:143-158`). Correcto para el historial, pésimo para el gimnasio: la máquina
ocupada te deja sin ese patrón.

**Qué se hace:** `candidatos()` ya devuelve la lista completa ordenada (`catalogo.js:165`
retorna `lista`, no `lista[0]`). Falta una hoja con las 5 alternativas del mismo patrón y
equipo. El plan se reescribe en un evento `BLOQUE_SUSTITUIDO`. Es la P-04 del ROADMAP y es
media hora de trabajo.

### M-04 · La entrada en calor dice qué hacer
**Dónde:** `motor.js:70-71` reserva 4-8 minutos y `motor.js:238-241` los suma al total. Nadie
dice nunca qué pasa en esos minutos.

**Qué se hace:** un bloque `calentamiento` en el retorno de `decidir()`, armado con los
ejercicios de movilidad del catálogo filtrados por `patronesUsados`, que ya se calcula
(`motor.js:144`). Dos o tres movimientos, sin series ni carga, con duración. P-01 del ROADMAP.

### M-05 · Temporizador de descanso honesto
**Dónde:** no existe. Después de `Serie hecha` (`sesion.js:98`) la pantalla se repinta y el
descanso queda a ojo. 90 segundos y 3 minutos entrenan cosas distintas.

**Qué se hace:** cuenta regresiva con **marca de tiempo absoluta guardada**, no `setTimeout`.
Con la pantalla apagada `setTimeout` se congela y el temporizador miente; uno que miente es
peor que ninguno. Al volver a foco se recalcula contra `Date.now()`. Duración sugerida por
rol: pesado 180 s, compuesto 120 s, accesorio 60 s.

---

## Ola 2 — el coach toma el mando (5 mejoras)

### M-06 · El coach sale de Ajustes y va al frente
**Dónde:** `ajustes.js:96` — *"Preguntarle algo al coach"* está en la cuarta pantalla, abajo,
como botón plano. `hoy.js:188` — el único uso protagonista es un botón que dice "pedirle al
coach que lo explique mejor", o sea, opcional y decorativo.

**Qué se hace:** entrada de conversación fija abajo en Hoy y en Sesión. La app abre con lo
que el coach tiene para decir hoy, no con un párrafo generado por plantilla que el coach
puede ampliar si le pedís permiso.

### M-07 · El coach arma la sesión — sin romper la pureza del motor
**Dónde:** `motor.js:94` recibe una observación cerrada. La IA hoy solo lee el resultado.

**Qué se hace:** *"hoy quiero espalda y tengo 40 minutos"* no lo resuelve la IA escribiendo
la rutina. La IA traduce esa frase a **restricciones** — `{ patronPreferido, excluir,
minutos, evitarEquipo }` — que entran como parámetros nuevos de `decidir()`. El motor sigue
siendo la única autoridad y sigue siendo puro; la IA es el traductor de lenguaje natural a
observación. Si la IA está caída, los mismos controles existen como fichas.

Esto es lo que convierte "la rutina que entrega es malísima" en "la rutina se negocia".

### M-08 · Memoria de conversación
**Dónde:** `cliente.js:100` y `cliente.js:137`. Cada llamada arma el prompt desde cero. No
hay historia. Le decís "el hombro" y a los dos minutos no sabe de qué hablás.

**Qué se hace:** cada turno es un evento `COACH_TURNO` en el log, y el prompt lleva los
últimos 6. Sale gratis en arquitectura: el log ya está y las proyecciones se recalculan.

### M-09 · El coach existe entre series
**Dónde:** `sesion.js` no importa nada de `ia/`. Entre serie y serie hay 90 a 180 segundos
muertos mirando el techo — el mejor momento del día para preguntar algo.

**Qué se hace:** acceso al coach desde la sesión, con el bloque `activo` en el prompt.
"¿Por qué este ejercicio?", "me tira el hombro", "¿subo el peso?". Depende de M-05 para
tener el hueco de tiempo bien definido.

### M-10 · La IA no puede contradecir al motor
**Dónde:** `cliente.js:131` pide texto y `hoy.js:248` lo pinta sin mirar. La regla 4 del
encabezado dice "prohibido inventar números" y nadie la verifica.

**Qué se hace:** antes de pintar, extraer las cifras del texto y comprobar que existan en el
plan o en la proyección. Si cita un peso que no está, no se muestra. P-10 del ROADMAP: no es
una función, es integridad.

---

## Ola 3 — rutina, buscador, progreso (5 mejoras)

### M-11 · Modo manual asistido — decisión reabierta
**Dónde:** `buscar.js:5-8` y `CLAUDE.md` prohíben explícitamente armar la rutina a mano. El
motivo escrito era bueno: si se puede armar a mano, el motor sobra y la app vuelve a ser una
planilla. Axel lo reabre el 2026-08-11 después de usarla.

**La salida que conserva el motor:** se puede armar la sesión eligiendo ejercicios, y el motor
**no desaparece: prescribe**. Vos elegís qué; él dice cuántas series, cuántas reps, con cuánto
peso según tu historial, y escribe arriba el diagnóstico: *"esto son 4 empujes y ninguna
tracción; llevás 3 semanas así"*. La sesión manual se guarda con `origen: 'manual'` para poder
comparar después adherencia y equilibrio entre las manuales y las del motor. Si a las 20
sesiones las manuales están peor en las dos, el dato cierra la discusión solo.

### M-12 · Que dos días iguales no den la misma sesión
**Dónde:** `motor.js:185` — `const ej = opciones[0]`. Y `obs.azar`, documentado en la firma
(`motor.js:93`) como inyectable para que el arnés sea determinista, **nunca se usa**.

**Qué se hace:** elegir entre los 3 primeros candidatos usando `obs.azar`, con peso decreciente
para que el canónico siga ganando la mayoría de las veces. El arnés inyecta un azar fijo y
sigue siendo determinista. Es un cambio de cuatro líneas y es la mitad de la sensación de
"rutina malísima".

### M-13 · Un buscador que sirva
**Dónde:** `catalogo.js:169-177`. Es `includes()` sobre tres campos, sin puntaje, y corta con
`.slice(limite)` **antes de ordenar por nada** — o sea, los 400 que devuelve son los primeros
del índice, no los mejores. Arriba, `buscar.js:47` muestra 60 de esos 400 y te dice "afiná la
búsqueda" sin decirte cómo.

**Qué falta, concreto:**
- Tokenizar la consulta: *"press banca"* tiene que encontrar *"Press de banca con barra"*.
  Hoy no lo encuentra, porque el string exacto no está.
- Puntaje: match al principio del nombre por encima de match en el medio, nombre en español
  por encima del inglés, compuesto por encima de aislamiento.
- Filtros que ya existen en los datos y no están en la interfaz: equipo (`e`, `g`) y zona
  (`z`). Hoy solo hay patrón (`buscar.js:29`).
- **Y lo que lo vuelve útil: "agregarlo a la sesión de hoy" desde el resultado.** Sin eso,
  buscar es mirar una enciclopedia. Con eso, es la mitad de M-11.

### M-14 · Que el progreso conteste preguntas que uno se hace
**Dónde:** `progreso.js` abre con `% de adherencia` — un número que solo significa algo si ya
sabés cómo se calcula — y sigue con 1RM de Epley dibujado con `chispa()`, sin ejes ni valores.
La pantalla está bien pensada para un ingeniero y no contesta las tres preguntas reales:
*¿estoy más fuerte?*, *¿estoy cumpliendo?*, *¿qué tengo flojo?*.

**Qué se hace:** reordenar por pregunta, no por métrica.
1. *¿Más fuerte que hace un mes?* → delta en kg y en %, por patrón, con el número escrito.
2. *¿Estoy cumpliendo?* → calendario de 4 semanas con celdas, que se entiende de un vistazo.
   El porcentaje va abajo, como explicación.
3. *¿Qué está flojo?* → lo que ya hace `equilibrio()`, que es lo mejor de la pantalla.

Cada bloque cierra con una frase que dice **qué hacer con eso**, no solo qué pasó.

### M-15 · El día 1 no puede ser una pantalla vacía
**Dónde:** `progreso.js:24-31` dice "todavía no hay nada que mostrar", `progreso.js:111-115`
dice "todavía no lo suficiente", y las señales de `adherencia.js` necesitan semanas. Las
primeras tres sesiones, la app te contesta cuatro veces que es muy pronto.

**Qué se hace:** mostrar el camino en vez del vacío. *"Faltan 2 sesiones para que pueda
estimar tu fuerza"*, con la barra. Y en el onboarding, la sesión de ejemplo que armaría el
motor con lo que acabás de contestar — la primera prueba de que la cosa piensa tiene que
llegar antes de la primera sesión, no después de la décima.

---

## El loop de trabajo

Tres olas, una entrega por ola, cada una usable sola:

| Ola | Contenido | Criterio para pasar a la siguiente |
|---|---|---|
| 1 | M-01 a M-05 | Axel entrena **dos veces** con la ola 1 y ninguna de las cinco quejas originales aparece |
| 2 | M-06 a M-10 | Una sesión negociada con el coach de punta a punta, sin tocar una ficha |
| 3 | M-11 a M-15 | Dos sesiones armadas a mano y dos del motor, para comparar |

**El paso que no se saltea:** entre ola y ola, Axel usa la app en el gimnasio. La v1 se
construyó entera en un ciclo y se probó después. Eso es exactamente lo que produjo esta lista.
Sigue pendiente B-22: nunca se verificó en un celular real.

## Lo que sigue descartado, y por qué

Compartir en redes, rachas diarias estrictas y gamificación con medallas siguen afuera con los
motivos de `ROADMAP.md`. Nada de las 15 mejoras los toca. La única decisión que se reabre es el
armado manual, y se reabre acotada: **el motor sigue prescribiendo**, y las sesiones manuales
quedan marcadas para poder medir si fueron mejores o peores.
