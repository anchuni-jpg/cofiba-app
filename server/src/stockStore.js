import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cofiba.es no avisa de cambios de stock en ningún sitio — esto se deduce
// comparando, cada vez que el índice del catálogo completo termina un
// recorrido (indiceStore.js), el stock de ahora contra el de la última vez.
// No se guarda CUALQUIER variación (el stock cambia un poco constantemente
// según entran pedidos, sería puro ruido) — solo lo que de verdad importa
// para llevar control:
//   - se agotó (pasó a 0)
//   - se repuso (estaba a 0 y ya no)
//   - cruzó el umbral de "10 cajas" que ya usa STOCK/STOCK BAJO en la app
//   - bajó al menos un 50% de golpe, aunque siga por encima de 10 cajas
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'stock-cambios.json');
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const LIMITE = 500;

let snapshot = new Map(); // articulo -> { stock, undVenta } del último recorrido
let cambios = []; // { articulo, stockAntes, stockDespues, fecha }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarDeDisco() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    snapshot = new Map(Object.entries(raw.snapshot || {}));
    cambios = Array.isArray(raw.cambios) ? raw.cambios : [];
  } catch {
    // Arranque limpio (o sin .data persistente tras un despliegue) — no
    // pasa nada, se reconstruye solo con el próximo par de recorridos.
  }
}
cargarDeDisco();

function guardarEnDisco() {
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify({ snapshot: Object.fromEntries(snapshot), cambios }));
  } catch (e) {
    console.error('[stockStore] fallo guardando:', e.message);
  }
}

function unidadesPorCaja(undVenta) {
  return parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
}

// Se llama con la lista completa de productos cada vez que indiceStore.js
// termina un recorrido entero del catálogo.
export function actualizarDesdeIndice(productos) {
  const ahora = Date.now();
  const huboSnapshotPrevio = snapshot.size > 0;
  const nuevosCambios = [];

  for (const p of productos) {
    if (!Number.isFinite(p.stock)) continue;
    const anterior = snapshot.get(p.articulo);

    if (huboSnapshotPrevio && anterior && anterior.stock !== p.stock) {
      const cajasAntes = anterior.stock / unidadesPorCaja(anterior.undVenta);
      const cajasDespues = p.stock / unidadesPorCaja(p.undVenta);
      const seAgoto = anterior.stock > 0 && p.stock === 0;
      const seRepuso = anterior.stock === 0 && p.stock > 0;
      const cruzoUmbral = (cajasAntes >= 10) !== (cajasDespues >= 10);
      const bajadaFuerte = p.stock < anterior.stock && anterior.stock > 0 && (anterior.stock - p.stock) / anterior.stock >= 0.5;

      if (seAgoto || seRepuso || cruzoUmbral || bajadaFuerte) {
        nuevosCambios.push({ articulo: p.articulo, stockAntes: anterior.stock, stockDespues: p.stock, fecha: ahora });
      }
    }

    snapshot.set(p.articulo, { stock: p.stock, undVenta: p.undVenta });
  }

  if (nuevosCambios.length) {
    cambios = [...nuevosCambios, ...cambios].filter((c) => ahora - c.fecha <= SIETE_DIAS_MS).slice(0, LIMITE);
  }
  guardarEnDisco();
}

// Más recientes primero — quien llama enriquece con nombre/categoría/foto
// desde el índice del catálogo.
export function cambiosRecientes() {
  return cambios;
}
