import { getCache, setCache } from './localCache.js';

const TOKEN_KEY = 'cofiba_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The backend keeps sessions in memory and forgets them whenever it
    // restarts, so a token that looked valid can suddenly 401 mid-session —
    // that must never fail silently, so broadcast it for App.jsx to react to.
    if (res.status === 401 && auth) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('cofiba:session-expired'));
    }
    const err = new Error(data.error || `Error ${res.status}`);
    err.debugHtml = data.debugHtml;
    throw err;
  }
  return data;
}

// Muestra lo que haya en caché al instante (si hay algo) vía `onCacheHit`
// mientras la petición de verdad va por detrás; cuando esta responde, se
// guarda como la nueva caché para la próxima vez. Si la respuesta real llega
// ANTES de que termine de leerse la caché (puede pasar, ambas son
// asíncronas), se ignora el resultado de caché para no pisar datos frescos
// con otros más viejos.
async function conCache(clave, fetcher, onCacheHit) {
  let frescoYaLlego = false;
  getCache(clave).then((cacheado) => {
    if (cacheado && !frescoYaLlego) onCacheHit?.(cacheado);
  });
  const fresco = await fetcher();
  frescoYaLlego = true;
  setCache(clave, fresco);
  return fresco;
}

export const api = {
  async login(usuario, password) {
    const data = await request('/login', { method: 'POST', body: { usuario, password }, auth: false });
    setToken(data.token);
    return data;
  },
  logout() {
    setToken(null);
  },
  categorias() {
    return request('/categorias');
  },
  // Casi nunca cambian: enseñar la última lista guardada en el propio
  // navegador mientras se confirma que sigue igual es un atajo seguro.
  categoriasCached(onCacheHit) {
    return conCache('categorias', () => this.categorias(), onCacheHit);
  },
  productos({ categoria, subcategoria, page = 1, pageUrl }) {
    const params = new URLSearchParams({
      categoria,
      page: String(page),
      ...(subcategoria ? { subcategoria } : {}),
      ...(pageUrl ? { pageUrl } : {}),
    });
    return request(`/productos?${params.toString()}`);
  },
  productosCached({ categoria, subcategoria, page = 1, pageUrl }, onCacheHit) {
    const clave = `productos:${categoria}|${subcategoria || ''}|${pageUrl || ''}`;
    return conCache(clave, () => this.productos({ categoria, subcategoria, page, pageUrl }), onCacheHit);
  },
  carrito() {
    return request('/carrito');
  },
  miCuenta() {
    return request('/mi-cuenta');
  },
  // CIF, dirección, contacto... casi nunca cambia entre visitas.
  miCuentaCached(onCacheHit) {
    return conCache('mi-cuenta', () => this.miCuenta(), onCacheHit);
  },
  anadirAlCarrito({ categoria, articulo, cantidad, origen }) {
    return request('/carrito/item', { method: 'POST', body: { categoria, articulo, cantidad, origen } });
  },
  actualizarCantidadCarrito({ articulo, cantidad }) {
    return request('/carrito/item', { method: 'PUT', body: { articulo, cantidad } });
  },
  eliminarDelCarrito(codigo) {
    return request(`/carrito/item/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
  },
  vaciarCarrito() {
    return request('/carrito/vaciar', { method: 'POST' });
  },
  finalizarPedido(observaciones = '') {
    return request('/carrito/finalizar', { method: 'POST', body: { observaciones } });
  },
  historico({ pageUrl, forzar } = {}) {
    const params = new URLSearchParams();
    if (pageUrl) params.set('pageUrl', pageUrl);
    if (forzar) params.set('forzar', '1');
    const qs = params.toString();
    return request(`/historico${qs ? `?${qs}` : ''}`);
  },
  // /consumo.html tarda 15-35s en el servidor de cofiba.es — mostrar la
  // última tanda vista de esta misma página mientras se repite la petición
  // de verdad evita ese rato en blanco en visitas repetidas.
  //
  // "v2" a propósito: los dispositivos que ya habían recorrido TODO el
  // histórico antes de que el servidor empezara a enriquecer cada producto
  // con categoría/subcategoría (el botón "Ver más") se quedaban con esa
  // caché antigua para siempre — Historico.jsx nunca vuelve a pedir de
  // verdad una página que ya tiene completa en caché. Cambiar la clave hace
  // que esa caché vieja quede huérfana (se ignora) y fuerza un recorrido
  // fresco, ya con el campo nuevo.
  historicoCached({ pageUrl, forzar } = {}, onCacheHit) {
    const clave = `historico:v2:${pageUrl || ''}`;
    return conCache(clave, () => this.historico({ pageUrl, forzar }), onCacheHit);
  },
  pedidosPendientes() {
    return request('/pedidos-pendientes');
  },
  estadisticas() {
    return request('/estadisticas');
  },
  estadisticasCached(onCacheHit) {
    return conCache('estadisticas', () => this.estadisticas(), onCacheHit);
  },
  novedades() {
    return request('/novedades');
  },
  // A diferencia del resto de *Cached (que siempre repiten la petición real
  // por detrás), Novedades solo hace falta pedirla de verdad una vez al
  // día: el catálogo de cofiba.es no cambia más a menudo que eso (se
  // renueva de madrugada), así que volver a mirarla el mismo día no puede
  // traer nada nuevo.
  async novedadesCached(onCacheHit) {
    const CLAVE = 'novedades';
    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const cacheado = await getCache(CLAVE);
    if (cacheado) onCacheHit?.(cacheado.datos);
    if (cacheado && Date.now() - cacheado.cuando < UN_DIA_MS) return cacheado.datos;
    const frescos = await this.novedades();
    await setCache(CLAVE, { datos: frescos, cuando: Date.now() });
    return frescos;
  },
  cambiosStock() {
    return request('/cambios-stock');
  },
  // Mismo motivo que novedadesCached: los cambios de stock solo se detectan
  // una vez por recorrido del catálogo (cada ~6h), así que pedirlo de
  // verdad más de una vez al día no puede traer nada nuevo.
  async cambiosStockCached(onCacheHit) {
    const CLAVE = 'cambios-stock';
    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const cacheado = await getCache(CLAVE);
    if (cacheado) onCacheHit?.(cacheado.datos);
    if (cacheado && Date.now() - cacheado.cuando < UN_DIA_MS) return cacheado.datos;
    const frescos = await this.cambiosStock();
    await setCache(CLAVE, { datos: frescos, cuando: Date.now() });
    return frescos;
  },
  // El PDF no puede enlazarse directo (necesita nuestra sesión, no la del
  // navegador) — se trae como blob autenticado y quien llama decide qué
  // hacer con él (abrirlo, descargarlo).
  async copiaPedido(href) {
    const token = getToken();
    const res = await fetch(`/api/pedido-copia?href=${encodeURIComponent(href)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status}`);
    }
    return res.blob();
  },
  buscar(q) {
    return request(`/buscar?q=${encodeURIComponent(q)}`);
  },
  // Solo tiene sentido cachear por término exacto — cambiar una letra ya es
  // una búsqueda distinta. Rellena el hueco antes de la primera respuesta
  // real; en cuanto esta llega, manda ella (y sus refrescos si el índice
  // sigue construyéndose), la caché no vuelve a intervenir en esa búsqueda.
  buscarCached(q, onCacheHit) {
    const clave = `buscar:${q.trim().toLowerCase()}`;
    return conCache(clave, () => this.buscar(q), onCacheHit);
  },
};
