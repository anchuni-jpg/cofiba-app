import express from 'express';
import compression from 'compression';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession,
  login,
  getCategorias,
  getProductosAgrupados,
  getComprasRecientes,
  getCarrito,
  getMiCuenta,
  getPedidosPendientes,
  getCopiaDocumento,
  anadirAlCarrito,
  actualizarCantidadCarrito,
  eliminarDelCarrito,
  vaciarCarrito,
  finalizarPedido,
} from './cofibaClient.js';
import { saveCredentials, loadCredentials, deleteCredentials } from './credentialStore.js';
import { registrarImagenes, obtenerImagen } from './imagenStore.js';
import {
  cargarDeDisco,
  estadoActual,
  indiceListo,
  necesitaConstruir,
  iniciarConstruccion,
  buscarEnIndice,
  buscarPorArticulo,
  marcarActividad,
} from './indiceStore.js';
import { asegurarComprados, comprasConocidas, registrarCompras } from './compradosStore.js';
import { encolarConsumo } from './consumoQueue.js';

// Red de seguridad a nivel de proceso: un error asíncrono que se escape sin
// try/catch (p. ej. en un rastreo de fondo) tumbaba TODO el servidor en vez
// de solo fallar esa tarea — con lo lento que es un arranque en frío en el
// plan gratuito, eso deja la app caída un buen rato hasta el próximo deploy
// o reinicio manual. Mejor registrar el error y seguir vivo.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors({ origin: true, credentials: true }));
// Comprime las respuestas JSON (los listados de productos/histórico pueden
// ser bastante grandes) — truco barato y sin riesgo para que tarden menos
// en llegar al móvil, sobre todo en 4G.
app.use(compression());
app.use(express.json());

// Marca cada producto de un listado con si el cliente ya lo compró antes
// (según compradosStore.js) — así se ve de un vistazo en Productos/Búsqueda
// sin tener que entrar en Histórico. Usa lo que se sepa hasta el momento
// (aunque sea parcial); a propósito NO dispara aquí ningún rastreo de fondo:
// eso solo lo hacen /api/buscar y /api/historico, cuando el cliente pide
// expresamente algo relacionado — navegar por el catálogo no debe arrancar
// trabajo pesado en segundo plano (en el servidor gratuito compite por la
// única CPU y se nota).
function marcarComprados(usuario, productos) {
  const set = comprasConocidas(usuario);
  if (!set) return productos;
  return productos.map((p) => ({ ...p, comprado: set.has(p.articulo) }));
}

// El rastreo del catálogo se frena solo cuando alguien está usando la app de
// verdad (ver indiceStore.js) — esto es lo que le avisa de cuándo.
app.use((req, _res, next) => {
  marcarActividad();
  next();
});

// Recupera el índice de búsqueda de disco si ya se construyó antes (evita
// reconstruir todo el catálogo en cada reinicio de `node --watch` durante
// desarrollo, y en cada arranque normal del servidor).
//
// A propósito NO se dispara el rastreo del catálogo aquí al arrancar (se
// probó y se quitó): en el plan gratuito de Render la instancia tiene una
// sola CPU compartida, y el rastreo en segundo plano competía por ella con
// las peticiones reales — toda la app (navegar, cambiar de página) se
// notaba lenta mientras tanto, aunque el rastreo en sí se frenara al
// detectar actividad. Ahora solo se construye el índice cuando alguien
// busca algo de verdad (ver /api/buscar), nunca solo por haber arrancado.
cargarDeDisco();

// In-memory session store: appToken -> { session, usuario, createdAt }
// This gets wiped whenever the process restarts (including every code change
// during development, via `node --watch`). Rather than forcing the client to
// retype their password each time, requireSession falls back to the
// encrypted credential store below and re-authenticates transparently.
const sessions = new Map();

async function requireSession(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión.' });

  const entry = sessions.get(token);
  if (entry) {
    req.cofiba = entry.session;
    req.usuario = entry.usuario;
    return next();
  }

  // Este middleware corre delante de CASI todas las rutas — un fallo aquí
  // sin capturar (leer/escribir credentials.json, crear la sesión) se colaba
  // sin responder nada útil al cliente, que veía un "Error 500" en blanco
  // viniera de la pantalla que viniera (Carrito, Productos...), no solo del
  // login. Todo el cuerpo bajo un único try/catch, igual que en /api/login.
  try {
    const creds = loadCredentials(token);
    if (!creds) return res.status(401).json({ error: 'No has iniciado sesión.' });

    const session = createSession();
    try {
      await login(session, creds.usuario, creds.password);
    } catch (e) {
      deleteCredentials(token);
      return res.status(401).json({ error: 'No has iniciado sesión.' });
    }
    sessions.set(token, { session, usuario: creds.usuario, createdAt: Date.now() });
    req.cofiba = session;
    req.usuario = creds.usuario;
    next();
  } catch (e) {
    console.error('[requireSession] fallo inesperado:', e.message);
    res.status(500).json({ error: 'Fallo inesperado comprobando la sesión. Vuelve a entrar.' });
  }
}

