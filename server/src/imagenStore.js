import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// cofiba.es's own /mi-compra.html has no product photos in its HTML at all
// (confirmed: the only <img src="BlobData/..."> on that page are the site's
// header logo and footer banner — not per-line product images). So the
// cart's photos are remembered from whenever the product was last seen in
// the catalog instead of scraped from the cart page. Global (not per-user):
// an articulo's image is the same for every client browsing the same
// catalog, so there's no reason to duplicate it per cofiba.es username the
// way historialStore does for purchase history.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'imagenes.json');

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

export function registrarImagenes(productos) {
  if (!productos?.length) return;
  const store = readStore();
  let cambiado = false;
  for (const p of productos) {
    if (p.articulo && p.imagen && store[p.articulo] !== p.imagen) {
      store[p.articulo] = p.imagen;
      cambiado = true;
    }
  }
  if (cambiado) writeStore(store);
}

export function obtenerImagen(articulo) {
  const store = readStore();
  return store[articulo] || null;
}
