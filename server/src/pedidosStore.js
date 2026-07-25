import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Registro de cada pedido finalizado de verdad a través de la app (no el
// histórico completo de la cuenta en cofiba.es — eso es compradosStore.js).
// Esto es específicamente "lo que factura la app" para el panel de
// escritorio: solo pedidos que pasaron por /api/carrito/finalizar.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'pedidos.json');
const LIMITE = 2000; // de sobra para el panel; evita que el fichero crezca sin límite

let pedidos = []; // { usuario, fecha, total, numProductos }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarDeDisco() {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (Array.isArray(data)) pedidos = data;
  } catch {
    // Arranque limpio (o sin .data persistente tras un despliegue) — no
    // pasa nada, el registro empieza vacío y se va llenando solo.
  }
}
cargarDeDisco();

function guardarEnDisco() {
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(pedidos));
  } catch (e) {
    console.error('[pedidosStore] fallo guardando:', e.message);
  }
}

export function registrarPedido({ usuario, total, numProductos }) {
  pedidos.push({ usuario, fecha: Date.now(), total, numProductos });
  if (pedidos.length > LIMITE) pedidos = pedidos.slice(-LIMITE);
  guardarEnDisco();
}

// `desde` (timestamp) filtra a pedidos posteriores a esa fecha; sin él,
// devuelve todo lo registrado.
export function resumenFacturacion({ desde } = {}) {
  const lista = desde ? pedidos.filter((p) => p.fecha >= desde) : pedidos;
  const totalImporte = lista.reduce((acc, p) => acc + (Number.isFinite(p.total) ? p.total : 0), 0);
  return {
    totalPedidos: lista.length,
    totalImporte: Math.round(totalImporte * 100) / 100,
    pedidos: lista.slice(-200).reverse(), // los más recientes primero, acotado para no mandar miles de filas
  };
}
