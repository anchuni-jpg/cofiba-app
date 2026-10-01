import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProductos, CONSUMO_URL } from './cofibaClient.js';
import { completarComprados, registrarCompras, asegurarConocidos } from './compradosStore.js';

// Histórico completo de cada cuenta (/consumo.html de cofiba.es), recorrido
// en el servidor y servido entero al cliente en cada consulta.
//
//  - Arranca solo en cuanto la cuenta usa la app (cualquier pantalla) y NO
//    para hasta tener todas las páginas.
//  - Va con sesiones PROPIAS de cofiba.es (otros logins de la misma cuenta):
//    medido con uso real, cofiba.es atiende en fila las peticiones de cada
//    SESIÓN, no de cada cuenta — con la sesión de la navegación libre, las
//    categorías cargan en 3-5s aunque el histórico esté leyendo a la vez
//    (antes, en la misma sesión, se quedaban detrás de cada página de
//    ~28s).
//  - Lee varias páginas a la vez (LECTORES, cada uno con su sesión): cada
//    página de /consumo.html tarda ~28s en el servidor de cofiba.es, así que
//    en paralelo el histórico entero tarda una fracción. Cada página se
//    valida (número de página correcto y llena salvo la última) y se repite
//    si no — antes, pedir dos a la vez desde la MISMA sesión devolvía
//    páginas a medias.
//  - Recuerda por dónde iba (también en disco): un reinicio del servidor no
//    lo hace empezar de cero.
//  - Cada página tiene un tiempo máximo y reintentos: nunca se queda colgado.
//  - Lo que se ve como "comprado" navegando el catálogo se añade al momento
//    al histórico (registrarVistoEnCatalogo), aunque aún no se haya leído
//    su página.
const INTERES_MS = 15 * 1000; // consulta del Histórico hace menos de esto = pestaña abierta
const TIMEOUT_PAGINA_MS = 75 * 1000;
const REINTENTOS = 3;
const CADUCIDAD_MS = 60 * 60 * 1000; // histórico completo: se renueva pasada 1h
// Probado con 3 a la vez (sesiones distintas): cofiba.es devuelve la página 1
// vacía a todas — el cálculo de /consumo es por CUENTA y no admite lecturas
// simultáneas. Se queda en 1; lo que sí se gana es no bloquear la navegación.
const LECTORES = 1;
const GUARDADO_MIN_MS = 5000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'historico.json');

const estados = new Map(); // usuario -> estado

function nuevoEstado() {
  return {
    paginas: [], // paginas[i] = productos de la página real i+1
    totalPaginas: null,
    base: null, // URL base de paginación (base + número + "/")
    tamPagina: null, // productos por página (los de la página 1)
    hechas: [], // hechas[i] = página i+1 ya leída en esta vuelta
    pendiente: true, // hay una vuelta de lectura sin terminar
    completo: false,
    actualizado: null,
    vistos: {}, // articulo -> producto visto como "comprado" en el catálogo
    // No se guardan en disco:
    corriendo: false,
    ultimoInteres: 0,
    error: null,
    version: 0,
    sesiones: [],
    crearSesion: null,
  };
}

function cargarDeDisco() {
  try {
    const plano = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    for (const [usuario, d] of Object.entries(plano)) {
      if (!Array.isArray(d.hechas)) continue; // formato antiguo: se empieza de cero
      const st = { ...nuevoEstado(), ...d };
      estados.set(usuario, st);
      // Las marcas de "ya comprado" salen otra vez de aquí si el servidor
      // las había perdido.
      asegurarConocidos(usuario, productosHistorico(st));
    }
  } catch {
    // Sin fichero (primer arranque o disco efímero): se empieza de cero.
  }
}
cargarDeDisco();

