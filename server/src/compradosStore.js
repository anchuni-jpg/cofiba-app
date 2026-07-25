import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProductos, CONSUMO_URL } from './cofibaClient.js';
import { esperarInactividad } from './indiceStore.js';
import { encolarConsumo } from './consumoQueue.js';

// Junta en memoria, por usuario, los códigos de artículo vistos en
// /consumo.html (el histórico real de la cuenta en cofiba.es). Con eso el
// catálogo (Productos/Búsqueda) marca al momento qué productos ya se
// compraron antes, sin que el cliente tenga que entrar en Histórico, y
// Estadísticas puede calcular "más comprados" sin pedir nada aparte.
//
// El set se alimenta de dos sitios:
//  1. Cada página de /consumo.html que YA se pidió por cualquier motivo (la
//     pestaña Histórico) — gratis, y hace que las marcas aparezcan en cuanto
//     hay datos, aunque sean parciales.
//  2. Un recorrido completo en segundo plano de todas las páginas — pero SOLO
//     se dispara cuando el cliente busca algo, entra en Histórico o mira
//     Estadísticas (petición expresa del usuario: navegar por el catálogo no
//     debe arrancar rastreos de fondo, que en el servidor gratuito compiten
//     por la única CPU).
//
// Recorrer las ~32 páginas reales tarda varios minutos (cada una es igual de
// lenta que la propia pestaña Histórico — ver getComprasRecientes) así que
// nunca bloquea una petición: mientras corre, el catálogo se sirve con las
// marcas parciales que ya haya. Se guarda en disco a medida que avanza (no
// solo al terminar) para que, si el servidor gratuito se reinicia a medias
// (duerme por inactividad, o un despliegue), el próximo recorrido continúe
// con lo ya sabido en vez de tener que empezar de cero.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'comprados.json');
const GUARDADO_MIN_MS = 5000; // no escribir en disco más de una vez cada 5s

const TTL_MS = 20 * 60 * 1000;
const datos = new Map(); // usuario -> { conteo, completo, actualizado }
const enCurso = new Map(); // usuario -> Promise

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargarDeDisco() {
  try {
    const plano = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    for (const [usuario, d] of Object.entries(plano)) {
      datos.set(usuario, {
        conteo: new Map(Object.entries(d.conteo || {})),
        completo: !!d.completo,
        actualizado: d.actualizado || null,
      });
    }
  } catch {
    // Arranque limpio (o sin .data persistente tras un despliegue en el
    // plan gratuito) — no pasa nada, se reconstruye solo.
  }
}
cargarDeDisco();

let ultimoGuardado = 0;
function guardarEnDisco(forzar = false) {
  const ahora = Date.now();
  if (!forzar && ahora - ultimoGuardado < GUARDADO_MIN_MS) return;
  ultimoGuardado = ahora;
  try {
    ensureDataDir();
    const plano = {};
    for (const [usuario, d] of datos.entries()) {
      plano[usuario] = { conteo: Object.fromEntries(d.conteo), completo: d.completo, actualizado: d.actualizado };
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(plano));
  } catch (e) {
    console.error('[compradosStore] fallo guardando en disco:', e.message);
  }
}

function entrada(usuario) {
  let d = datos.get(usuario);
  if (!d) {
    // `conteo` cuenta cuántas veces se ha visto cada artículo en
    // /consumo.html (una vez por línea de compra real) — no es solo un Set
    // de "comprado sí/no": la frecuencia es lo que permite luego calcular
    // "los más vendidos" en /api/estadisticas. Sigue teniendo `.has()`
    // (Map la trae de serie), así que marcarComprados() en index.js no
    // necesita cambiar nada.
    d = { conteo: new Map(), completo: false, actualizado: null };
    datos.set(usuario, d);
  }
  return d;
}

