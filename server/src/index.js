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
import { saveCredentials, loadCredentials, deleteCredentials } from './credentialStore.js';
import { registrarCategoria, registrarCompra, obtenerHistorico } from './historialStore.js';

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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
  const { categoria, subcategoria, page, q, pageUrl } = req.query;
  if (!categoria) return res.status(400).json({ error: 'Falta el parámetro categoria.' });
  try {
    res.json(await getProductosAgrupados(req.cofiba, { categoria, subcategoria, page: Number(page) || 1, query: q, pageUrl }));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/carrito', requireSession, async (req, res) => {
  try {
    res.json(await getCarrito(req.cofiba));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/carrito/item', requireSession, async (req, res) => {
  const { categoria, articulo, cantidad } = req.body || {};
  if (!categoria || !articulo || !cantidad) {
    return res.status(400).json({ error: 'Falta categoria, articulo o cantidad.' });
  }
  try {
    const result = await anadirAlCarrito(req.cofiba, { categoria, articulo, cantidad });
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
