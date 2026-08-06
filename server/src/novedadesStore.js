import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cofiba.es no avisa en ningún sitio de qué artículos son nuevos — esto se
// deduce solo comparando, cada vez que el índice del catálogo completo
// termina un recorrido (indiceStore.js), qué códigos de artículo no se
// habían visto nunca antes. Se guarda cuándo se vio cada uno por primera
// vez; la pantalla de Estadísticas enseña los de los últimos 15 días y aquí
// se olvidan del todo pasado ese plazo (ya no sirven ni para eso).
//
// Vive en el SERVIDOR (no en el dispositivo del cliente) para que cualquier
// cuenta que entre vea las mismas novedades reales desde el primer momento,
// sin depender de que ESE dispositivo concreto ya hubiera visitado antes
// para tener algo con qué comparar — ese era el problema del enfoque
// anterior (ver api.js#novedadesCached en el cliente, que ahora solo cachea
// la respuesta del servidor, no la calcula).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'novedades.json');

const QUINCE_DIAS_MS = 15 * 24 * 60 * 60 * 1000;

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
  } catch {
    // Arranque limpio (o sin .data persistente, como en el plan gratuito de
    // Render tras un despliegue) — no pasa nada, se reconstruye solo.
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
  // Poda: pasado el plazo de 15 días ya no hace falta seguir recordando
  // cuándo se vio por primera vez (deja de contar como novedad de todas
  // formas).
  for (const [articulo, ts] of primeraVezPorArticulo) {
    if (ahora - ts > QUINCE_DIAS_MS) {
      primeraVezPorArticulo.delete(articulo);
      cambios = true;
    }
  }
  if (cambios) guardarEnDisco();
}

// Códigos de artículo marcados como nuevos en los últimos 15 días, más
// recientes primero — quien llama enriquece con nombre/precio/foto desde el
// índice del catálogo.
export function articulosNuevos() {
  const ahora = Date.now();
  const resultado = [];
  for (const [articulo, desde] of primeraVezPorArticulo) {
    if (ahora - desde <= QUINCE_DIAS_MS) resultado.push({ articulo, desde });
  }
  resultado.sort((a, b) => b.desde - a.desde);
  return resultado;
}
