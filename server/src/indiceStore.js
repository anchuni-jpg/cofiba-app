import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlCatalogo } from './cofibaClient.js';

// El buscador de cofiba.es (categoria/todas/true?buscar=) rellena el nombre
// de cada producto con JavaScript que este scraper no ejecuta — confirmado
// mirando el HTML crudo, tres plantillas distintas de su web (listado de
// búsqueda, ficha de producto) no traen el nombre en absoluto. Las páginas
// normales de categoría/subcategoría (modo "false") sí lo traen completo.
// Así que en vez de usar su buscador roto, se recorre el catálogo entero por
// sus páginas normales una vez, se guarda un índice plano, y las búsquedas
// filtran ese índice en memoria — instantáneas, con nombres siempre buenos.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'indice-busqueda.json');
const SEIS_HORAS = 6 * 60 * 60 * 1000;

let estado = 'vacio'; // vacio | construyendo | listo | error
let indice = [];
let indiceParcial = []; // productos vistos en la construcción en curso — buscable ya, antes de terminar
let progreso = 0;
let actualizado = null;
let ultimoError = null;
let promesaConstruccion = null;
let ultimaActividad = 0;

// El servidor marca aquí cada petición real de un cliente (ver middleware en
// index.js). El rastreo del catálogo consulta esto entre página y página: si
// alguien ha usado la app hace poco, se espera más antes de la siguiente
// petición a cofiba.es, cediéndole el turno — así el rastreo de fondo no
// compite por la misma sesión/servidor con quien está usando la app de
// verdad en ese momento. Sin actividad reciente, va a su ritmo normal.
export function marcarActividad() {
  ultimaActividad = Date.now();
}

// El plan gratuito de Render solo da una CPU compartida, y confirmado que
// cofiba.es serializa TODAS las peticiones de una misma cuenta en su propio
// servidor (no solo /consumo.html) — así que una simple pausa corta no
// bastaba para que la navegación normal no se notara lenta mientras el
// rastreo corría de fondo. Ventana de inactividad real (ver
// esperarInactividad) en vez de una pausa fija.
const VENTANA_ACTIVIDAD_MS = 10000;

// Espera hasta que lleve VENTANA_ACTIVIDAD_MS sin ninguna petición real del
// cliente (o hasta `maxEsperaMs` como tope, para que un rastreo largo acabe
// avanzando aunque haya tráfico constante). Clave para /consumo.html: cada
// una de esas peticiones tarda 15-35s en el servidor de cofiba.es y este
// serializa las de una misma cuenta, así que si el rastreo de fondo lanza
// una mientras el cliente navega, la navegación se queda esperando DETRÁS de
// esos 15-35s (medido: una categoría normal pasaba de <1s a ~50s). Cediendo
// el turno así, el rastreo solo pide páginas cuando el cliente no está
// usando la app, y navegar vuelve a ir rápido.
export function esperarInactividad(maxEsperaMs = 45000) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    function comprobar() {
      const inactivo = Date.now() - ultimaActividad >= VENTANA_ACTIVIDAD_MS;
      const agotado = Date.now() - inicio >= maxEsperaMs;
      if (inactivo || agotado) resolve();
      else setTimeout(comprobar, 500);
    }
    comprobar();
  });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function cargarDeDisco() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!Array.isArray(data.indice) || !data.indice.length) return false;
    indice = data.indice;
    actualizado = data.actualizado || null;
    estado = 'listo';
    return true;
  } catch {
    return false;
  }
}

function guardarEnDisco() {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify({ indice, actualizado }));
}

export function estadoActual() {
  return { estado, progreso, total: indice.length, actualizado, error: ultimoError };
}

export function indiceListo() {
  return estado === 'listo' ? indice : null;
}

export function necesitaConstruir() {
  if (estado === 'construyendo') return false;
  if (estado !== 'listo') return true;
  return !actualizado || Date.now() - actualizado > SEIS_HORAS;
}

// `session` es la sesión ya autenticada de quien dispara la búsqueda que
// hace falta reconstruir el índice — el índice en sí es del catálogo
// general, no de ese usuario en concreto, así que cualquier sesión válida
// sirve y el resultado beneficia a todo el que busque después.
export function iniciarConstruccion(session) {
  if (promesaConstruccion) return promesaConstruccion;
  estado = 'construyendo';
  progreso = 0;
  indiceParcial = [];
  ultimoError = null;
  let ultimoGuardado = 0;
  promesaConstruccion = (async () => {
    try {
      const nuevo = await crawlCatalogo(session, esperarInactividad, (item, n) => {
        indiceParcial.push(item);
        progreso = n;
        // Un rastreo completo puede tardar bastante — si el proceso se cae
        // o se reinicia a medias (ya ha pasado), sin esto se perdía TODO lo
        // recorrido hasta entonces porque solo se guardaba al terminar del
        // todo. Guardando cada 200 productos, como mucho se pierde ese
        // último tramo, no la construcción entera. `actualizado: null` dice
        // que esto es un progreso a medias, no un índice ya terminado —
        // `necesitaConstruir()` seguirá pidiendo un rastreo fresco de fondo
        // aunque esto ya se pueda usar para buscar mientras tanto.
        if (n - ultimoGuardado >= 200) {
          ultimoGuardado = n;
          try {
            ensureDataDir();
            fs.writeFileSync(STORE_FILE, JSON.stringify({ indice: indiceParcial, actualizado: null }));
          } catch {
            // Un fallo guardando el progreso a medias no debe tirar el rastreo.
          }
        }
      });
      indice = nuevo;
      actualizado = Date.now();
      estado = 'listo';
      guardarEnDisco();
    } catch (e) {
      estado = 'error';
      ultimoError = e.message;
      console.error('[indiceStore] fallo construyendo el índice de búsqueda:', e.message);
    } finally {
      promesaConstruccion = null;
    }
  })();
  return promesaConstruccion;
}

function normalizar(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function buscarEnIndice(termino) {
  const t = normalizar(termino);
  if (!t) return [];
  // Se busca sobre lo que haya más completo: `indice` (el último rastreo
  // terminado del todo) o `indiceParcial` (el que está en marcha ahora
  // mismo, que arranca vacío y va creciendo). Antes esto se decidía por
  // `estado === 'listo'` — pero en cuanto el índice caduca (6h) y arranca un
  // rastreo nuevo, `estado` pasa a 'construyendo' e `indiceParcial` se
  // resetea a cero, así que la búsqueda se quedaba dando 0 resultados
  // durante TODO el rato que tardara el rastreo nuevo (puede ser una hora),
  // aunque el índice anterior siguiera siendo perfectamente válido para
  // buscar mientras tanto. Comparando tamaños en vez de mirar el estado, se
  // sigue sirviendo el índice viejo hasta que el nuevo lo supere de verdad.
  //
  // Sin límite de resultados a propósito (antes se cortaba en 200): el
  // cliente ya pagina esta lista en tandas (Busqueda.jsx), así que recortarla
  // aquí solo escondía coincidencias reales sin necesidad.
  const fuente = indiceParcial.length > indice.length ? indiceParcial : indice;
  return fuente
    .filter(
      (p) =>
        normalizar(p.nombre).includes(t) ||
        normalizar(p.referencia).includes(t) ||
        normalizar(p.ean).includes(t) ||
        normalizar(p.marca).includes(t)
    )
    .sort((a, b) => normalizar(a.nombre).localeCompare(normalizar(b.nombre)));
}
