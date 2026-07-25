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
  subcategoriasConProductos,
  marcarActividad,
} from './indiceStore.js';
import { asegurarComprados, comprasConocidas, registrarCompras, estadisticasCompras, resumenGlobal } from './compradosStore.js';
import { articulosNuevos } from './novedadesStore.js';
import { registrarPedido, resumenFacturacion } from './pedidosStore.js';
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
    // Para el panel de escritorio: saber quién está "conectado ahora" de
    // verdad (no solo quién tiene un token válido) necesita esto.
    entry.lastSeenAt = Date.now();
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
    // Mismo motivo que en /api/login: esta rama es la re-autenticación
    // silenciosa tras un reinicio del servidor, así que también puede ser
    // el primer momento con una sesión válida desde que arrancó — adelanta
    // el rastreo del índice del catálogo igual que ahí.
    if (necesitaConstruir()) iniciarConstruccion(session);
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
    // El plan gratuito no tiene disco persistente: cada despliegue nuevo
    // (o reinicio) empieza con el índice del catálogo vacío del todo, y
    // antes no se rastreaba hasta que alguien buscaba algo — así que recién
    // desplegado, "Ver más" (Histórico) y las fotos de respaldo del carrito
    // no tenían de dónde salir hasta la primera búsqueda de alguien.
    // Arrancarlo aquí, nada más entrar, adelanta ese primer rastreo en vez
    // de esperar a una acción concreta del cliente.
    if (necesitaConstruir()) iniciarConstruccion(session);
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

// Panel de escritorio (programa aparte, no la PWA de los clientes): su
// propia clave compartida, distinta del login de cada cuenta de cofiba.es
// — esto es información de negocio (quién usa la app, qué se factura a
// través de ella...), no algo que deba poder ver cualquiera que tenga
// usuario y contraseña de un solo cliente.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_TOKEN no configurado en el servidor.' });
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado.' });
  next();
}

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

// cofiba.es solo renueva su catálogo una vez al día (de madrugada) — rehacer
// el scraping de la misma página varias veces en el mismo día no sirve de
// nada salvo para gastar la única CPU del plan gratuito y hacer esperar al
// cliente. Se cachea el resultado del scraping en sí (precios, stock,
// productos — igual para cualquier cuenta) un día entero; lo que SÍ es
// propio de cada usuario (la marca "comprado") se recalcula siempre fresco
// encima, nunca se guarda junto al resto.
const CACHE_PRODUCTOS_MS = 24 * 60 * 60 * 1000;
const productosCache = new Map(); // `${categoria}|${subcategoria||''}|${pageUrl||''}` -> { resultado, cuando }
const productosEnCurso = new Map(); // misma clave -> Promise, para no pedir la misma página dos veces en paralelo

