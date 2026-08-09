/**
 * generar-iconos.mjs — produce los PNG del manifest sin dependencias.
 *
 * Android no instala una PWA con iconos solo en SVG, así que hacen falta PNG.
 * En vez de sumar `sharp` (y con él un binario nativo de 30 MB por un icono que
 * cambia una vez al año), se rasteriza a mano y se codifica el PNG con `zlib`,
 * que ya viene en Node.
 *
 * La marca es una aguja de brújula apuntando al norte: mitad brasa hacia arriba,
 * mitad grafito hacia abajo.
 *
 * Uso: node scripts/generar-iconos.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONDO = [0x0a, 0x0a, 0x0b];
const BRASA = [0xe8, 0x83, 0x3a];
const GRIS = [0x55, 0x55, 0x5e];

function crc32(buf) {
  let c;
  const tabla = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(ancho, alto, pixeles) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;    // 8 bits por canal
  ihdr[9] = 2;    // color RGB
  const filas = [];
  for (let y = 0; y < alto; y++) {
    filas.push(Buffer.from([0])); // filtro 0 = ninguno
    filas.push(pixeles.subarray(y * ancho * 3, (y + 1) * ancho * 3));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {number} n     lado en píxeles
 * @param {number} margen  fracción de margen — maskable necesita más
 */
function dibujar(n, margen = 0.18) {
  const px = Buffer.alloc(n * n * 3);
  const poner = (x, y, c) => {
    const i = (y * n + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) poner(x, y, FONDO);

  const cx = n / 2;
  const arriba = n * margen;
  const abajo = n * (1 - margen);
  const cy = n / 2;
  const medioAncho = n * (0.5 - margen) * 0.52;

  // Muestreo 3×3 por píxel para que los bordes diagonales no queden dentados.
  const dentro = (px_, py, ax, ay, bx, by, cx_, cy_) => {
    const s = (bx - ax) * (py - ay) - (by - ay) * (px_ - ax);
    const t = (cx_ - bx) * (py - by) - (cy_ - by) * (px_ - bx);
    const u = (ax - cx_) * (py - cy_) - (ay - cy_) * (px_ - cx_);
    return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
  };

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sumaBrasa = 0; let sumaGris = 0; let total = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const fx = x + (sx + 0.5) / 3;
          const fy = y + (sy + 0.5) / 3;
          total++;
          if (dentro(fx, fy, cx, arriba, cx - medioAncho, cy, cx + medioAncho, cy)) sumaBrasa++;
          else if (dentro(fx, fy, cx, abajo, cx - medioAncho, cy, cx + medioAncho, cy)) sumaGris++;
        }
      }
      if (!sumaBrasa && !sumaGris) continue;
      const mezcla = (color, peso) => color.map((c, i) => Math.round(FONDO[i] + (c - FONDO[i]) * peso));
      if (sumaBrasa >= sumaGris) poner(x, y, mezcla(BRASA, sumaBrasa / total));
      else poner(x, y, mezcla(GRIS, sumaGris / total));
    }
  }
  return png(n, n, px);
}

mkdirSync(resolve(RAIZ, 'iconos'), { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0A0A0B"/>
  <path d="M50 18 L67 50 L33 50 Z" fill="#E8833A"/>
  <path d="M50 82 L33 50 L67 50 Z" fill="#55555E"/>
</svg>
`;
writeFileSync(resolve(RAIZ, 'iconos/icono.svg'), svg);

for (const [nombre, lado, margen] of [
  ['icono-192.png', 192, 0.18],
  ['icono-512.png', 512, 0.18],
  ['icono-180.png', 180, 0.18],
  ['icono-maskable.png', 512, 0.30], // el recorte de Android come hasta el 20% del borde
]) {
  writeFileSync(resolve(RAIZ, 'iconos', nombre), dibujar(lado, margen));
  console.log(`  iconos/${nombre}`);
}
console.log('  iconos/icono.svg');