app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Falta usuario o contraseña.' });

  // Todo el cuerpo bajo un único try/catch: antes solo el login() propio de
  // cofiba.es estaba protegido — un fallo en createSession/saveCredentials
  // (p. ej. no se pudo escribir en disco) se colaba sin capturar y el
  // cliente veía un "Error 500" sin ningún mensaje útil, en vez de un aviso
  // claro.
  try {
    const session = createSession();
    try {
      await login(session, usuario, password);
    } catch (e) {
      return res.status(401).json({ error: e.message });
    }
    const token = crypto.randomUUID();
    sessions.set(token, { session, usuario, createdAt: Date.now() });
    saveCredentials(token, usuario, password);
    res.json({ token });
  } catch (e) {
    console.error('[login] fallo inesperado:', e.message);
    res.status(500).json({ error: 'Fallo inesperado iniciando sesión. Inténtalo de nuevo.' });
  }
});

app.post('/api/logout', requireSession, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  sessions.delete(token);
  deleteCredentials(token);
  res.json({ ok: true });
});

// La lista de categorías es la misma para todos los clientes y casi nunca
// cambia — se cachea en memoria del servidor (global, no por usuario) para no
// re-scrapear acceso.html de cofiba.es en cada visita a la pantalla de
// inicio. Sumado al Cache-Control de abajo (que ahorra el viaje entero desde
// el navegador), volver a "Categorías" es instantáneo.
let categoriasCache = null; // { datos, cuando }
const CACHE_CATEGORIAS_MS = 30 * 60 * 1000;

app.get('/api/categorias', requireSession, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=300');
    if (categoriasCache && Date.now() - categoriasCache.cuando < CACHE_CATEGORIAS_MS) {
      return res.json(categoriasCache.datos);
    }
    const datos = await getCategorias(req.cofiba);
    categoriasCache = { datos, cuando: Date.now() };
    res.json(datos);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/productos', requireSession, async (req, res) => {
  const { categoria, subcategoria, page, pageUrl } = req.query;
  if (!categoria) return res.status(400).json({ error: 'Falta el parámetro categoria.' });
  try {
    const resultado = await getProductosAgrupados(req.cofiba, {
      categoria,
      subcategoria,
      page: Number(page) || 1,
      pageUrl,
    });
    registrarImagenes(resultado.productos);
    resultado.productos = marcarComprados(req.usuario, resultado.productos);
    res.json(resultado);
  } catch (e) {
    res.status(e.code === 'PAGEURL_INVALIDA' ? 400 : 502).json({ error: e.message });
  }
});

