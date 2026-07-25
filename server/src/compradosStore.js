import { getProductos, CONSUMO_URL } from './cofibaClient.js';
import { esperarInactividad } from './indiceStore.js';
import { encolarConsumo } from './consumoQueue.js';

// El plan gratuito no guarda nada en disco/BD entre reinicios — así que en
// vez de llevar nuestro propio registro de "qué compró cada cliente", esto
// junta en memoria, por usuario, los códigos de artículo vistos en
// /consumo.html (el histórico real de la cuenta en cofiba.es). Con eso el
// catálogo (Productos/Búsqueda) marca al momento qué productos ya se
// compraron antes, sin que el cliente tenga que entrar en Histórico.
//
// El set se alimenta de dos sitios:
//  1. Cada página de /consumo.html que YA se pidió por cualquier motivo (la
//     pestaña Histórico) — gratis, y hace que las marcas aparezcan en cuanto
//     hay datos, aunque sean parciales.
//  2. Un recorrido completo en segundo plano de todas las páginas — pero SOLO
//     se dispara cuando el cliente busca algo o entra en Histórico (petición
//     expresa del usuario: navegar por el catálogo no debe arrancar rastreos
//     de fondo, que en el servidor gratuito compiten por la única CPU).
//
// Recorrer las ~32 páginas reales tarda varios minutos (cada una es igual de
// lenta que la propia pestaña Histórico — ver getComprasRecientes) así que
// nunca bloquea una petición: mientras corre, el catálogo se sirve con las
// marcas parciales que ya haya.
const TTL_MS = 20 * 60 * 1000;
const datos = new Map(); // usuario -> { conteo, completo, actualizado }
const enCurso = new Map(); // usuario -> Promise

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
// completo.
export function registrarCompras(usuario, productos) {
  const d = entrada(usuario);
  productos.forEach((p) => d.conteo.set(p.articulo, (d.conteo.get(p.articulo) || 0) + 1));
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

// Dispara el recorrido completo en segundo plano si hace falta. "Fire and
// forget" a propósito: la petición actual se sirve con lo que haya y las
// próximas irán teniendo más marcas según avanza.
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
      // los ratos muertos.
      await esperarInactividad();
      const res = await encolarConsumo(usuario, () => getProductos(session, { pageUrl: pageUrl || CONSUMO_URL }));
      registrarCompras(usuario, res.productos);
      pageUrl = res.siguientePagina;
    } while (pageUrl);
    d.completo = true;
    d.actualizado = Date.now();
  })()
    .catch((e) => {
      console.error('[compradosStore] fallo recorriendo el histórico de compras:', e.message);
    })
    .finally(() => {
      enCurso.delete(usuario);
    });
  enCurso.set(usuario, promesa);
}
