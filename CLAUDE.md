# Norte — instrucciones del proyecto

App personal de Axel. PWA vanilla, sin build, sin backend, sin Firebase. Segunda app del
stack sin Firebase después de Improvisador. **No** aplica `stack-oficial.md` de las
verticales, ni App Check, ni Rules.

## Antes de tocar nada

```bash
node scripts/verificar.mjs
```

90 comprobaciones. Tiene que dar verde **antes y después** de cualquier cambio. Si algo se
rompe y el arnés sigue en verde, falta un chequeo: agregarlo en el mismo commit que el fix.

**Y después probala en el navegador.** El arnés prueba que el motor decide bien, no que el
producto se pueda usar. En la v2, tres bugs reales aparecieron en los primeros cinco minutos de
uso con el arnés entero en verde (están listados en `docs/DECISIONES.md`). Servir la carpeta y
hacer el flujo completo cuesta dos minutos:

```bash
python -m http.server 8899   # y abrir http://localhost:8899
```

## Reglas que ya se pagaron

1. **Al deployar, subir `CACHE` en `sw.js`.** Si no, el service worker sirve la versión
   vieja. En Improvisador costó tres iteraciones creyendo que un arreglo estaba mal.
2. **`js/dominio/` no puede importar nada de `js/ui/`, ni tocar el DOM, ni `fetch`, ni
   IndexedDB.** Es lo que permite probar el motor en Node. Si un módulo de dominio
   necesita un dato, entra por parámetro.
3. **Un archivo nuevo en `js/` va también a la lista `PRECARGA` de `sw.js`.** El arnés lo
   verifica, pero conviene hacerlo en el momento.
4. **`css/app.css` no lleva colores crudos.** Todo sale de `tokens.css`. Verificado.
5. **Ningún texto de interfaz sin un dato adentro.** Ver `docs/DECISIONES.md` D-06.
6. **El endpoint de Gemini es `POST /v1beta/interactions`**, no
   `models/{m}:generateContent`. Respuesta en `steps[] → type:"model_output" →
   content[].text`. Verificado contra la API real.

## Arquitectura en tres líneas

Se persiste un **log de eventos append-only** en IndexedDB. Todo lo demás son proyecciones
que se recalculan al arrancar (`estado.js`). `motor.js` es una **función pura** que recibe
una observación y devuelve la sesión del día. Por qué: `docs/DECISIONES.md` D-04 y D-01.

## Lo que no se hace

No sincronización, no gamificación, no compartir en redes. Cada uno con su motivo y su condición
de reapertura en `docs/DECISIONES.md` y `docs/ROADMAP.md`. Si vas a proponer alguno, leé primero
por qué se descartó.

**El editor de rutinas a mano salió de esta lista el 2026-08-11** (D-12), reabierto por Axel
después de usar la v1. Se reabrió acotado: elegís los ejercicios, el motor sigue prescribiendo
series, repeticiones y carga, y escribe el desbalance. Las sesiones manuales llevan
`origen: 'manual'` para poder compararlas contra las del motor a las 20 sesiones.

## Reglas nuevas de la v2

7. **Arrepentirse es un evento, nunca un borrado.** `sesion.descartada` saca la sesión de las
   proyecciones sin sacarla del log.
8. **El motor sortea, pero con semilla.** `azarSembrado(dia|sesionesHechas|intento)`. Nunca
   `Math.random()` en `decidir()`: la sesión mutaría al repintar y el arnés dejaría de servir.
9. **Negociar la sesión no puede depender de la red.** `dominio/pedido.js` traduce la frase a
   restricciones sin IA; la IA solo entra si esa tabla no entendió nada.
10. **La IA no puede citar un número que no esté en el plan.** `cifrasInventadas()` lo verifica
    antes de pintar el texto.

## Deploy

GitHub Pages desde `main`, raíz del repo. Commit y deploy **exigen confirmación explícita
de Axel**, como en todos sus proyectos.