app.get('/api/productos', requireSession, async (req, res) => {
  const { categoria, subcategoria, page, pageUrl } = req.query;
  if (!categoria) return res.status(400).json({ error: 'Falta el parámetro categoria.' });
  const clave = `${categoria}|${subcategoria || ''}|${pageUrl || ''}`;
  try {
    let resultado;
    const cacheado = productosCache.get(clave);
    if (cacheado && Date.now() - cacheado.cuando < CACHE_PRODUCTOS_MS) {
      resultado = cacheado.resultado;
    } else {
      let promesa = productosEnCurso.get(clave);
      if (!promesa) {
        promesa = getProductosAgrupados(req.cofiba, {
          categoria,
          subcategoria,
          page: Number(page) || 1,
          pageUrl,
        }).finally(() => productosEnCurso.delete(clave));
        productosEnCurso.set(clave, promesa);
      }
      resultado = await promesa;
      registrarImagenes(resultado.productos);
      productosCache.set(clave, { resultado, cuando: Date.now() });
    }

    // Antes esto no se llamaba aquí (solo en Buscar/Histórico) para no
    // competir por la única CPU del plan gratuito mientras alguien solo
    // navegaba el catálogo — pero eso dejaba las marcas de "Comprado" sin
    // aparecer nunca si el cliente entraba directo a Productos sin pasar
    // antes por Buscar o Histórico. asegurarComprados no hace nada si ya hay
    // un rastreo en curso o uno reciente, así que llamarlo aquí también es
    // barato y asegura que las marcas siempre acaban apareciendo.
    asegurarComprados(req.usuario, req.cofiba);
    const productos = marcarComprados(req.usuario, resultado.productos);
    let subcategorias = resultado.subcategorias;
    // Quita de los chips las subcategorías que el índice del catálogo ya
    // sabe que no tienen ningún producto — antes se enseñaban todas (vienen
    // tal cual del menú lateral de cofiba.es) y algunas llevaban a una
    // pantalla vacía con solo un botón "Siguiente". Si el índice todavía no
    // tiene datos de esta categoría, subcategoriasConProductos devuelve un
    // Set vacío y no se filtra nada (mejor enseñar de más que ocultar de
    // más). La subcategoría que se está viendo ahora mismo nunca se quita,
    // aunque el índice no la conozca todavía.
    if (subcategorias?.length) {
      const conProductos = subcategoriasConProductos(categoria);
      if (conProductos.size) {
        subcategorias = subcategorias.filter((s) => conProductos.has(s.slug) || s.slug === resultado.grupo?.slug);
      }
    }
    res.json({ ...resultado, productos, subcategorias });
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
    // Totales de ANTES de finalizar (finalizar vacía el carrito) — solo para
    // el registro del panel de escritorio ("lo que factura la app"). Si esto
    // falla, no debe impedir finalizar el pedido de verdad: es un dato
    // secundario, no algo crítico para el cliente.
    let resumenCarrito = null;
    try {
      resumenCarrito = await getCarrito(req.cofiba);
    } catch {
      // ignorado a propósito, ver comentario de arriba
    }

    // "Histórico" ya no depende de que registremos nosotros la compra —
    // lee directamente /consumo.html, que cofiba.es actualiza sola en
    // cuanto el pedido se genera.
    const result = await finalizarPedido(req.cofiba, { observaciones });

    if (resumenCarrito) {
      const total = parseFloat(String(resumenCarrito.totales?.total || '').replace(/\./g, '').replace(',', '.'));
      registrarPedido({
        usuario: req.usuario,
        total: Number.isFinite(total) ? total : null,
        numProductos: resumenCarrito.numProductos,
      });
    }

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
  const forzar = req.query.forzar === '1';
  const clave = `${req.usuario}|${pageUrl}`;
  const cacheado = historicoCache.get(clave);
  if (!forzar && cacheado && Date.now() - cacheado.cuando < CACHE_HISTORICO_MS) {
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
    // /consumo.html (de donde sale el histórico) no trae categoría ni
    // subcategoría de cada producto — solo nombre/precio/foto. Para el botón
    // "Ver en catálogo" hace falta saber a qué subcategoría pertenece cada
    // uno; el índice del catálogo completo ya lo sabe (lo recorrió por sus
    // páginas normales de categoría), así que se rellena desde ahí cuando ya
    // se conoce. Si el índice aún no ha llegado a ese artículo, queda `null`
    // y el botón simplemente no se muestra para esa fila.
    resultado.productos = resultado.productos.map((p) => {
      const indexado = buscarPorArticulo(p.articulo);
      return {
        ...p,
        categoria: indexado?.categoria || null,
        categoriaNombre: indexado?.categoriaNombre || null,
        subcategoria: indexado?.subcategoria || null,
      };
    });
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

// Estadísticas de la propia cuenta: no hay ningún endpoint de "informes" en
// cofiba.es, así que esto se calcula a partir de lo mismo que ya usa
// compradosStore.js para marcar "comprado" en el catálogo (el recorrido de
// fondo de /consumo.html) — solo que ahí se contaba con un Set (sí/no) y
// aquí con un Map (cuántas veces), lo que permite sacar "más comprados" y un
// desglose por categoría sin ninguna petición extra a cofiba.es. Dispara el
// mismo recorrido de fondo que Histórico/Buscar si aún no hay nada — puede
// tardar en completarse la primera vez, así que `completo` indica si las
// cifras son ya definitivas o siguen creciendo.
app.get('/api/estadisticas', requireSession, async (req, res) => {
  asegurarComprados(req.usuario, req.cofiba);
  const stats = estadisticasCompras(req.usuario);
  if (!stats) {
    return res.json({ disponible: false, completo: false });
  }
  const { conteo, completo, actualizado } = stats;

  // Importe = precio actual × veces comprado. Es una aproximación (el
  // histórico no guarda el precio de cada compra en su momento, así que se
  // usa el precio de catálogo de ahora), pero es la única forma de dar una
  // cifra de dinero sin que cofiba.es exponga ese dato en ningún otro sitio.
  const porCategoria = new Map(); // nombre -> { nombre, veces, importe, productos: [] }
  const filas = [];
  let totalLineas = 0;
  let totalImporte = 0;
  for (const [articulo, veces] of conteo.entries()) {
    totalLineas += veces;
    const info = buscarPorArticulo(articulo);
    const categoriaNombre = info?.categoriaNombre || (info?.categoria ? info.categoria.toUpperCase() : 'Sin categoría');
    const precio = parseFloat(String(info?.precioFinal || '').replace(',', '.'));
    const importe = Number.isFinite(precio) ? Math.round(precio * veces * 100) / 100 : null;
    if (importe != null) totalImporte += importe;

    const fila = {
      articulo,
      veces,
      importe,
      nombre: info?.nombre || null,
      referencia: info?.referencia || null,
      precioFinal: info?.precioFinal || null,
      imagen: info?.imagen || null,
      categoriaNombre,
    };
    filas.push(fila);

    let cat = porCategoria.get(categoriaNombre);
    if (!cat) {
      cat = { nombre: categoriaNombre, veces: 0, importe: 0, productos: [] };
      porCategoria.set(categoriaNombre, cat);
    }
    cat.veces += veces;
    if (importe != null) cat.importe += importe;
    cat.productos.push(fila);
  }
  filas.sort((a, b) => b.veces - a.veces);

  // Cada categoría trae ya sus propios productos ordenados de más a menos
  // vendido — así, al tocar una categoría en el cliente, mostrar "sus
  // productos de más a menos vendido" no necesita ninguna petición nueva.
  const categorias = [...porCategoria.values()]
    .map((c) => ({
      ...c,
      importe: Math.round(c.importe * 100) / 100,
      productos: c.productos.slice().sort((a, b) => b.veces - a.veces),
    }))
    .sort((a, b) => b.importe - a.importe);

  res.json({
    disponible: true,
    completo,
    actualizado,
    articulosDistintos: conteo.size,
    totalLineas,
    totalImporte: Math.round(totalImporte * 100) / 100,
    masComprados: filas.slice(0, 15),
    porCategoria: categorias,
  });
});

// Artículos detectados como nuevos en el catálogo en los últimos 3 días
// (ver novedadesStore.js) — no depende del usuario que pregunta, es el
// mismo catálogo general para cualquiera, así que no hace falta ningún
// rastreo por cuenta como en /api/estadisticas.
app.get('/api/novedades', requireSession, (req, res) => {
  const nuevos = articulosNuevos();
  const productos = nuevos
    .map(({ articulo, desde }) => {
      const info = buscarPorArticulo(articulo);
      if (!info) return null;
      return { ...info, desde };
    })
    .filter(Boolean);
  res.json({ productos });
});

// "Conectado ahora" = ha hecho alguna petición autenticada en los últimos 15
// minutos (ver `entry.lastSeenAt` en requireSession) — un token válido sin
// actividad reciente es una pestaña abierta y olvidada, no alguien usando
// la app de verdad ahora mismo.
const CONECTADO_RECIENTE_MS = 15 * 60 * 1000;

// Todo lo que necesita el programa de escritorio en una sola llamada: qué
// cuentas están usando la app ahora mismo, qué se compra más entre todas
// ellas (sumando el histórico de cada una — ver compradosStore.js), y lo
// facturado a través de la propia app (pedidosStore.js, que solo registra
// pedidos que de verdad se finalizaron aquí, no todo el histórico de
// cofiba.es). También el estado del índice del catálogo, útil para saber si
// el servidor sigue "calentando" tras un despliegue.
app.get('/api/admin/estado', requireAdmin, (req, res) => {
  const ahora = Date.now();
  const sesiones = [...sessions.entries()].map(([, s]) => ({
    usuario: s.usuario,
    desde: s.createdAt,
    ultimaActividad: s.lastSeenAt || s.createdAt,
    conectadoAhora: ahora - (s.lastSeenAt || s.createdAt) < CONECTADO_RECIENTE_MS,
  }));

  const { conteoGlobal, porUsuario } = resumenGlobal();
  const masComprados = [...conteoGlobal.entries()]
    .map(([articulo, veces]) => {
      const info = buscarPorArticulo(articulo);
      return {
        articulo,
        veces,
        nombre: info?.nombre || null,
        referencia: info?.referencia || null,
        categoriaNombre: info?.categoriaNombre || null,
        precioFinal: info?.precioFinal || null,
        imagen: info?.imagen || null,
      };
    })
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 30);

  res.json({
    sesiones,
    cuentasConectadasAhora: sesiones.filter((s) => s.conectadoAhora).length,
    cuentasTotales: sesiones.length,
    porCuenta: porUsuario,
    masCompradosGlobal: masComprados,
    facturacion: {
      total: resumenFacturacion(),
      ultimos30Dias: resumenFacturacion({ desde: ahora - 30 * 24 * 60 * 60 * 1000 }),
      ultimos7Dias: resumenFacturacion({ desde: ahora - 7 * 24 * 60 * 60 * 1000 }),
    },
    indiceCatalogo: estadoActual(),
  });
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
