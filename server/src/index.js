import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession,
  login,
  getCategorias,
  getProductosAgrupados,
  getCarrito,
  anadirAlCarrito,
  actualizarCantidadCarrito,
  eliminarDelCarrito,
  vaciarCarrito,
  finalizarPedido,
} from './cofibaClient.js';
import { saveCredentials, loadCredentials, deleteCredentials, obtenerCredencialCualquiera } from './credentialStore.js';
import { registrarCategoria, registrarCompra, obtenerHistorico } from './historialStore.js';
import { registrarImagenes, obtenerImagen } from './imagenStore.js';
import {
  cargarDeDisco,
  estadoActual,
  indiceListo,
  necesitaConstruir,
  iniciarConstruccion,
  buscarEnIndice,
  marcarActividad,
} from './indiceStore.js';

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// El rastreo del catálogo se frena solo cuando alguien está usando la app de
// verdad (ver indiceStore.js) — esto es lo que le avisa de cuándo.
app.use((req, _res, next) => {
  marcarActividad();
  next();
});

// Recupera el índice de búsqueda de disco si ya se construyó antes (evita
// reconstruir todo el catálogo en cada reinicio de `node --watch` durante
// desarrollo, y en cada arranque normal del servidor).
cargarDeDisco();

// Indexa en cuanto arranca el servidor, no solo cuando alguien busca algo
// por primera vez — así el buscador está listo (o al menos avanzando) desde
// el principio. Hace falta una sesión autenticada para hablar con
// cofiba.es; se reutiliza cualquier credencial ya guardada de un login
// anterior (el índice es del catálogo general, no de un cliente concreto).
// Si el servidor nunca ha visto un login (instalación nueva del todo), esto
// no puede hacer nada todavía — arrancarConstruccionSiHaceFalta() se vuelve
// a intentar justo después del primer login real, más abajo.
async function arrancarConstruccionSiHaceFalta() {
  if (!necesitaConstruir()) return;
  const creds = obtenerCredencialCualquiera();
  if (!creds) return;
  try {
    const session = createSession();
    await login(session, creds.usuario, creds.password);
    iniciarConstruccion(session);
  } catch (e) {
    console.error('[indice] no se pudo autenticar para indexar al arrancar:', e.message);
  }
}
arrancarConstruccionSiHaceFalta();

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
}

app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Falta usuario o contraseña.' });

  const session = createSession();
  try {
    await login(session, usuario, password);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { session, usuario, createdAt: Date.now() });
  saveCredentials(token, usuario, password);
  // Cubre el caso de instalación nueva del todo: al arrancar el servidor no
  // había ninguna credencial guardada con la que autenticarse para indexar,
  // pero ya que alguien acaba de entrar, se reutiliza esta misma sesión.
  if (necesitaConstruir()) iniciarConstruccion(session);
  res.json({ token });
});

app.post('/api/logout', requireSession, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  sessions.delete(token);
  deleteCredentials(token);
  res.json({ ok: true });
});

app.get('/api/categorias', requireSession, async (req, res) => {
  try {
    res.json(await getCategorias(req.cofiba));
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
    res.json(resultado);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/carrito', requireSession, async (req, res) => {
  try {
    const carrito = await getCarrito(req.cofiba);
    // cofiba.es's cart page has no product photos of its own — fill each
    // line in with whatever image was last seen for that articulo while
    // browsing the catalog.
    carrito.lineas = carrito.lineas.map((l) => ({ ...l, imagen: obtenerImagen(l.codigo) }));
    res.json(carrito);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/carrito/item', requireSession, async (req, res) => {
  const { categoria, articulo, cantidad, origen } = req.body || {};
  if (!categoria || !articulo || !cantidad) {
    return res.status(400).json({ error: 'Falta categoria, articulo o cantidad.' });
  }
  try {
    const result = await anadirAlCarrito(req.cofiba, { categoria, articulo, cantidad, origen });
    registrarCategoria(req.usuario, articulo, categoria);
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
    // Snapshot the cart before submitting the order, so "histórico de
    // productos comprados" reflects what was actually ordered even though
    // finalizarPedido's own response doesn't itemize the lines.
    const carritoAntes = await getCarrito(req.cofiba).catch(() => null);
    const result = await finalizarPedido(req.cofiba, { observaciones });
    if (carritoAntes?.lineas?.length) registrarCompra(req.usuario, carritoAntes.lineas);
    res.json(result);
  } catch (e) {
    const status = e.code === 'CALIBRATION_NEEDED' ? 501 : 502;
    res.status(status).json({ error: e.message, code: e.code, debugHtml: e.debugHtml });
  }
});

app.get('/api/historico', requireSession, (req, res) => {
  res.json(obtenerHistorico(req.usuario));
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
    resultados: buscarEnIndice(termino),
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