app.get('/api/carrito', requireSession, async (req, res) => {
  try {
    const carrito = await getCarrito(req.cofiba);
    // cofiba.es's cart page has no product photos of its own — fill each
    // line in with whatever image was last seen for that articulo while
    // browsing the catalog. Si nunca se vio así (p. ej. un artículo añadido
    // directamente en la web real, no desde nuestra app), se busca en el
    // índice del catálogo entero como segunda opción antes de rendirse.
    carrito.lineas = carrito.lineas.map((l) => {
      const imagen = obtenerImagen(l.codigo) || buscarPorArticulo(l.codigo)?.imagen || null;
      return { ...l, imagen };
    });
    res.json(carrito);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Los datos de la cuenta (CIF, nombre, dirección, contacto...) casi nunca
// cambian — se cachean por usuario un rato para no re-scrapear /mi-cuenta.html
// en cada visita a la pantalla de Categorías.
const CACHE_CUENTA_MS = 30 * 60 * 1000;
const cuentaCache = new Map(); // usuario -> { datos, cuando }

app.get('/api/mi-cuenta', requireSession, async (req, res) => {
  const cacheado = cuentaCache.get(req.usuario);
  if (cacheado && Date.now() - cacheado.cuando < CACHE_CUENTA_MS) {
    return res.json(cacheado.datos);
  }
  try {
    const datos = await getMiCuenta(req.cofiba);
    cuentaCache.set(req.usuario, { datos, cuando: Date.now() });
    res.json(datos);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Cortos y baratos de rastrear (una sola tabla dentro de mi-cuenta.html, ya
// cargada de todas formas) — cache breve solo para no repetir el scrape en
// cada render de la pantalla del carrito.
const CACHE_PEDIDOS_MS = 5 * 60 * 1000;
const pedidosCache = new Map(); // usuario -> { datos, cuando }

app.get('/api/pedidos-pendientes', requireSession, async (req, res) => {
  const cacheado = pedidosCache.get(req.usuario);
  if (cacheado && Date.now() - cacheado.cuando < CACHE_PEDIDOS_MS) {
    return res.json(cacheado.datos);
  }
  try {
    const pedidos = await getPedidosPendientes(req.cofiba);
    pedidosCache.set(req.usuario, { datos: pedidos, cuando: Date.now() });
    res.json(pedidos);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/pedido-copia', requireSession, async (req, res) => {
  const href = (req.query.href || '').toString();
  if (!href) return res.status(400).json({ error: 'Falta href.' });
  try {
    const { contentType, data } = await getCopiaDocumento(req.cofiba, { href });
    res.setHeader('Content-Type', contentType);
    res.send(Buffer.from(data));
  } catch (e) {
    const status = e.code === 'INVALID_DOC_URL' ? 400 : 502;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

app.post('/api/carrito/item', requireSession, async (req, res) => {
  // `categoria`/`origen` ya no hacen falta aquí (anadirAlCarrito solo llama a
  // cestacarrito.php con articulo+cantidad) — Histórico añade productos de
  // /consumo.html que no tienen categoría, así que exigirla rompía ese botón.
  const { articulo, cantidad } = req.body || {};
  if (!articulo || !cantidad) {
    return res.status(400).json({ error: 'Falta articulo o cantidad.' });
  }
  try {
    const result = await anadirAlCarrito(req.cofiba, { articulo, cantidad });
    res.json(result);
  } catch (e) {
    const status = e.code === 'CALIBRATION_NEEDED' ? 501 : 502;
    res.status(status).json({ error: e.message, code: e.code, debugHtml: e.debugHtml });
  }
});

app.put('/api/carrito/item', requireSession, async (req, res) => {
  const { articulo, cantidad } = req.body || {};
  if (!articulo || !cantidad) {
    return res.status(400).json({ error: 'Falta articulo o cantidad.' });
  }
  try {
    res.json(await actualizarCantidadCarrito(req.cofiba, { articulo, cantidad }));
  } catch (e) {
    res.status(502).json({ error: e.message, code: e.code });
  }
});

app.delete('/api/carrito/item/:codigo', requireSession, async (req, res) => {
  try {
    res.json(await eliminarDelCarrito(req.cofiba, { codigo: req.params.codigo }));
  } catch (e) {
    const status = e.code === 'CALIBRATION_NEEDED' ? 501 : 502;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

app.post('/api/carrito/vaciar', requireSession, async (req, res) => {
  try {
    res.json(await vaciarCarrito(req.cofiba));
  } catch (e) {
    const status = e.code === 'CALIBRATION_NEEDED' ? 501 : 502;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

// Places a real, binding order on the client's cofiba.es account — the
// frontend must have already gotten an explicit confirmation from the user
// before calling this (mirrors cofiba.es's own confirmation dialog).
app.post('/api/carrito/finalizar', requireSession, async (req, res) => {
  const { observaciones } = req.body || {};
  try {
    // "Histórico" ya no depende de que registremos nosotros la compra —
    // lee directamente /consumo.html, que cofiba.es actualiza sola en
    // cuanto el pedido se genera.
    const result = await finalizarPedido(req.cofiba, { observaciones });
    res.json(result);
  } catch (e) {
    const status = e.code === 'CALIBRATION_NEEDED' ? 501 : 502;
    res.status(status).json({ error: e.message, code: e.code, debugHtml: e.debugHtml });
  }
});

// Antes esto era nuestro propio historial (solo veía lo comprado a través de
// la app). cofiba.es tiene su propia sección real "Comprados recientemente"
// (/consumo.html) con el historial completo de la cuenta, se haya comprado
// desde donde se haya comprado — se usa esa en su lugar, paginada igual que
// cualquier categoría (?pageUrl= para pedir la siguiente tanda).
//
// OJO: /consumo.html tarda mucho en generarse en el propio servidor de
// cofiba.es (~15-35s medido, frente a <1s de una página de categoría normal
// con un tamaño de respuesta similar) — es lento de por sí en su lado, no
// algo que nuestro scraping cause. Además, confirmado en pruebas: si se le
// pide esa misma página dos veces en paralelo (p. ej. React en desarrollo
// duplica el efecto de carga inicial), cofiba.es entra en una carrera
// interna y una de las dos respuestas vuelve con menos productos de los que
// hay de verdad (o ninguno). Por eso aquí no solo se cachea el resultado un
// rato por usuario+página, sino que además una segunda petición idéntica que
// llegue mientras la primera sigue en curso espera a esa misma promesa en
// vez de disparar una segunda petición real a cofiba.es. La petición real de
// verdad va además dentro de encolarConsumo (consumoQueue.js), que sirve
// para lo mismo pero entre features distintas: compradosStore.js también
// pide páginas de /consumo.html en segundo plano para marcar el catálogo, y
// sin esa cola compartida sus peticiones podrían solaparse con las de aquí.
const CACHE_HISTORICO_MS = 3 * 60 * 1000;
const historicoCache = new Map(); // `${usuario}|${pageUrl||''}` -> { resultado, cuando }
const historicoEnCurso = new Map(); // `${usuario}|${pageUrl||''}` -> Promise

app.get('/api/historico', requireSession, async (req, res) => {
  const pageUrl = req.query.pageUrl || '';
  const clave = `${req.usuario}|${pageUrl}`;
  const cacheado = historicoCache.get(clave);
  if (cacheado && Date.now() - cacheado.cuando < CACHE_HISTORICO_MS) {
    return res.json(cacheado.resultado);
  }
  try {
    let promesa = historicoEnCurso.get(clave);
    if (!promesa) {
      promesa = encolarConsumo(req.usuario, () => getComprasRecientes(req.cofiba, { pageUrl: req.query.pageUrl })).finally(
        () => historicoEnCurso.delete(clave)
      );
      historicoEnCurso.set(clave, promesa);
    }
    const resultado = await promesa;
    registrarImagenes(resultado.productos);
    // Esta página ya está pedida — aprovecharla también para las marcas de
    // "ya comprado" del catálogo, y de paso disparar el recorrido completo
    // en segundo plano (entrar en Histórico es uno de los dos únicos sitios
    // que lo arrancan; el otro es buscar).
    registrarCompras(req.usuario, resultado.productos);
    asegurarComprados(req.usuario, req.cofiba);
    // No merece la pena cachear una respuesta vacía: es casi seguro la
    // carrera descrita arriba, no que la cuenta no tenga compras — así la
    // siguiente petición vuelve a intentarlo de verdad en vez de repetir el
    // vacío durante los próximos minutos.
    if (resultado.productos.length > 0) historicoCache.set(clave, { resultado, cuando: Date.now() });
    res.json(resultado);
  } catch (e) {
    res.status(e.code === 'PAGEURL_INVALIDA' ? 400 : 502).json({ error: e.message });
  }
});

// El buscador propio de cofiba.es (categoria/todas/true?buscar=) no sirve de
// verdad: su plantilla de resultados no manda el nombre del producto en el
// HTML (lo rellena su propio JavaScript, que aquí no se ejecuta). En vez de
// eso, se mantiene un índice del catálogo completo construido recorriendo
// las páginas normales de categoría/subcategoría (esas sí traen el nombre
// bien) — ver indiceStore.js. La primera búsqueda (o la primera después de
// que el índice caduque) dispara la reconstrucción en segundo plano y
// devuelve `construyendo: true` mientras tanto.
app.get('/api/buscar', requireSession, async (req, res) => {
  const termino = (req.query.q || '').toString().trim();
  if (!termino) return res.json({ construyendo: false, resultados: [] });

  if (necesitaConstruir()) iniciarConstruccion(req.cofiba);
  // Buscar es (junto con entrar en Histórico) el único sitio que arranca el
  // rastreo de compras en segundo plano — así las marcas de "ya comprado"
  // se van completando sin que navegar por el catálogo dispare nada pesado.
  asegurarComprados(req.usuario, req.cofiba);

  const st = estadoActual();
  if (st.estado === 'error' && !indiceListo()) {
    return res.json({ construyendo: false, error: st.error, resultados: [] });
  }
  // Aunque el índice siga construyéndose, ya se busca sobre lo indexado
  // hasta ahora — así el usuario tiene resultados útiles en cuanto su
  // categoría se recorre, sin esperar a que termine todo el catálogo.
  res.json({
    construyendo: st.estado === 'construyendo',
    parcial: st.estado === 'construyendo',
    progreso: st.progreso,
    resultados: marcarComprados(req.usuario, buscarEnIndice(termino)),
    totalIndice: st.total,
    actualizado: st.actualizado,
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// In production there's no separate Vite dev server — this same process
// serves the client's built static files too, so the whole app is one
// deployable service on one origin (no CORS/rewrite setup needed on the host).
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Cofiba visor API escuchando en http://localhost:${PORT}`);
});
