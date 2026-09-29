import { getProductos, CONSUMO_URL } from './cofibaClient.js';
import { encolarConsumo } from './consumoQueue.js';
import { completarComprados, registrarCompras } from './compradosStore.js';

// Histórico completo de cada cuenta (/consumo.html de cofiba.es), recorrido
// UNA sola vez en el servidor y servido entero al cliente en cada consulta.
//
// Antes el propio móvil pedía página a página (/api/historico?pageUrl=...)
// y cada vez que se salía y volvía a la pestaña empezaba otra vez desde la
// página 1; con ~30 páginas de 15-35s cada una (lentitud de cofiba.es, no
// nuestra) el contador parecía no avanzar nunca. Además una petición que
// cofiba.es dejaba colgada bloqueaba la cola de esa cuenta para siempre.
//
// Ahora:
//  - El recorrido vive aquí y RECUERDA por dónde iba: volver a la pestaña
//    continúa desde la última página traída, no desde cero.
//  - Solo avanza mientras alguien lo está mirando (el cliente consulta cada
//    pocos segundos; sin consultas en INTERES_MS se pausa) — cofiba.es
//    serializa todas las peticiones de una cuenta y un recorrido de fondo
//    ralentizaría el resto de la app.
//  - Cada página tiene un tiempo máximo (TIMEOUT_PAGINA_MS): si cofiba.es no
//    contesta, se reintenta en vez de quedarse esperando para siempre.
//  - Al completarse alimenta también las marcas de "ya comprado"
//    (compradosStore), así no se recorre dos veces lo mismo.
const INTERES_MS = 20 * 1000;
const TIMEOUT_PAGINA_MS = 75 * 1000;
const REINTENTOS = 2;
const CADUCIDAD_MS = 30 * 60 * 1000;

const estados = new Map(); // usuario -> estado

function nuevoEstado() {
  return {
    paginas: [], // paginas[i] = productos de la página real i
    totalPaginas: null,
    siguiente: CONSUMO_URL, // próxima URL a pedir; null = recorrido terminado
    indice: 0, // posición donde se guardará la próxima página
    completo: false,
    actualizado: null,
    corriendo: false,
    ultimoInteres: 0,
    error: null,
    version: 0,
  };
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

async function recorrer(usuario, session, st) {
  st.corriendo = true;
  st.error = null;
  try {
    while (st.siguiente && Date.now() - st.ultimoInteres < INTERES_MS) {
      const url = st.siguiente;
      let res = null;
      let ultimoFallo = null;
      for (let intento = 0; intento <= REINTENTOS && !res; intento++) {
        try {
          res = await encolarConsumo(usuario, () =>
            conTimeout(getProductos(session, { pageUrl: url }), TIMEOUT_PAGINA_MS)
          );
          // Una página vacía en medio del recorrido es la carrera interna de
          // cofiba.es (ver consumoQueue.js), no el final real: se reintenta.
          if (res.productos.length === 0 && st.indice > 0 && intento < REINTENTOS) res = null;
        } catch (e) {
          ultimoFallo = e;
        }
      }
      if (!res) throw ultimoFallo || new Error('No se pudo leer el histórico');

      st.paginas[st.indice] = res.productos;
      registrarCompras(usuario, res.productos); // marcas de "ya comprado" desde ya
      st.totalPaginas = res.totalPaginas || st.totalPaginas;
      st.indice += 1;
      st.siguiente = res.siguientePagina || null;
      st.version += 1;
    }
    if (!st.siguiente) {
      // Si esta vuelta ha traído menos páginas que la anterior (se renovó y
      // el histórico real es más corto), se descartan las sobrantes.
      st.paginas.length = st.indice;
      st.completo = true;
      st.actualizado = Date.now();
      st.version += 1;
      completarComprados(usuario, st.paginas.flat());
    }
  } catch (e) {
    console.error('[historicoStore] fallo recorriendo el histórico:', e.message);
    st.error = e.message;
    st.version += 1;
  } finally {
    st.corriendo = false;
  }
}

function reiniciarRecorrido(st) {
  // No se vacía `paginas`: se sigue enseñando lo anterior y cada página se
  // sustituye en su sitio según llega la nueva.
  st.siguiente = CONSUMO_URL;
  st.indice = 0;
  st.completo = false;
  st.error = null;
  st.version += 1;
}

// Llamado en cada consulta del cliente: marca que hay alguien mirando,
// arranca/retoma el recorrido si hace falta y devuelve el estado actual.
export function consultarHistorico(usuario, session, { forzar = false } = {}) {
  let st = estados.get(usuario);
  if (!st) {
    st = nuevoEstado();
    estados.set(usuario, st);
  }
  st.ultimoInteres = Date.now();

  const caducado = st.completo && st.actualizado && Date.now() - st.actualizado > CADUCIDAD_MS;
  if (!st.corriendo && (forzar || caducado)) reiniciarRecorrido(st);
  if (!st.corriendo && st.siguiente) recorrer(usuario, session, st);
  return st;
}

export function historicoEnMarcha(usuario) {
  return !!estados.get(usuario)?.corriendo;
}
