# Decisiones

Lo que no se lee del código. Cada entrada dice qué se descartó y bajo qué condición
se reabre — sin eso, dentro de un año alguien vuelve a proponer lo mismo y hay que
re-derivar el argumento entero.

---

## D-01 · Gymnasium no entra como dependencia. Su contrato, sí

**Qué se pidió.** Usar `Farama-Foundation/Gymnasium` como uno de los dos repos base.

**Por qué no.** Dos razones, y la segunda es la que importa:

1. Gymnasium es Python puro. La app corre en un navegador de celular sin backend.
   Meterlo exigiría un servidor, y eso rompe el requisito de funcionar sin internet.
2. **El problema real es la cantidad de datos.** El aprendizaje por refuerzo necesita
   del orden de 10.000 episodios para converger. Acá un episodio es un día de
   entrenamiento. Son 27 años. Un agente entrenado con 150 muestras ruidosas no
   descubre nada que las reglas de programación de fuerza no digan ya, y además
   puede recomendar una barbaridad con total confianza.

**Qué sí se conservó.** El contrato: observación → política → acción → recompensa.
`motor.js` es exactamente eso y es una función pura, así que se puede reemplazar la
política entera sin tocar una línea de interfaz.

**Dónde sí hay datos para aprender.** En la adherencia, no en el entrenamiento.
"¿Qué encuadre hace que aparezcas?" es una recompensa binaria, inmediata y observable,
con 4-5 brazos y ~150 decisiones al año. Ahí un bandit contextual con priors informados
sí separa señal de ruido. Eso es `bandit.js`.

**Se reabre si:** aparece una fuente de datos de alta frecuencia (un reloj con HRV y
sueño medido, varias señales por día en vez de una). Con eso el espacio de observación
crece y una política aprendida empieza a tener sentido — corriendo en un servidor, no
en el teléfono.

---

## D-02 · El dataset se curó y se enriqueció, no se usó tal cual

**Qué pasó.** El crudo pesa 17 MB: instrucciones en 10 idiomas, duplicadas como texto
corrido y como pasos. Precachear eso en un celular es inaceptable.

**Qué se hizo.** `scripts/curar-dataset.mjs`, reproducible: solo español, partido en
índice (285 KB, se carga al arrancar) e instrucciones (702 KB, se cargan al abrir un
ejercicio).

**El agregado que importa.** El dataset trae músculo objetivo pero **no trae patrón de
movimiento**. Un programa de fuerza no se arma con "hoy pecho", se arma con patrones
—empuje, tracción, bisagra, sentadilla— porque emparejarlos es lo que evita
desequilibrios a un año. Esa clasificación la agrega el script con reglas por nombre y
un respaldo por músculo objetivo. Es la razón por la que `motor.js` puede armar sesiones
equilibradas en vez de listar ejercicios de un grupo muscular.

**Los nombres se traducen con un glosario determinista.** El primer intento tradujo
palabra por palabra y produjo "Con barra sentado press militar": el inglés nombra
`equipo + modificadores + movimiento` y el español al revés. Se reescribió para
reordenar. Quedan ~34 de 1.324 con algún término en inglés, y el nombre original se
conserva en el campo `en` de cada registro para poder auditarlo desde la app.

**Los GIFs no se precachean.** Son 1.324 archivos remotos, ~180 MB. Se cachean bajo
demanda con un tope de 120, que cubre varios meses. La app funciona sin ellos.

---

## D-03 · Los datos viven solo en el dispositivo

**Alternativas evaluadas.** Firebase con sincronización · respaldo automático a un Gist
privado · local puro.

**Se eligió local puro con export/import de JSON.** Cero backend, cero costo, cero
cuentas, offline nativo y privacidad total.

**La contra es real y conocida:** celular y PC quedan con historiales separados. Es la
misma que ya se paga en Improvisador. Se mitiga en tres puntos:

- El importador **fusiona por id, no reemplaza**: importar dos veces no duplica nada, e
  importar el respaldo de la PC en el celular une los dos historiales. Ir y volver
  funciona.
- Ajustes avisa cuando pasaron 14 días sin respaldo, con el texto explícito de que si se
  pierde el teléfono se pierde todo.
