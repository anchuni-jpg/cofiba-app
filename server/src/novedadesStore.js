import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cofiba.es no avisa en ningún sitio de qué artículos son nuevos — esto se
// deduce solo comparando, cada vez que el índice del catálogo completo
// termina un recorrido (indiceStore.js), qué códigos de artículo no se
// habían visto nunca antes. Se guarda cuándo se vio cada uno por primera
// vez; la pantalla de Estadísticas enseña los de los últimos 3 días y aquí
// se olvidan del todo pasada una semana (ya no sirven ni para eso).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'novedades.json');
// Misma foto fija del catálogo que usa indiceStore.js como semilla — ver
// abajo por qué.
const SEED_FILE = path.join(__dirname, '..', 'catalog-seed', 'indice-busqueda.json');

const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

let primeraVezPorArticulo = new Map(); // articulo -> timestamp de cuándo se vio por primera vez
let articulosConocidos = new Set(); // todos los articulo vistos alguna vez, para detectar cuáles son nuevos
// Si al arrancar no había nada guardado, el primer recorrido completo no
// cuenta como "novedades" (si no, el catálogo entero saldría como nuevo el
// primer día) — solo sirve para fijar la base de partida.
let primerRecorridoHecho = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarDeDisco() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    primeraVezPorArticulo = new Map(Object.entries(raw.primeraVez || {}));
    articulosConocidos = new Set(raw.conocidos || []);
    primerRecorridoHecho = articulosConocidos.size > 0;
    if (primerRecorridoHecho) return;
  } catch {
    // Sigue abajo e intenta la semilla en vez de rendirse.
  }
  // Arranque limpio (plan gratuito de Render: .data/ se borra en cada
  // despliegue). Sin esto, el primer rastreo del catálogo tras CADA
  // despliegue se trataba como "el primero de siempre" — no detectaba nada
  // nuevo, solo fijaba la base de partida — así que hacían falta DOS
  // rastreos completos (varios minutos/horas cada uno) sin ningún
  // despliegue de por medio antes de que apareciera cualquier novedad real.
  // Usando la misma foto fija del catálogo que ya usa indiceStore.js como
  // semilla (se actualiza a mano de vez en cuando, ver ese archivo), el
  // PRIMER rastreo tras el despliegue ya tiene con qué comparar: cualquier
  // artículo que no estuviera en esa foto es una novedad real desde
  // entonces, sin esperar a un segundo rastreo.
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    const productos = Array.isArray(seed.indice) ? seed.indice : [];
    if (productos.length) {
      articulosConocidos = new Set(productos.map((p) => p.articulo));
      primerRecorridoHecho = true;
    }
  } catch {
    // Sin semilla legible tampoco: arranca vacío del todo, como antes.
  }
}
cargarDeDisco();

function guardarEnDisco() {
  try {
    ensureDataDir();
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({
        primeraVez: Object.fromEntries(primeraVezPorArticulo),
        conocidos: [...articulosConocidos],
      })
    );
  } catch (e) {
    console.error('[novedadesStore] fallo guardando:', e.message);
  }
}

// Se llama con la lista completa de productos cada vez que indiceStore.js
// termina un recorrido entero del catálogo.
export function actualizarDesdeIndice(productos) {
  const ahora = Date.now();

  if (!primerRecorridoHecho) {
    for (const p of productos) articulosConocidos.add(p.articulo);
    primerRecorridoHecho = true;
    guardarEnDisco();
    return;
  }

  let cambios = false;
  for (const p of productos) {
    if (!articulosConocidos.has(p.articulo)) {
      articulosConocidos.add(p.articulo);
      primeraVezPorArticulo.set(p.articulo, ahora);
      cambios = true;
    }
  }
  // Poda: pasada una semana ya no hace falta seguir recordando cuándo se
  // vio por primera vez (deja de contar como novedad de todas formas).
  for (const [articulo, ts] of primeraVezPorArticulo) {
    if (ahora - ts > SIETE_DIAS_MS) {
      primeraVezPorArticulo.delete(articulo);
      cambios = true;
    }
  }
  if (cambios) guardarEnDisco();
}

// Códigos de artículo marcados como nuevos en los últimos 3 días, más
// recientes primero — quien llama enriquece con nombre/precio/foto desde el
// índice del catálogo.
export function articulosNuevos() {
  const ahora = Date.now();
  const resultado = [];
  for (const [articulo, desde] of primeraVezPorArticulo) {
    if (ahora - desde <= TRES_DIAS_MS) resultado.push({ articulo, desde });
  }
  resultado.sort((a, b) => b.desde - a.desde);
  return resultado;
}