// Alimenta el conteo con productos de una página de /consumo.html ya pedida
// por otro motivo (p. ej. la pestaña Histórico) — así no se desperdicia
// ninguna petición ya hecha y las marcas aparecen sin esperar al recorrido
// completo. Guarda en disco (con límite de una vez cada 5s) para no perder
// este avance si el servidor se reinicia a medias.
export function registrarCompras(usuario, productos) {
  const d = entrada(usuario);
  productos.forEach((p) => d.conteo.set(p.articulo, (d.conteo.get(p.articulo) || 0) + 1));
  guardarEnDisco();
}

// El conteo de artículos comprados si ya se sabe algo (aunque sea parcial), o
// null si aún no hay ni un dato — nunca bloquea. Se sigue llamando "set" en
// los sitios que solo miran pertenencia (marcarComprados) porque Map también
// tiene `.has()`.
export function comprasConocidas(usuario) {
  const d = datos.get(usuario);
  return d && d.conteo.size ? d.conteo : null;
}

// Datos crudos para /api/estadisticas: la frecuencia de cada artículo (para
// "más vendidos") y si el recorrido ya es completo (para avisar si las
// cifras todavía son parciales). El enriquecido con nombre/categoría/precio
// se hace en index.js con el índice del catálogo, no aquí — este módulo solo
// sabe de códigos de artículo, no de sus datos.
export function estadisticasCompras(usuario) {
  const d = datos.get(usuario);
  if (!d || d.conteo.size === 0) return null;
  return { conteo: d.conteo, completo: d.completo, actualizado: d.actualizado };
}

// Para el panel de escritorio (/api/admin/estado): suma el conteo de TODAS
// las cuentas que usan la app en uno solo (para "más vendidos" a nivel
// global, no solo de una cuenta) y da un resumen por cuenta.
export function resumenGlobal() {
  const conteoGlobal = new Map();
  const porUsuario = [];
  for (const [usuario, d] of datos.entries()) {
    porUsuario.push({ usuario, articulosDistintos: d.conteo.size, completo: d.completo, actualizado: d.actualizado });
    for (const [articulo, veces] of d.conteo.entries()) {
      conteoGlobal.set(articulo, (conteoGlobal.get(articulo) || 0) + veces);
    }
  }
  return { conteoGlobal, porUsuario };
}

// Dispara el recorrido completo en segundo plano si hace falta. "Fire and
// forget" a propósito: la petición actual se sirve con lo que haya y las
// próximas irán teniendo más marcas según avanza. Si ya había un recorrido a
// medias guardado en disco (de antes de un reinicio), esto NO empieza de la
// primera página del histórico real — sigue sirviendo con lo ya conocido y
// solo completa lo que falte la próxima vez que de verdad haga falta
// refrescar (han pasado TTL_MS desde la última vez completa).
export function asegurarComprados(usuario, session) {
  if (enCurso.has(usuario)) return;
  const d = entrada(usuario);
  if (d.completo && d.actualizado && Date.now() - d.actualizado < TTL_MS) return;
  const promesa = (async () => {
    let pageUrl = null;
    do {
      // Antes de cada página, esperar a que el cliente no esté usando la app
      // — /consumo.html es lentísima y cofiba.es serializa las peticiones de
      // una misma cuenta, así que lanzarla mientras alguien navega le mete
      // 15-35s de espera. Este rastreo es de baja prioridad: puede esperar a
      // los ratos muertos, pero corre tan rápido como cofiba.es lo permita
      // en cuanto hay hueco.
      await esperarInactividad();
      const res = await encolarConsumo(usuario, () => getProductos(session, { pageUrl: pageUrl || CONSUMO_URL }));
      registrarCompras(usuario, res.productos);
      pageUrl = res.siguientePagina;
    } while (pageUrl);
    d.completo = true;
    d.actualizado = Date.now();
    guardarEnDisco(true);
  })()
    .catch((e) => {
      console.error('[compradosStore] fallo recorriendo el histórico de compras:', e.message);
      guardarEnDisco(true); // conserva lo avanzado hasta el fallo, no se tira
    })
    .finally(() => {
      enCurso.delete(usuario);
    });
  enCurso.set(usuario, promesa);
}
