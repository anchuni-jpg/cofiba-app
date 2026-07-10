import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cofiba.es itself has no "productos comprados anteriormente" page we could
// find (checked the public site + its b2b.js bundle for any such route), so
// this is tracked entirely on our side instead of scraped: every successful
// add-to-cart teaches us which categoria an articulo lives in, and every
// successful finalizarPedido snapshots the cart into per-user purchase
// history. Keyed by cofiba.es username (not the app's session token, which
// is re-minted on every login) so it survives logout/login cycles.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'historial.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store));
}

function entryFor(store, usuario) {
  if (!store[usuario]) store[usuario] = { categorias: {}, compras: {} };
  return store[usuario];
}

export function registrarCategoria(usuario, articulo, categoria) {
  if (!usuario || !articulo || !categoria) return;
  const store = readStore();
  const entry = entryFor(store, usuario);
  entry.categorias[articulo] = categoria;
  writeStore(store);
}

// `lineas` are cart rows as returned by getCarrito: {codigo, descripcion, cantidad, ...}
export function registrarCompra(usuario, lineas) {
  if (!usuario || !lineas?.length) return;
  const store = readStore();
  const entry = entryFor(store, usuario);
  const fecha = new Date().toISOString();
  for (const l of lineas) {
    entry.compras[l.codigo] = { descripcion: l.descripcion, cantidad: l.cantidad, fecha };
  }
  writeStore(store);
}

export function obtenerHistorico(usuario) {
  const store = readStore();
  const entry = store[usuario];
  if (!entry) return [];
  return Object.entries(entry.compras)
    .map(([articulo, compra]) => ({
      articulo,
      categoria: entry.categorias[articulo] || null,
      descripcion: compra.descripcion,
      cantidad: compra.cantidad,
      fecha: compra.fecha,
    }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
