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
    err.code = data.code;
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
  // A diferencia del resto de *Cached, aquí "más reciente" no siempre es
  // "mejor": el servidor gratuito se reinicia a menudo (duerme por
  // inactividad) y pierde el recorrido de compras acumulado, así que una
  // respuesta fresca justo después de un reinicio puede traer MENOS datos
  // que los que ya se habían visto — sin este cuidado, el cliente vería sus
  // estadísticas "vaciarse" delante de sus ojos cada vez que entra después
  // de un rato sin usar la app. Se guarda y se enseña siempre la mejor foto
  // vista hasta ahora (más cajas contadas), nunca una peor aunque sea más
  // nueva; en cuanto el recorrido de fondo del servidor alcanza (o supera)
  // lo ya visto, esa sí la sustituye.
  async estadisticasCached(onCacheHit) {
    const CLAVE = 'estadisticas';
    const cacheado = await getCache(CLAVE);
    if (cacheado) onCacheHit?.(cacheado);
    const frescos = await this.estadisticas();
    const mejor = cacheado && (cacheado.totalLineas || 0) > (frescos.totalLineas || 0) ? cacheado : frescos;
    await setCache(CLAVE, mejor);
    return mejor;
  },
  // Ligera y siempre en vivo a propósito (sin caché): solo suma un array en
  // memoria del servidor, no recorre nada de cofiba.es — no hace falta
  // ahorrarse la petición como con el resto de Estadísticas.
  facturacion(periodo) {
    return request(`/facturacion${periodo ? `?periodo=${periodo}` : ''}`);
  },
  catalogoSnapshot() {
    return request('/catalogo-snapshot');
  },
  // Novedades y cambios de stock se calculan aquí, EN ESTE DISPOSITIVO, no
  // en el servidor — el plan gratuito de Render borra su disco en cada
  // despliegue, así que cualquier "lo que ya conocíamos" guardado ahí se
  // perdía justo cuando más falta hacía para comparar, y con despliegues
  // seguidos ni daba tiempo a que sobreviviera un rastreo completo entre
  // uno y el siguiente. Aquí no hay ese problema: la última foto del
  // catálogo vive en IndexedDB, en el propio móvil/navegador del cliente, y
  // sobrevive a que el servidor se reinicie las veces que haga falta.
  //
  // Primera vez que se usa la app en este dispositivo: no hay foto anterior
  // con la que comparar, así que no se marca nada como "nuevo" (si no, el
  // catálogo entero parecería novedad el primer día) — solo se guarda esa
  // foto como punto de partida.
  async novedadesYCambiosStock() {
    const CLAVE_SNAPSHOT = 'catalogo-snapshot-anterior';
    const CLAVE_NOVEDADES = 'novedades-detectadas';
    const CLAVE_CAMBIOS = 'cambios-stock-detectados';
    // Info de producto (nombre/foto/precio/categoría) para poder ENSEÑAR
    // cada novedad/cambio — separada de CLAVE_SNAPSHOT (que solo guarda
    // stock/undVenta para comparar). Se acumula, nunca se vacía: si el
    // catálogo de una respuesta puntual viene corto o vacío (recién
    // desplegado, aún rastreándose), una novedad detectada hace un rato
    // seguía "desapareciendo" del resultado porque ya no estaba en ESA
    // respuesta para sacarle el nombre — con esto se sigue enseñando con
    // los últimos datos buenos que se vieron de ese artículo.
    const CLAVE_INFO = 'catalogo-info-productos';
    const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
    const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
    const unidadesPorCaja = (u) => parseFloat(String(u || '').replace(/\./g, '').replace(',', '.')) || 1;

    const [data, anterior, novedadesGuardadas, cambiosGuardados, infoGuardada] = await Promise.all([
      this.catalogoSnapshot(),
      getCache(CLAVE_SNAPSHOT),
      getCache(CLAVE_NOVEDADES),
      getCache(CLAVE_CAMBIOS),
      getCache(CLAVE_INFO),
    ]);
    const actuales = data.productos || [];
    const ahora = Date.now();
    const infoPorArticulo = { ...(infoGuardada || {}) };
    for (const p of actuales) infoPorArticulo[p.articulo] = p;

    let novedades = (novedadesGuardadas || []).filter((n) => ahora - n.desde <= TRES_DIAS_MS);
    let cambios = (cambiosGuardados || []).filter((c) => ahora - c.fecha <= SIETE_DIAS_MS);

    if (anterior?.porArticulo && actuales.length) {
      const nuevosDetectados = [];
      const cambiosDetectados = [];
      for (const p of actuales) {
        const previo = anterior.porArticulo[p.articulo];
        if (!previo) {
          nuevosDetectados.push({ articulo: p.articulo, desde: ahora });
          continue;
        }
        if (!Number.isFinite(p.stock) || !Number.isFinite(previo.stock) || previo.stock === p.stock) continue;
        const cajasAntes = previo.stock / unidadesPorCaja(previo.undVenta);
        const cajasDespues = p.stock / unidadesPorCaja(p.undVenta);
        const seAgoto = previo.stock > 0 && p.stock === 0;
        const seRepuso = previo.stock === 0 && p.stock > 0;
        const cruzoUmbral = (cajasAntes >= 10) !== (cajasDespues >= 10);
        const bajadaFuerte = p.stock < previo.stock && previo.stock > 0 && (previo.stock - p.stock) / previo.stock >= 0.5;
        if (seAgoto || seRepuso || cruzoUmbral || bajadaFuerte) {
          cambiosDetectados.push({ articulo: p.articulo, stockAntes: previo.stock, stockDespues: p.stock, fecha: ahora });
        }
      }
      if (nuevosDetectados.length) {
        const yaDetectados = new Set(nuevosDetectados.map((n) => n.articulo));
        novedades = [...nuevosDetectados, ...novedades.filter((n) => !yaDetectados.has(n.articulo))];
      }
      if (cambiosDetectados.length) {
        const yaDetectados = new Set(cambiosDetectados.map((c) => c.articulo));
        cambios = [...cambiosDetectados, ...cambios.filter((c) => !yaDetectados.has(c.articulo))].slice(0, 500);
      }
    }

    // Solo se pisa la foto/listas guardadas si de verdad llegó catálogo
    // fresco — con el índice del servidor aún "construyendo" (recién
    // desplegado) `actuales` puede venir corto o vacío, y guardarlo tal
    // cual perdería la foto buena que ya hubiera de antes.
    if (actuales.length) {
      const porArticulo = {};
      for (const p of actuales) {
        if (Number.isFinite(p.stock)) porArticulo[p.articulo] = { stock: p.stock, undVenta: p.undVenta };
      }
      await Promise.all([
        setCache(CLAVE_SNAPSHOT, { porArticulo, cuando: ahora }),
        setCache(CLAVE_NOVEDADES, novedades),
        setCache(CLAVE_CAMBIOS, cambios),
        setCache(CLAVE_INFO, infoPorArticulo),
      ]);
    }

    const enriquecer = (entrada) => {
      const info = infoPorArticulo[entrada.articulo];
      return info ? { ...info, ...entrada } : null;
    };
    return {
      construyendo: !!data.construyendo,
      novedades: novedades.map(enriquecer).filter(Boolean).sort((a, b) => b.desde - a.desde),
      cambiosStock: cambios.map(enriquecer).filter(Boolean).sort((a, b) => b.fecha - a.fecha),
    };
  },
  // Bajo demanda, al abrir la ficha de un producto — no tiene sentido
  // cachear esto por más de la sesión actual, cambia con cada artículo.
  relacionados(articulo) {
    return request(`/relacionados?articulo=${encodeURIComponent(articulo)}`);
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
