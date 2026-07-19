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
  historico({ pageUrl } = {}) {
    const params = pageUrl ? `?pageUrl=${encodeURIComponent(pageUrl)}` : '';
    return request(`/historico${params}`);
  },
  // /consumo.html tarda 15-35s en el servidor de cofiba.es — mostrar la
  // última tanda vista de esta misma página mientras se repite la petición
  // de verdad evita ese rato en blanco en visitas repetidas.
  historicoCached({ pageUrl } = {}, onCacheHit) {
    const clave = `historico:${pageUrl || ''}`;
    return conCache(clave, () => this.historico({ pageUrl }), onCacheHit);
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
