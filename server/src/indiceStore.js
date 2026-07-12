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

const VENTANA_ACTIVIDAD_MS = 4000;
const PAUSA_EXTRA_MS = 600;
function pausaExtraPorActividad() {
  return Date.now() - ultimaActividad < VENTANA_ACTIVIDAD_MS ? PAUSA_EXTRA_MS : 0;
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
      const nuevo = await crawlCatalogo(session, pausaExtraPorActividad, (item, n) => {
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

export function buscarEnIndice(termino, limite = 200) {
  const t = normalizar(termino);
  if (!t) return [];
  // Con el índice ya listo se busca sobre él; mientras se está construyendo
  // (puede tardar varios minutos en un catálogo grande) se busca sobre lo
  // que se ha visto hasta ahora, para no dejar al usuario sin nada durante
  // todo ese rato — el propio "construyendo: true" en la respuesta avisa de
  // que puede haber más resultados según avance.
  const fuente = estado === 'listo' ? indice : indiceParcial;
  return fuente
    .filter(
      (p) =>
        normalizar(p.nombre).includes(t) ||
        normalizar(p.referencia).includes(t) ||
        normalizar(p.ean).includes(t) ||
        normalizar(p.marca).includes(t)
    )
    .sort((a, b) => normalizar(a.nombre).localeCompare(normalizar(b.nombre)))
    .slice(0, limite);
}