- La clave de la API **no** entra en el archivo de respaldo, para que se pueda compartir
  o guardar en cualquier lado sin filtrar una credencial.

**Se reabre si:** se empieza a entrenar en dos lugares y el import manual se vuelve una
fricción real y medida, no imaginada. La primera opción entonces es el Gist privado
—resuelve respaldo y multi-dispositivo sin backend— no Firebase.

---

## D-04 · Event sourcing en vez de estado mutable

Lo único que se persiste es un log append-only. El perfil, el historial de cargas, la
racha, las posteriores del bandit y las señales de recaída son proyecciones que se
recalculan al arrancar.

**Por qué, si es más trabajo.** El pedido era "una base que pueda evolucionar durante
años sin reescribirla". Esto es lo que lo hace posible: una métrica que se invente en
2028 puede leer los eventos de hoy y calcularla con todo el historial. Con estado
mutable, ese dato ya se perdió. Además un bug en una proyección se arregla y se
recalcula, sin corromper el historial.

**Costo aceptado:** recalcular al arrancar. Con ~5 eventos por día son ~1.800 al año y
proyectarlos toma milisegundos. Si algún día molesta, se agregan snapshots — que es una
optimización, no un rediseño.

---

## D-05 · El alcance de la v1 es entrenamiento + check diario

El documento original pedía 18 dominios. Construir los 18 a la vez da 18 cosas mediocres,
que es exactamente la app genérica que el documento dice no querer.

Se construyó la columna vertebral: **el check diario decide el entrenamiento, y el
entrenamiento alimenta el próximo check.** Eso ya es un ecosistema que se retroalimenta,
que era el requisito real. El resto (agua, proteína, caminata, pantallas, movilidad)
entra como hábitos de un toque, sin pantalla propia, y queda registrado para cuando haya
datos suficientes para que el motor los use.

**Lo que falta y por qué:** running y cardio estructurado necesitan GPS o un sensor;
sueño y alimentación en serio necesitan una fuente de datos que hoy no existe. Meterlos
como formularios a mano habría producido campos que nadie completa después de la semana
dos. Están en [`ROADMAP.md`](ROADMAP.md) con su condición de entrada.

---

## D-06 · Ningún mensaje sin un dato adentro

Regla de escritura del producto: si un mensaje no contiene un número tuyo o una acción
concreta, no se muestra. Nada de "¡vos podés!". `scripts/verificar.mjs` lo comprueba
automáticamente sobre todos los módulos de interfaz.

El chequeo tiene una exclusión escrita: `js/ia/` nombra esas frases para prohibírselas
al modelo en el prompt de sistema. Es instrucción para la IA, no texto que ve el usuario.

---

## D-07 · La IA nunca está en el camino crítico

La app decide, programa, progresa y detecta recaídas **sin conexión y sin clave**. La IA
solo reescribe con más contexto una explicación que ya está en pantalla, y contesta
preguntas. Si falla, se reintenta o no pasa nada.

Corolario de implementación: la llamada tiene timeout de 20 s. Un `fetch` sin timeout en
un celular con una barra de señal se cuelga para siempre y parece que la app se trabó.

---

## D-08 · Dirección visual: grafito y brasa

Se consultó la base de datos de `ui-ux-pro-max`, que devolvió una paleta cyan clara con
tipografía serif — está afinada para landings de wellness. Se descartó la paleta y se
conservó lo aplicable: minimalismo con tipografía grande, densidad espaciosa, motion de
300-400 ms y el checklist de accesibilidad.

Se ofrecieron dos direcciones oscuras y se eligió **grafito y brasa**: casi negro, un
solo acento ámbar que aparece únicamente donde hay una decisión del usuario. La jerarquía
la hace el tamaño y el espacio, no las cajas: no hay tarjetas, ni sombras, ni degradados.

**No se cargan fuentes remotas.** Una fuente de Google es una petición de red que falla
justo el día que estás en el gimnasio sin señal, y deja todo el ritmo vertical roto. Se
usa la pila del sistema, y el arnés verifica que no entre ningún recurso remoto al HTML.
