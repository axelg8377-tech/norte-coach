# Norte — instrucciones del proyecto

App personal de Axel. PWA vanilla, sin build, sin backend, sin Firebase. Segunda app del
stack sin Firebase después de Improvisador. **No** aplica `stack-oficial.md` de las
verticales, ni App Check, ni Rules.

## Antes de tocar nada

```bash
node scripts/verificar.mjs
```

59 comprobaciones. Tiene que dar verde **antes y después** de cualquier cambio. Si algo se
rompe y el arnés sigue en verde, falta un chequeo: agregarlo en el mismo commit que el fix.

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

No sincronización, no editor de rutinas a mano, no gamificación, no compartir en redes.
Cada uno con su motivo y su condición de reapertura en `docs/DECISIONES.md` y
`docs/ROADMAP.md`. Si vas a proponer alguno, leé primero por qué se descartó.

## Deploy

GitHub Pages desde `main`, raíz del repo. Commit y deploy **exigen confirmación explícita
de Axel**, como en todos sus proyectos.
