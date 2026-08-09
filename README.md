# Norte

Entrenador personal que decide tu sesión según cómo llegaste hoy, y te dice por qué.
PWA sin build, sin backend y sin cuenta. Funciona sin internet.

**App:** https://axelg8377-tech.github.io/norte-coach/

---

## Qué es, en una frase

No es una app de rutinas. Cada día hace cuatro preguntas de veinte segundos y de ahí sale
la sesión: si dormiste mal baja el volumen sin tocar la intensidad, si te duele el hombro
los empujes directamente no aparecen, si tenés veinte minutos recorta los accesorios y deja
los compuestos.

Y siempre muestra el razonamiento, porque una decisión que no se puede discutir no es
coaching, es obediencia.

## Cómo está armado

```
index.html          shell
css/tokens.css      grafito y brasa · 3 colores + neutros
css/app.css
js/
  app.js            arranque y ruteo por hash
  db.js             IndexedDB: log append-only + kv descartable
  estado.js         proyecciones sobre el log, y las acciones que lo escriben
  dominio/          ── sin DOM, sin red, sin IndexedDB ──
    modelo.js       vocabulario: patrones, zonas de dolor, disposición
    motor.js        la política: observación → sesión. Función pura
    progresion.js   doble progresión con autorregulación por RIR
    bandit.js       Thompson sampling sobre estrategias de adherencia
    adherencia.js   detección de recaída con cuatro señales
    catalogo.js     acceso al dataset curado
    mensajes.js     redacción de cada estrategia
  ia/cliente.js     Gemini BYOK. Estrictamente opcional
  ui/               una pantalla por archivo
data/               dataset curado (986 KB, precacheado)
scripts/
  curar-dataset.mjs   17 MB → 986 KB, con patrón de movimiento agregado
  generar-iconos.mjs  PNG del manifest sin dependencias
  verificar.mjs       59 comprobaciones. Correr antes de cada deploy
```

## Trabajar en esto

```bash
node scripts/verificar.mjs        # el arnés. Tiene que dar verde antes de subir nada
node scripts/curar-dataset.mjs    # rehacer el dataset desde la fuente
node scripts/generar-iconos.mjs   # rehacer los iconos
npx serve .                       # o cualquier servidor estático
```

**Al deployar hay que subir `CACHE` en `sw.js`.** Sin eso, el service worker sigue sirviendo
la versión vieja y se pierden horas creyendo que un arreglo no funcionó.

## Lo que no hace, a propósito

- **No sincroniza.** Los datos viven en este dispositivo. El respaldo es un JSON que se
  importa en otro y fusiona los dos historiales sin duplicar. Ver
  [`docs/DECISIONES.md`](docs/DECISIONES.md) D-03.
- **No deja armar rutinas a mano.** Si se puede, el motor deja de tener sentido.
- **No gamifica.** Sin niveles, sin medallas, sin confeti. La adherencia es el número.
- **No usa Gymnasium.** Es Python y no corre en un celular; y el RL necesita miles de
  episodios, que a un episodio por día son décadas. Lo que se conservó es su contrato.
  Ver [`docs/DECISIONES.md`](docs/DECISIONES.md) D-01.

## Créditos y licencia

Código: MIT.

Datos de ejercicios: [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset),
MIT para estructura e instrucciones. Las animaciones son © Gym visual, redistribuidas con
permiso y con atribución obligatoria, que la app muestra en el catálogo y en ajustes.

El nombre en español y el patrón de movimiento de cada ejercicio **no vienen del dataset**:
los agrega `scripts/curar-dataset.mjs`. El nombre original en inglés se conserva en cada
registro para poder auditar cualquier traducción.
