// Marcas de "Comprado" que nunca desaparecen en este dispositivo.
//
// El servidor (plan gratuito) olvida lo que sabe de las compras cada vez que
// se reinicia o se duerme, y hasta que vuelve a leer el histórico sus
// respuestas llegan sin la marca — por eso a veces un producto marcado como
// comprado "dejaba de estarlo". Aquí se recuerda todo artículo visto alguna
// vez como comprado (o presente en el Histórico), con sus datos básicos, y:
//  - se vuelve a marcar aunque el servidor todavía no lo sepa;
//  - el Histórico lo enseña aunque aún no se haya leído su página.
// Se borra solo si entra otra cuenta distinta en el mismo móvil (ver
// cuentaActiva).
const CLAVE = 'cofiba:comprados:v2';
const CAMPOS = [
  'articulo',
  'referencia',
  'nombre',
  'imagen',
  'precioFinal',
  'undVenta',
  'origen',
  'categoria',
  'categoriaNombre',
  'subcategoria',
  'subcategoriaNombre',
];

let conocidos = null; // articulo -> datos básicos
function cargar() {
  if (conocidos) return conocidos;
  try {
    conocidos = new Map(Object.entries(JSON.parse(localStorage.getItem(CLAVE) || '{}')));
  } catch {
    conocidos = new Map();
  }
  return conocidos;
}
let guardado = null;
function guardar() {
  // Agrupa varias escrituras seguidas en una sola.
  clearTimeout(guardado);
  guardado = setTimeout(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(Object.fromEntries(conocidos)));
    } catch {
      // Sin almacenamiento disponible: solo se pierde el recuerdo entre visitas.
    }
  }, 300);
}

function basico(p) {
  const o = {};
  CAMPOS.forEach((c) => p[c] != null && (o[c] = p[c]));
  return o;
}

// Apunta como comprados todos los de la lista (p. ej. el Histórico entero).
export function registrarComprados(productos) {
  const mapa = cargar();
  let cambios = false;
  for (const p of productos) {
    if (!p?.articulo) continue;
    const previo = mapa.get(p.articulo);
    // Se actualiza si es nuevo o si ahora llegan datos que antes faltaban
    // (p. ej. la categoría, que el Histórico rellena más tarde).
    if (!previo || (!previo.categoria && p.categoria) || (!previo.nombre && p.nombre)) {
      mapa.set(p.articulo, { ...previo, ...basico(p) });
      cambios = true;
    }
  }
  if (cambios) guardar();
}

// Devuelve la lista con `comprado` = lo que diga el servidor O lo ya
// recordado aquí, y recuerda los nuevos que vengan marcados.
export function marcarComprados(productos) {
  if (!Array.isArray(productos)) return productos;
  registrarComprados(productos.filter((p) => p?.comprado));
  const mapa = cargar();
  return productos.map((p) => (p && !p.comprado && mapa.has(p.articulo) ? { ...p, comprado: true } : p));
}

// Todo lo recordado como comprado, para completar el Histórico.
export function productosRecordados() {
  return [...cargar().values()];
}

// Al entrar: si es otra cuenta distinta de la última que entró en este
// móvil, se olvidan las marcas de la anterior.
export function cuentaActiva(usuario) {
  const clave = (usuario || '').trim().toLowerCase();
  try {
    if (localStorage.getItem(CLAVE + ':cuenta') !== clave) {
      conocidos = new Map();
      localStorage.removeItem(CLAVE);
      localStorage.setItem(CLAVE + ':cuenta', clave);
    }
  } catch {
    // nada
  }
}