let ultimoGuardado = 0;
function guardarEnDisco(forzar = false) {
  if (!forzar && Date.now() - ultimoGuardado < GUARDADO_MIN_MS) return;
  ultimoGuardado = Date.now();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const plano = {};
    for (const [usuario, st] of estados.entries()) {
      const { paginas, totalPaginas, base, tamPagina, hechas, pendiente, completo, actualizado, vistos } = st;
      plano[usuario] = { paginas, totalPaginas, base, tamPagina, hechas, pendiente, completo, actualizado, vistos };
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(plano));
  } catch (e) {
    console.error('[historicoStore] fallo guardando:', e.message);
  }
}

function estadoDe(usuario) {
  let st = estados.get(usuario);
  if (!st) {
    st = nuevoEstado();
    estados.set(usuario, st);
  }
  return st;
}

function conTimeout(promesa, ms) {
  let t;
  return Promise.race([
    promesa,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error('cofiba.es no ha respondido a tiempo')), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

const enPrimerPlano = (st) => Date.now() - st.ultimoInteres < INTERES_MS;
export const paginasLeidas = (st) => st.hechas.filter(Boolean).length;

// Lee la página `idx` (0 = primera) con la sesión del lector `lector`,
// validándola; reintenta con sesión nueva si falla o viene incompleta.
async function leerPagina(usuario, st, lector, idx) {
  const url = idx === 0 || !st.base ? CONSUMO_URL : `${st.base}${idx + 1}/`;
  let ultimoFallo = null;
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    const t0 = Date.now();
    try {
      if (!st.sesiones[lector]) {
        const sesion = await st.crearSesion();
        // Cofiba.es solo sirve /consumo/N/ a una sesión que ya ha abierto
        // antes /consumo.html (comprobado: si no, devuelve la página 1
        // vacía) — cada lector nuevo la abre una vez antes de saltar.
        if (idx > 0) await conTimeout(getProductos(sesion, { pageUrl: CONSUMO_URL }), TIMEOUT_PAGINA_MS);
        st.sesiones[lector] = sesion;
      }
      const res = await conTimeout(getProductos(st.sesiones[lector], { pageUrl: url }), TIMEOUT_PAGINA_MS);
      const total = res.totalPaginas || st.totalPaginas;
      const esUltima = total && idx === total - 1;
      const llena = !st.tamPagina || esUltima || res.productos.length >= st.tamPagina;
      if (res.pagina !== idx + 1 || !llena || (!esUltima && res.productos.length === 0)) {
        throw new Error(`página ${idx + 1} incompleta (${res.productos.length} productos, decía ser la ${res.pagina})`);
      }
      console.log(
        `[historico] ${usuario.slice(0, 3)}… lector ${lector} página ${idx + 1}/${total || '?'} en ${Math.round(
          (Date.now() - t0) / 1000
        )}s, ${res.productos.length} productos (${enPrimerPlano(st) ? 'primer plano' : 'fondo'})`
      );
      return res;
    } catch (e) {
      ultimoFallo = e;
      console.log(`[historico] reintento página ${idx + 1}: ${e.message}`);
      st.sesiones[lector] = null; // sesión nueva en el siguiente intento
    }
  }
  throw ultimoFallo;
}

function guardarPagina(usuario, st, idx, res) {
  st.paginas[idx] = res.productos;
  st.hechas[idx] = true;
  registrarCompras(usuario, res.productos); // marcas de "ya comprado" desde ya
  st.version += 1;
  guardarEnDisco();
}

async function recorrer(usuario, st) {
  st.corriendo = true;
  st.error = null;
  try {
    // La primera página dice cuántas hay, la URL base y el tamaño de página.
    if (!st.hechas[0] || !st.totalPaginas || !st.base) {
      const res = await leerPagina(usuario, st, 0, 0);
      st.totalPaginas = res.totalPaginas || 1;
      st.base = res.paginacionBase;
      st.tamPagina = res.productos.length;
      guardarPagina(usuario, st, 0, res);
    }
    const pendientes = [];
    for (let i = 0; i < st.totalPaginas; i++) if (!st.hechas[i]) pendientes.push(i);

    let fallo = null;
    await Promise.all(
      Array.from({ length: Math.min(LECTORES, pendientes.length) }, async (_, lector) => {
        while (pendientes.length && !fallo) {
          const idx = pendientes.shift();
          try {
            guardarPagina(usuario, st, idx, await leerPagina(usuario, st, lector, idx));
          } catch (e) {
            fallo = e;
          }
        }
      })
    );
    if (fallo) throw fallo;

    // Si esta vuelta ha traído menos páginas que la anterior (se renovó y
    // el histórico real es más corto), se descartan las sobrantes.
    st.paginas.length = st.totalPaginas;
    st.pendiente = false;
    st.completo = true;
    st.actualizado = Date.now();
    st.vistos = {}; // ya está todo en las páginas reales
    st.version += 1;
    completarComprados(usuario, st.paginas.flat());
    guardarEnDisco(true);
    console.log(`[historico] ${usuario.slice(0, 3)}… completo: ${st.totalPaginas} páginas`);
  } catch (e) {
    console.error('[historicoStore] fallo recorriendo el histórico:', e.message);
    st.error = e.message;
    st.version += 1;
    // Se vuelve a intentar en un rato, desde donde se quedó.
    setTimeout(() => arrancar(usuario, st), 60 * 1000);
  } finally {
    st.corriendo = false;
  }
}

function arrancar(usuario, st) {
  if (st.corriendo || !st.pendiente || !st.crearSesion) return;
  recorrer(usuario, st);
}

function reiniciarRecorrido(st) {
  // No se vacía `paginas`: se sigue enseñando lo anterior y cada página se
  // sustituye en su sitio según llega la nueva.
  st.hechas = [];
  st.totalPaginas = null;
  st.pendiente = true;
  st.completo = false;
  st.error = null;
  st.version += 1;
}

// Llamado en cada petición autenticada (cualquier pantalla): se asegura de
// que el recorrido está en marcha si aún falta algo. `crearSesion` abre una
// sesión de cofiba.es nueva para los lectores.
export function asegurarHistorico(usuario, crearSesion) {
  const st = estadoDe(usuario);
  st.crearSesion = crearSesion;
  arrancar(usuario, st);
}

// Llamado en cada consulta de la pestaña Histórico.
export function consultarHistorico(usuario, crearSesion, { forzar = false } = {}) {
  const st = estadoDe(usuario);
  st.crearSesion = crearSesion;
  st.ultimoInteres = Date.now();
  const caducado = st.completo && st.actualizado && Date.now() - st.actualizado > CADUCIDAD_MS;
  if (!st.corriendo && (forzar || caducado)) reiniciarRecorrido(st);
  arrancar(usuario, st);
  return st;
}

// Productos marcados como "comprado" que se acaban de ver navegando el
// catálogo: entran al histórico al momento aunque su página aún no se haya
// leído.
export function registrarVistoEnCatalogo(usuario, productos) {
  const st = estadoDe(usuario);
  if (st.completo) return;
  let nuevos = 0;
  for (const p of productos) {
    if (!p.comprado || st.vistos[p.articulo]) continue;
    const { articulo, referencia, nombre, imagen, precioFinal, undVenta, origen } = p;
    st.vistos[p.articulo] = { articulo, referencia, nombre, imagen, precioFinal, undVenta, origen };
    nuevos += 1;
  }
  if (nuevos) {
    st.version += 1;
    guardarEnDisco();
  }
}

// Lista para el cliente: páginas leídas + (mientras no esté completo) lo
// visto como comprado en el catálogo que aún no ha salido en esas páginas.
export function productosHistorico(st) {
  const reales = st.paginas.filter(Boolean).flat();
  if (st.completo) return reales;
  const yaEstan = new Set(reales.map((p) => p.articulo));
  const extra = Object.values(st.vistos).filter((p) => !yaEstan.has(p.articulo));
  return reales.concat(extra);
}
