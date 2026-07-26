import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// cofiba.es a veces sigue enseñando un artículo en sus páginas de
// categoría/búsqueda (con precio y hasta un stock aparente) mucho después de
// haberlo dado de baja de verdad — confirmado en vivo: cestacarrito.php
// responde 200 sin error y el carrito, mirado después, simplemente no lo
// trae (ver anadirAlCarrito en cofibaClient.js, código ARTICULO_NO_DISPONIBLE).
// No hay forma honesta de comprobar "ya ha vuelto" sin intentar añadirlo de
// verdad al carrito de alguien — así que en vez de fingir esa certeza, se
// oculta el artículo de los listados una temporada prudencial y, pasado ese
// plazo, se le vuelve a dar el beneficio de la duda solo; si de verdad sigue
// de baja, el próximo intento de compra lo volverá a marcar sin más.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'no-disponibles.json');
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

let noDisponibles = new Map(); // articulo -> { desde: timestamp }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarDeDisco() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    noDisponibles = new Map(Object.entries(raw || {}));
  } catch {
    // Arranque limpio (o sin .data persistente tras un despliegue) — no pasa
    // nada, se vuelve a marcar solo si de verdad se intenta comprar algo que
    // ya no existe.
  }
}
cargarDeDisco();

function guardarEnDisco() {
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(Object.fromEntries(noDisponibles)));
  } catch (e) {
    console.error('[noDisponibleStore] fallo guardando:', e.message);
  }
}

export function marcarNoDisponible(articulo) {
  noDisponibles.set(articulo, { desde: Date.now() });
  guardarEnDisco();
}

// Se autoexpira sola en vez de necesitar que algo la limpie activamente —
// pasados los 7 días vuelve a tratarse como disponible sin más trámite.
export function estaNoDisponible(articulo) {
  const registro = noDisponibles.get(articulo);
  if (!registro) return false;
  if (Date.now() - registro.desde >= SIETE_DIAS_MS) {
    noDisponibles.delete(articulo);
    guardarEnDisco();
    return false;
  }
  return true;
}

export function filtrarDisponibles(productos) {
  if (!noDisponibles.size) return productos;
  return productos.filter((p) => !estaNoDisponible(p.articulo));
}
