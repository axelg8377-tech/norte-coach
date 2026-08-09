# Propuestas de evolución

Generadas sin que se pidan, como pide el documento fundacional. Cada una lleva impacto,
complejidad, prioridad, valor y riesgo — y, lo que más importa, **la condición de entrada**:
qué tiene que ser verdad para que valga la pena construirla. Sin esa condición, una lista
de ideas es una lista de deseos.

**Prioridad** = impacto sobre adherencia ÷ complejidad, ajustado por riesgo. No es un
promedio: una función de impacto medio y riesgo alto pierde contra una de impacto medio
y riesgo nulo.

---

## Ronda 1 — lo que el producto ya está pidiendo

### P-01 · Entrada en calor específica de la sesión
El motor reserva 4-8 minutos de entrada en calor y **no dice qué hacer en ellos**. Es el
hueco más visible del producto hoy.
Se resuelve con lo que ya existe: los 61 ejercicios de movilidad del catálogo, filtrados
por los patrones de la sesión del día.

| | |
|---|---|
| Impacto | **Alto** — es el primer momento de la sesión, y el que más gente saltea |
| Complejidad | Baja — una función en `motor.js`, sin datos nuevos |
| Prioridad | **1** |
| Valor | Reduce lesiones y quita una decisión de encima |
| Riesgo | Ninguno |
| Condición | Ninguna. Es lo próximo. |

### P-02 · Temporizador de descanso entre series
Hoy el descanso queda a criterio, y el descanso es una variable de programación tan real
como la carga: 90 segundos y 3 minutos entrenan cosas distintas.

| | |
|---|---|
| Impacto | Alto sobre la calidad del estímulo |
| Complejidad | Baja, con una trampa: `setTimeout` no corre con la pantalla apagada. Hay que usar marcas de tiempo absolutas y recalcular al volver |
| Prioridad | **2** |
| Riesgo | Bajo. Si se implementa con `setTimeout` a secas, miente, y un temporizador que miente es peor que ninguno |

### P-03 · Que la percepción de esfuerzo alimente al motor
Ya se pregunta al cerrar cada sesión y **hoy solo se guarda**. Con esfuerzo alto repetido
frente a disposición alta, el motor debería bajar volumen antes de que aparezca el
estancamiento.

| | |
|---|---|
| Impacto | Alto — es autorregulación real, no reactiva |
| Complejidad | Baja: el dato ya está en el log desde el día uno |
| Prioridad | **3** |
| Riesgo | Bajo. Necesita ~15 sesiones antes de que la señal signifique algo |

### P-04 · Sustituir un ejercicio durante la sesión
"La máquina está ocupada" es la causa número uno de sesión abandonada en un gimnasio
lleno. `candidatos()` ya devuelve la lista ordenada; falta el botón.

| | |
|---|---|
| Impacto | Medio-alto sobre adherencia en gimnasio |
| Complejidad | Muy baja |
| Prioridad | **4** |
| Riesgo | Ninguno |

---

## Ronda 2 — necesitan datos que todavía no existen

### P-05 · Sueño real desde Health Connect / Apple Health
Hoy el sueño se autoreporta en una escala de 1 a 5, y es el factor con más peso en la
disposición. Un dato medido lo mejoraría mucho.

| | |
|---|---|
| Impacto | Alto |
| Complejidad | **Alta** — el acceso a esas APIs desde una PWA es limitado o inexistente; probablemente exija empaquetar con Capacitor o TWA |
| Prioridad | 7 |
| Riesgo | Alto: arrastra la app fuera de "PWA sin build", que es lo que la hace barata de mantener |
| Condición | Que Axel use un reloj o pulsera a diario durante al menos un mes. Sin eso no hay dato que leer |

### P-06 · Running con GPS
Está en la lista de dominios del pedido original y hoy no existe.

| | |
|---|---|
| Impacto | Medio — depende enteramente de si se corre o no |
| Complejidad | Alta: `watchPosition`, filtrado de la deriva del GPS, pantalla encendida, batería |
| Prioridad | 8 |
| Riesgo | Medio. Es un producto adentro del producto y hay diez apps gratis que lo hacen mejor |
| Condición | Que corras tres veces por semana durante un mes registrándolo a mano. Si eso no pasa, la función no se usaría |

### P-07 · Comida y proteína en serio
Hoy es un hábito de sí/no. Contar macros de verdad exige una base de alimentos y un
registro que casi nadie sostiene más de tres semanas.

| | |
|---|---|
| Impacto | Alto sobre el resultado, **bajo sobre la adherencia** |
| Complejidad | Muy alta |
| Prioridad | 10 |
| Riesgo | **Alto** — es la función que más veces mata apps de fitness por abandono |
| Condición | No construir hasta que el hábito de sí/no lleve 8 semanas al 80%. Si no se sostiene lo fácil, lo difícil no se va a sostener |

---

## Ronda 3 — el sistema aprendiendo mejor

### P-08 · Contexto del bandit con día de la semana
`adherencia.js` ya detecta que fallás sistemáticamente ciertos días. El bandit todavía no
usa esa información: hoy el contexto es solo `normal` / `dificil`.

| | |
|---|---|
| Impacto | Medio |
| Complejidad | Baja de código, **alta de estadística**: más contextos = menos datos por contexto |
| Prioridad | 6 |
| Riesgo | **Medio, y es el riesgo interesante.** Partir en 7 días deja ~20 observaciones por celda al año. El bandit dejaría de aprender y empezaría a alucinar |
| Condición | Al menos 100 sesiones registradas. Y aun así, agrupar en "día bueno / día malo" según lo que ya detectó `adherencia.js`, no en los 7 días |

### P-09 · Predicción de la sesión de mañana
Con suficientes checks, estimar la disposición de mañana y avisar hoy: "mañana venís
para abajo, adelantá la sesión pesada".

| | |
|---|---|
| Impacto | Alto si acierta, **negativo si falla** |
| Complejidad | Media |
| Prioridad | 9 |
| Riesgo | **Alto.** Una predicción equivocada destruye la confianza más rápido de lo que una acertada la construye |
| Condición | Que un modelo simple sobre el historial real supere al de "mañana igual que hoy" en validación. Si no le gana a esa línea de base, no se construye |

### P-10 · Comparar la explicación de la IA contra la del motor
Hoy la IA amplía la explicación y nadie verifica que no contradiga al motor. Un coach que
dice lo contrario de lo que hace la app es peor que no tener coach.

| | |
|---|---|
| Impacto | Medio, pero es **integridad**, no una función |
| Complejidad | Baja: chequear que los números citados existan en el plan |
| Prioridad | **5** |
| Riesgo | Ninguno. Reduce riesgo |

---

## Descartado con motivo

**Compartir en redes.** Ni una línea. El pedido era construir identidad y consistencia;
la validación externa es la motivación más frágil que existe y erosiona exactamente lo que
el producto trata de construir. *Se reabre:* nunca, salvo que Axel lo pida explícitamente
sabiendo esto.

**Rachas diarias estrictas.** Una racha que se rompe por descansar castiga justo lo que hay
que fomentar. La implementada tolera los días de descanso previstos.

**Gamificación con niveles y medallas.** La motivación extrínseca desplaza a la intrínseca
en tareas que la persona ya eligió hacer. Acá la eligió. *Se reabre:* si la adherencia cae
por debajo del 40% durante ocho semanas y las cuatro señales de `adherencia.js` no lo
explican.

**Editor de rutinas a mano.** Si se puede armar la sesión a mano, el motor deja de tener
sentido y el producto vuelve a ser una planilla con animaciones.
