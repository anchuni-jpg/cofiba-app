import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = 'https://www.cofiba.es';
// cofiba.es tiene su propia sección "Comprados recientemente" — la usan tanto
// getComprasRecientes (Histórico) como compradosStore.js (marcar en el
// catálogo qué productos ya se compraron antes); un único sitio donde vive
// la URL evita que se desincronicen si cambia algún día.
export const CONSUMO_URL = `${BASE}/consumo.html`;

// cofiba.es's server does not send its intermediate CA certificate in the TLS
// handshake (only the leaf cert). Browsers paper over this by fetching the
// missing intermediate themselves; Node does not, so plain axios/https fails
// verification with "unable to verify the first certificate". We fix this
// properly (rather than disabling verification) by trusting Node's normal CA
// bundle *plus* the one specific intermediate this site is missing.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cofibaIntermediate = fs.readFileSync(path.join(__dirname, 'cofiba-intermediate.pem'), 'utf8');
// keepAlive reutiliza la misma conexión TCP/TLS entre peticiones a cofiba.es
// en vez de renegociar el handshake cada vez — con lo lenta que es su web
// (sobre todo /consumo.html), ahorrarse ese handshake en cada petición
// sucesiva es una mejora de rendimiento gratis y sin riesgo.
const httpsAgent = new https.Agent({
  ca: [...tls.rootCertificates, cofibaIntermediate],
  keepAlive: true,
  maxSockets: 10,
});

// axios-cookiejar-support refuses to work alongside a custom httpsAgent (needed
// above for the CA fix), so cookies are wired up manually here instead: attach
// the jar's cookie string before each request, store any Set-Cookie after.
export function createSession() {
  const jar = new CookieJar();
  const http = axios.create({
    httpsAgent,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CofibaVisor/1.0)' },
    validateStatus: () => true,
    maxRedirects: 0,
  });

  // cofiba.es serializa en su propio servidor todas las peticiones de una
  // misma cuenta — confirmado en vivo que si dos peticiones de esta misma
  // sesión salen a la vez de verdad (p. ej. el rastreo del catálogo de fondo
  // pidiendo una página de categoría justo cuando el usuario le da a "+" para
  // añadir algo al carrito), una de las dos puede responder 200 con el
  // cuerpo vacío SIN llegar a tener efecto real (el "añadir" se perdía en
  // silencio: la respuesta parecía un éxito pero el artículo nunca aparecía
  // en el carrito de verdad). Como su servidor ya asume que esto no pasa,
  // en vez de fiarnos de que lo maneje bien, se serializa aquí también, del
  // lado del cliente: cada petición de esta sesión espera a que termine la
  // anterior antes de salir, así nunca hay dos peticiones de la misma cuenta
  // realmente en vuelo a la vez.
  let colaFin = Promise.resolve();

  http.interceptors.request.use(async (config) => {
    const miTurno = colaFin;
    let liberar;
    colaFin = new Promise((r) => (liberar = r));
    config.__liberarTurno = liberar;
    await miTurno;

    const url = new URL(config.url, BASE).toString();
    const cookie = await jar.getCookieString(url);
    if (cookie) config.headers.Cookie = cookie;
    return config;
  });

  http.interceptors.response.use(
    async (response) => {
      response.config.__liberarTurno?.();
      const url = new URL(response.config.url, BASE).toString();
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        await Promise.all(setCookie.map((c) => jar.setCookie(c, url).catch(() => {})));
      }
      // Follow redirects ourselves (maxRedirects: 0 above) so cookies set on the
      // redirect response are captured before the next hop is fetched.
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString();
        const method = response.status === 303 ? 'get' : response.config.method;
        return http.request({ ...response.config, url: nextUrl, method, data: method === 'get' ? undefined : response.config.data });
      }
      return response;
    },
    (error) => {
      error.config?.__liberarTurno?.();
      return Promise.reject(error);
    }
  );

  return { jar, http };
}

function absolute(href) {
  if (!href) return null;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

// Finds the <form> wrapping a given field, reading its real action/method/inputs
// instead of hardcoding field names we haven't been able to verify from outside.
function describeForm($, $form, currentUrl) {
  if (!$form || !$form.length) return null;
  const action = absolute($form.attr('action')) || currentUrl;
  const method = ($form.attr('method') || 'POST').toUpperCase();
  const fields = {};
  $form.find('input[name]').each((_, el) => {
    const $el = $(el);
    const type = ($el.attr('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return;
    fields[$el.attr('name')] = $el.attr('value') || '';
  });
  return { action, method, fields };
}

export async function login({ http }, usuario, password) {
  const loginUrl = `${BASE}/identificarse.html`;
  const page1 = await http.get(loginUrl);
  const $ = cheerio.load(page1.data);

  const $form = $('input[type=password]').first().closest('form');
  if (!$form.length) {
    throw new Error('No se encontró el formulario de login en identificarse.html (la web pudo cambiar de estructura).');
  }
  const desc = describeForm($, $form, loginUrl);
  const userField = $form.find('input[type=text], input[type=email]').first().attr('name');
  const passField = $form.find('input[type=password]').first().attr('name');
  if (!userField || !passField) {
    throw new Error('No se pudieron identificar los campos de usuario/contraseña del formulario.');
  }

  const body = new URLSearchParams({ ...desc.fields, [userField]: usuario, [passField]: password });
  const res = await http.post(desc.action, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Sanity check: after login the site should no longer show a password field.
  const $after = cheerio.load(res.data);
  const stillLoggedOut = $after('input[type=password]').length > 0;
  if (stillLoggedOut) {
    throw new Error('Usuario o contraseña incorrectos, o la web cambió el formulario de acceso.');
  }
  return true;
}

export async function getCategorias({ http }) {
  const url = `${BASE}/acceso.html`;
  const res = await http.get(url);
  const $ = cheerio.load(res.data);

  const categorias = [];
  $('a').each((_, el) => {
    const $a = $(el);
    if (!/ver productos/i.test($a.text())) return;
    const href = absolute($a.attr('href'));
    if (!href) return;
    const slugMatch = href.match(/categoria\/([^/]+)\//i);
    const slug = slugMatch ? slugMatch[1] : null;

    // Category name is the nearest preceding heading-ish text in the same card.
    let nombre = $a
      .closest('div,li,article')
      .find('h1,h2,h3,h4,h5,strong')
      .first()
      .text()
      .trim();
    if (!nombre) {
      nombre = $a.prevAll().first().text().trim();
    }
    if (slug) categorias.push({ slug, nombre: nombre || slug, href });
  });

  // De-dupe by slug in case the selector matched more than one node per card.
  const seen = new Set();
  const unicas = categorias.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
  return unicas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

// Confirmed straight from cofiba.es's own dist/js/b2b.js: each product's
// "Añadir al carrito" button carries data-articulo (the real cart item code —
// different from the displayed "Referencia") and data-nlinea (its row index).
// That gives us a precise, structure-independent anchor per product, instead
// of guessing container tags.
const PRODUCT_TEXT_RE =
  /Referencia:\s*(\S+)\s*EAN:\s*(\S+)\s*Marca:\s*(.*?)\s*Und\.\s*de\s*venta:\s*([\d.,]+)\s*PVP:\s*([\d.,]+)\s*€\s*Dtos?:\s*([\d.,]+)\s*%\s*([\d.,]+)\s*€\s*IMPUESTOS NO INCLUIDOS/i;

const NOMBRE_BLOCKLIST = /comprados recientemente|art[ií]culos con existencia|categor[ií]as|^productos$|novedades|cat[aá]logos|promociones/i;

// Walks up from $el looking for the nearest ancestor whose text matches
// `pattern`, regardless of what tag it is — cofiba.es doesn't use a
// consistent container tag for product cards.
function closestByText($, $el, pattern, maxDepth = 10) {
  let $cur = $el;
  for (let i = 0; i < maxDepth; i++) {
    $cur = $cur.parent();
    if (!$cur.length) return null;
    if (pattern.test($cur.text())) return $cur;
  }
  return null;
}

// Confirmed from the category page's own markup: the left-hand category tree
// is a Bootstrap accordion, and each subcategory's button carries its real,
// navigable target directly in onclick="location.href='/marca/todas/
// categoria/{categoria}/{subcategoria}/false'" — top-level category buttons
// have onclick="" (they just expand the accordion), so filtering to buttons
// with a real href here naturally keeps only actual subcategories, and
// matching that href's categoria segment keeps only the ones under the
// categoria we're currently looking at.
function extraerSubcategorias($, categoriaSlug) {
  const subcategorias = [];
  const seen = new Set();
  $('h3.accordion-header button[onclick]').each((_, el) => {
    const onclick = $(el).attr('onclick') || '';
    const m = onclick.match(/location\.href=["']([^"']+)["']/);
    if (!m) return;
    const parts = m[1].match(/\/categoria\/([^/]+)\/([^/]+)\/false/i);
    if (!parts || parts[1] !== categoriaSlug) return;
    const slug = parts[2];
    if (seen.has(slug)) return;
    seen.add(slug);
    subcategorias.push({ slug, nombre: $(el).text().trim() });
  });
  return subcategorias;
}

export async function getProductos({ http }, { categoria, subcategoria, page = 1, pageUrl }) {
  // pageUrl llega del cliente tal cual (es la siguientePagina que nosotros
  // mismos le dimos antes) — pero nada impide mandar otra cosa a mano, y sin
  // esta comprobación el servidor descargaría CUALQUIER URL que le pidan
  // (SSRF: se le podría hacer pedir direcciones internas o de terceros).
  // Solo se siguen URLs que estén de verdad dentro de cofiba.es.
  if (pageUrl) {
    let origen;
    try {
      origen = new URL(pageUrl).origin;
    } catch {
      origen = null;
    }
    if (origen !== BASE) {
      const err = new Error('pageUrl no válida: solo se aceptan páginas de cofiba.es.');
      err.code = 'PAGEURL_INVALIDA';
      throw err;
    }
  }

  // If a real "next page" URL was computed from a previous call, follow that
  // exact URL instead of guessing a query-string scheme cofiba.es may not use.
  const url =
    pageUrl ||
    (subcategoria
      ? `${BASE}/marca/todas/categoria/${categoria}/${subcategoria}/false`
      : `${BASE}/marca/todas/categoria/${categoria}/false`);

  const res = await http.get(url);
  const $ = cheerio.load(res.data);
  const subcategorias = categoria && categoria !== 'todas' ? extraerSubcategorias($, categoria) : [];
  // Exact listing URL each product was seen on — anadirAlCarrito re-fetches it to find the
  // product's buy-form.
  const origenUrl = url;

  // Product thumbnails: walk images and product buttons together in document
  // order, and give each button whichever thumbnail was most recently seen
  // before it. This is robust to stray non-product images anywhere on the
  // page (a header logo pushed a plain positional zip off by one) since it
  // only cares about what's immediately before each button, not a fixed index.
  const imagenPorArticulo = new Map();
  let ultimaImagen = null;
  $('img[src*="BlobData"], button[data-articulo], a[data-articulo]').each((_, el) => {
    const $el = $(el);
    if (el.tagName === 'img') {
      ultimaImagen = absolute($el.attr('src'));
    } else {
      const art = $el.attr('data-articulo');
      if (art) imagenPorArticulo.set(art, ultimaImagen);
    }
  });

  const productos = [];
  $('button[data-articulo], a[data-articulo]').each((_, el) => {
    const $btn = $(el);
    const articulo = $btn.attr('data-articulo');
    const nlinea = $btn.attr('data-nlinea');
    if (!articulo) return;

    const $card = closestByText($, $btn, /Referencia:/i) || $btn.parent();
    const cardText = $card.text().replace(/\s+/g, ' ').trim();
    const m = cardText.match(PRODUCT_TEXT_RE);

    // The product name sits as plain text right before "Referencia:" (e.g.
    // "...Añadir al carrito ABANICO ACRILICO 23CM MALLORCA... Referencia:
    // 152407026..."), not in an alt attribute — pull it from cardText instead
    // of relying on <img alt>, which most products here don't set.
    const refIdx = cardText.search(/Referencia:/i);
    const posibleNombre =
      refIdx > 0
        ? cardText
            .slice(0, refIdx)
            .replace(/.*añadir al carrito/i, '')
            .trim()
        : '';
    const nombreTexto =
      posibleNombre && posibleNombre.length < 120 && !NOMBRE_BLOCKLIST.test(posibleNombre) ? posibleNombre : null;
    const nombreAlt =
      $card
        .find('img')
        .filter((_, img) => !!$(img).attr('alt')?.trim())
        .first()
        .attr('alt')
        ?.trim() || null;
    const referencia = m?.[1] || null;
    const nombre = nombreTexto || nombreAlt || null;
    const imagen = imagenPorArticulo.get(articulo) || null;

    productos.push({
      articulo,
      nlinea: nlinea || null,
      referencia,
      ean: m?.[2] || null,
      marca: m?.[3] || null,
      undVenta: m?.[4] || null,
      pvp: m?.[5] || null,
      dto: m?.[6] || null,
      precioFinal: m?.[7] || null,
      nombre,
      imagen,
      // Página real donde se vio este producto: la página 1 de la categoría
      // solo contiene los <form> de compra de sus propios 12 productos, así
      // que añadir desde páginas interiores fallaba sin esto.
      origen: origenUrl,
    });
  });

  const normalized = $('body').text().replace(/\s+/g, ' ').trim();
  const totalPaginasTexto = normalized.match(/P[aá]gina\s*(?:\d+\s*)?de\s*(\d+)/i)?.[1];

  // Confirmed from b2b.js: pagination navigates via
  // location.href = data-paginacion + pageNumber + "/" — no <a href> links
  // involved at all, so we replicate that directly instead of scraping links.
  const dataPaginacion = $('#numpage').attr('data-paginacion');
  const paginaActual = Number($('#numpage').attr('value') || page || 1);
  const siguientePagina =
    dataPaginacion && paginaActual < Number(totalPaginasTexto || 0)
      ? absolute(`${dataPaginacion}${paginaActual + 1}/`)
      : null;

  return {
    productos,
    subcategorias,
    totalPaginas: totalPaginasTexto ? Number(totalPaginasTexto) : null,
    pagina: paginaActual,
    siguientePagina,
    debug:
      productos.length === 0 || !dataPaginacion
        ? { normalizedSample: normalized.slice(0, 2000) }
        : undefined,
  };
}

const ALFABETICO = (a, b) =>
  (a.nombre || a.referencia || '').localeCompare(b.nombre || b.referencia || '', 'es', { sensitivity: 'base' });

const POR_NOMBRE = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });

// cofiba.es's own page size is small (12 productos/página) and fixed by its
// template, so "más productos por página" means merging several of its real
// pages behind the scenes into one bigger batch, rather than asking it for a
// page size it doesn't support. Keeps following the real siguientePagina
// chain (exactly like a user clicking "Siguiente" repeatedly) until there
// are at least `minimo` productos or the real listing runs out. `seed`
// reuses an already-fetched first page instead of re-requesting it.
async function mergePaginas(session, baseOpts, startPageUrl, minimo, seed = null) {
  let pageUrl = startPageUrl || null;
  let productos = [];
  let totalPaginas = null;
  let subcategorias = null;
  let debug;
  let paginaInicio = null;
  let paginaFin = null;
  let res = seed;

  while (productos.length < minimo) {
    if (!res) res = await getProductos(session, { ...baseOpts, pageUrl });
    if (paginaInicio == null) paginaInicio = res.pagina;
    paginaFin = res.pagina;
    totalPaginas = res.totalPaginas;
    if (subcategorias == null) subcategorias = res.subcategorias;
    productos = productos.concat(res.productos);
    debug = res.debug || debug;
    if (!res.siguientePagina) {
      pageUrl = null;
      break;
    }
    pageUrl = res.siguientePagina;
    res = null;
  }

  productos.sort(ALFABETICO);
  return { productos, subcategorias, paginaInicio, paginaFin, totalPaginas, siguientePagina: pageUrl, debug };
}

// Dentro de una categoría, el listado no usa el orden mezclado del propio
// cofiba.es: recorre las subcategorías por orden alfabético, sirviendo
// exactamente una por respuesta, para que los productos lleguen agrupados en
// vez de desperdigados. Si no se pide una subcategoría concreta, empieza por
// la primera alfabética; en cualquier caso, `siguienteGrupo` dice cuál toca
// cuando se agoten sus páginas — así da igual si llegaste aquí sin elegir
// nada o pulsando directamente un chip de subcategoría, el recorrido
// alfabético completo sigue funcionando igual desde ese punto en adelante.
export async function getProductosAgrupados(session, opts, minimo = 48) {
  const { categoria, subcategoria, pageUrl } = opts;
  const agrupable = categoria && categoria !== 'todas';

  if (!agrupable) {
    return mergePaginas(session, { categoria, subcategoria }, pageUrl, minimo);
  }

  let subs = null;
  let grupoSlug = subcategoria || null;
  if (!grupoSlug) {
    const primera = await getProductos(session, { categoria, page: 1 });
    subs = [...(primera.subcategorias || [])].sort(POR_NOMBRE);
    if (!subs.length) {
      // Categoría sin subcategorías: listado plano de siempre.
      return mergePaginas(session, { categoria }, pageUrl, minimo, pageUrl ? null : primera);
    }
    grupoSlug = subs[0].slug;
  }

  let r = await mergePaginas(session, { categoria, subcategoria: grupoSlug }, pageUrl, minimo);
  const lista = [...((r.subcategorias?.length ? r.subcategorias : subs) || [])].sort(POR_NOMBRE);
  let idx = lista.findIndex((s) => s.slug === grupoSlug);

  // Salta grupos vacíos (subcategorías sin stock ahora mismo) para no servir
  // pantallas en blanco con un botón "Siguiente".
  while (r.productos.length === 0 && idx !== -1 && idx < lista.length - 1) {
    idx += 1;
    grupoSlug = lista[idx].slug;
    r = await mergePaginas(session, { categoria, subcategoria: grupoSlug }, null, minimo);
  }

  const siguienteGrupo = !r.siguientePagina && idx !== -1 && idx < lista.length - 1 ? lista[idx + 1].slug : null;
  return {
    ...r,
    subcategorias: lista,
    grupo: lista[idx] || { slug: grupoSlug, nombre: grupoSlug },
    siguienteGrupo,
  };
}

// cofiba.es tiene su propia sección "Comprados recientemente" (botón real en
// el menú lateral, onclick="location.href='/consumo.html'") — una página
// aparte del carrito, con el historial real de compras de la cuenta,
// paginada exactamente igual que cualquier categoría (mismo data-paginacion,
// mismas tarjetas de producto con nombre/foto/precio completos). No hace
// falta ningún parseo nuevo: pasarle esa URL a getProductos de entrada ya
// funciona (categoria/subcategoria quedan sin usar, pageUrl manda). Esto
// sustituye al historial que llevábamos por nuestra cuenta (solo veía lo
// comprado a través de la app) por el histórico real y completo de la web.
// minimo = 12 (una sola página real por respuesta) a propósito: cada página
// de /consumo.html tarda 15-35s en generarse en el servidor de cofiba.es,
// así que fusionar dos por respuesta doblaba la espera hasta ver algo. Mejor
// enseñar la primera docena en cuanto llegue y que "Ver más" vaya trayendo
// el resto de una en una.
export async function getComprasRecientes(session, { pageUrl } = {}, minimo = 12) {
  return mergePaginas(session, {}, pageUrl || CONSUMO_URL, minimo);
}

// Recorre el catálogo entero por sus páginas normales de categoría/
// subcategoría (modo "false", que sí traen el nombre completo — a
// diferencia del buscador propio de cofiba.es) para construir un índice
// plano que luego se pueda filtrar en memoria. Es una operación pesada (todo
// el catálogo son varios miles de productos repartidos en cientos de
// páginas reales) pensada para ejecutarse una vez y guardarse en caché, no
// en cada búsqueda — ver indiceStore.js.

// Corre `tareas` a través de `worker` con un máximo de `limite` a la vez —
// un pool sencillo de workers que van tirando del mismo array compartido.
async function conLimite(tareas, limite, worker) {
  let i = 0;
  async function siguiente() {
    while (i < tareas.length) {
      const idx = i++;
      await worker(tareas[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, siguiente));
}

// `esperarTurno` (opcional) es una función async que quien llama usa para
// cederle el turno de verdad a la actividad real antes de cada petición —
// probado que cofiba.es serializa TODAS las peticiones de una misma cuenta
// (no solo /consumo.html: hasta las páginas normales de categoría se ponen
// en cola en su servidor si van a la vez), así que un rastreo "concurrente"
// no gana nada en velocidad y sí compite de verdad con quien esté navegando
// en ese momento. indiceStore.esperarInactividad cumple ese papel.
export async function crawlCatalogo(session, esperarTurno, onProgreso) {
  const turno = () => esperarTurno?.() || Promise.resolve();
  const categorias = (await getCategorias(session)).filter((c) => c.slug !== 'todas');
  const indice = [];
  function añadirProducto(item) {
    indice.push(item);
    // Se pasa también el producto recién añadido (no solo el contador) para
    // que quien construye el índice pueda dejarlo buscable de inmediato,
    // sin esperar a que termine todo el catálogo (que puede tardar bastante).
    onProgreso?.(item, indice.length);
  }

  // Primero descubre las subcategorías de cada categoría (pocas peticiones).
  // Guarda la propia respuesta como "semilla" para la categoría plana sin
  // subcategorías, para no volver a pedir esa misma página.
  const tareas = [];
  await conLimite(categorias, 1, async (cat) => {
    await turno();
    const primera = await getProductos(session, { categoria: cat.slug, page: 1 });
    const brutas = primera.subcategorias?.length ? [...primera.subcategorias].sort(POR_NOMBRE) : [null];
    // extraerSubcategorias puede devolver el mismo slug repetido (el árbol de
    // categorías de cofiba.es no siempre es limpio) — sin deduplicar aquí,
    // cada repetido se recorría entero otra vez desde la página 1,
    // multiplicando el trabajo y ralentizando muchísimo el rastreo completo.
    const vistos = new Set();
    const subs = brutas.filter((sub) => {
      const clave = sub?.slug || '';
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
    for (const sub of subs) {
      tareas.push({ cat, sub, seed: sub ? null : primera });
    }
  });

  // Secuencial a propósito: probado que cofiba.es serializa TODAS las
  // peticiones de una misma cuenta en su propio servidor (hasta páginas de
  // categoría normales, no solo /consumo.html), así que pedir varias "a la
  // vez" no adelantaba nada — el servidor de cofiba.es las ponía en cola
  // igualmente — y encima competía con la navegación real del cliente
  // (que también usa esa misma cuenta/sesión) más de lo necesario. Yendo
  // una a una, y cediendo el turno de verdad antes de cada una
  // (esperarTurno), el rastreo deja hueco real a quien esté usando la app.
  await conLimite(tareas, 1, async (t) => {
    let pageUrl = null;
    let r = t.seed;
    do {
      if (!r) {
        await turno();
        r = await getProductos(session, { categoria: t.cat.slug, subcategoria: t.sub?.slug, pageUrl });
      }
      for (const p of r.productos) {
        if (!p.nombre) continue;
        añadirProducto({
          articulo: p.articulo,
          nombre: p.nombre,
          referencia: p.referencia,
          ean: p.ean,
          marca: p.marca,
          precioFinal: p.precioFinal,
          undVenta: p.undVenta,
          imagen: p.imagen,
          categoria: t.cat.slug,
          categoriaNombre: t.cat.nombre,
          subcategoria: t.sub?.slug || null,
          origen: p.origen,
        });
      }
      pageUrl = r.siguientePagina;
      r = null;
    } while (pageUrl);
  });

  return indice;
}

// The cart page renders each line twice (once per responsive breakpoint —
// only one copy is visible at a time, but both exist in the DOM and both
// show up in .text()). Anchored on the labelled "mobile card" copy, which is
// unambiguous regardless of spacing:
// "Código: {codigo} {descripcion}Precio: {precio}€Descuento: {dto}%Cánon: {canon}€Coste: {coste}€Importe: {importe}€"
// When the two copies disagree (seen right after adding an item, one copy
// keeps a stale Importe: 0,00€) we keep whichever shows the larger amount.
const CART_LINE_RE =
  /Código:\s*(\S+)\s*(.*?)\s*Precio:\s*([\d.,]+)€\s*Descuento:\s*([\d.,]+)%\s*Cánon:\s*([\d.,]+)€\s*Coste:\s*([\d.,]+)€\s*Importe:\s*([\d.,]+)€/g;

function parseEsNumber(s) {
  return Number(String(s).replace(/\./g, '').replace(',', '.'));
}

export async function getCarrito({ http }) {
  const url = `${BASE}/mi-compra.html`;
  const res = await http.get(url);
  const $ = cheerio.load(res.data);
  const normalized = $('body').text().replace(/\s+/g, ' ').trim();

  // "Dto. pronto pago"/"Envío" no correspondían a nada real de esta página
  // (confirmado mirando el HTML crudo con un carrito con productos reales:
  // esas etiquetas no existen aquí) — lo que sí hay es el IVA, con el
  // recargo de equivalencia delante cuando aplica ("REC 5,2% IVA 21%"), pero
  // OJO: cofiba.es solo da UN importe combinado para los dos conceptos, no
  // un desglose real. Probado en vivo con varios importes: ese único número
  // coincide siempre exactamente con base×IVA% (nunca con base×(IVA%+REC%)),
  // así que el recargo no se está cobrando aparte de verdad para esta
  // cuenta, aunque la etiqueta lo mencione — se muestra tal cual como IVA del
  // 21%, sin inventar una línea de recargo que en la práctica no se cobra.
  const ivaRecMatch = normalized.match(/(?:REC\s*[\d.,]+%\s*)?IVA\s*([\d.,]+)%\s*([\d.,]+)\s*€/i);
  const iva = ivaRecMatch ? { rate: parseEsNumber(ivaRecMatch[1]), valor: ivaRecMatch[2] } : null;
  const totales = {
    importe: normalized.match(/\bIMPORTE\s*([\d.,]+)\s*€/)?.[1] || null,
    iva,
    total: normalized.match(/\bTOTAL\s*([\d.,]+)\s*€/)?.[1] || null,
  };

  const porCodigo = new Map();
  let match;
  CART_LINE_RE.lastIndex = 0;
  while ((match = CART_LINE_RE.exec(normalized))) {
    const [, codigo, descripcion, precio, dto, canon, coste, importe] = match;
    const existente = porCodigo.get(codigo);
    if (existente && parseEsNumber(existente.importe) >= parseEsNumber(importe)) continue;
    porCodigo.set(codigo, { codigo, descripcion: descripcion.trim(), precio, dto, canon, coste, importe });
  }

  // The real quantity lives in a hidden/number <input>'s value attribute
  // (e.g. id="unidades_lg_1"), which never shows up in .text(). Find it by
  // matching the sibling "articulo_*_N" input whose value is this codigo,
  // same id-suffix convention the cart page's own inline script relies on.
  const $articuloInputs = $('input[id^="articulo_"]');
  const cantidadPorCodigo = new Map();
  $articuloInputs.each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id') || '';
    const m = id.match(/^articulo_(.+)$/);
    if (!m || $el.attr('value') === undefined) return;
    const suffix = m[1];
    const codigoValor = $el.attr('value');
    if (!codigoValor) return;
    const $qty = $(`#unidades_${suffix}`);
    if ($qty.length) {
      cantidadPorCodigo.set(codigoValor, $qty.attr('value') || $qty.val());
    }
  });

  // /mi-compra.html itself has no per-line product photos in its HTML — its
  // only <img src="BlobData/..."> are the site's own header logo and footer
  // banner (confirmed live: a cart with one real line still only showed
  // those same two images, unrelated to the product). Trying to scrape one
  // from this page always ends up pointing every line at whatever stray
  // image happens to be nearby, which is exactly the "todas las líneas
  // muestran la misma foto" bug. Images are looked up by the caller instead,
  // from whatever was last seen for that articulo while browsing the
  // catalog (see imagenStore.js) — cofiba.es just doesn't offer them here.
  const lineas = [...porCodigo.values()].map((linea) => ({
    ...linea,
    imagen: null,
    cantidad: cantidadPorCodigo.get(linea.codigo) || null,
  }));

  // For debugging, anchor the sample on the actual cart content ("Tu pedido")
  // instead of the start of the page — the page opens with a huge category
  // sidebar that was drowning out the real cart rows in the debug output.
  const anchorIdx = normalized.search(/Tu pedido|CÓDIGO|IMPORTE STOCK/i);
  const sampleStart = anchorIdx >= 0 ? Math.max(0, anchorIdx - 50) : 0;

  return {
    lineas,
    totales,
    numProductos: lineas.length,
    debug: lineas.length === 0 ? { normalizedSample: normalized.slice(sampleStart, sampleStart + 3000) } : undefined,
  };
}

// /mi-cuenta.html tiene tres paneles reales (confirmado mirando el HTML
// crudo): "Datos fiscales", "Información de contacto" y "Datos financieros"
// (esta última con cuenta bancaria/línea de crédito — de momento no se
// expone, es más de lo que hace falta para un vistazo rápido de quién está
// logeado). Cada panel es una lista de <p><b>Etiqueta:</b> valor</p>, así
// que se devuelven tal cual como pares etiqueta→valor en vez de inventar
// nombres de campo en inglés — así se ve siempre exactamente lo que pone la
// propia cofiba.es, aunque cambie algún texto con el tiempo.
function extraerPanel($, tituloPanel) {
  const datos = {};
  $('.panel').each((_, panel) => {
    const $panel = $(panel);
    const titulo = $panel.find('.panel-heading h4').first().text().trim();
    if (titulo.toLowerCase() !== tituloPanel.toLowerCase()) return;
    $panel.find('.panel-body p').each((_, p) => {
      const $p = $(p);
      const etiqueta = $p.find('b').first().text().replace(':', '').trim();
      if (!etiqueta) return;
      const $clone = $p.clone();
      $clone.find('b').remove();
      // Los <br> (p. ej. entre la calle y el CP/población en "Dirección") se
      // pierden al leer .text() — sin esto, "CIUDAD DE REUS 19, SALOU" y
      // "43724 - TARRAGONA" quedaban pegados sin espacio entre medio.
      $clone.find('br').replaceWith(' ');
      datos[etiqueta] = $clone.text().replace(/\s+/g, ' ').trim() || null;
    });
  });
  return datos;
}

export async function getMiCuenta({ http }) {
  const res = await http.get(`${BASE}/mi-cuenta.html`);
  const $ = cheerio.load(res.data);
  return {
    datosFiscales: extraerPanel($, 'Datos fiscales'),
    contacto: extraerPanel($, 'Información de contacto'),
  };
}

// mi-cuenta.html tiene, debajo de los datos fiscales, una fila de pestañas
// (Presupuestos / Pedidos pendientes / Albaranes / Facturas / Efectos) — las
// cinco vienen ya en el HTML estático (Bootstrap solo las muestra/oculta con
// CSS, cheerio las ve todas), cada una con su propia tabla. Solo se lee
// "Pedidos pendientes" (#pills-pedidos): es la que de verdad corresponde a
// "copias de pedido" — cada fila trae un enlace de descarga a
// /visor.php?...&tipo=ped&id=... que devuelve el PDF real de ese pedido.
// "DD/MM/AAAA" tal cual la da cofiba.es — Date.parse no la entiende bien
// (la confunde con MM/DD), así que se parsea a mano para poder ordenar por
// fecha de verdad y no por el texto (que dejaría "04/03" antes que "20/03"
// pero también antes que "04/12", por ejemplo).
function parsearFechaEs(fecha) {
  const [d, m, y] = (fecha || '').split('/').map(Number);
  if (!d || !m || !y) return 0;
  return new Date(y, m - 1, d).getTime();
}

export async function getPedidosPendientes({ http }) {
  const res = await http.get(`${BASE}/mi-cuenta.html`);
  const $ = cheerio.load(res.data);
  const pedidos = [];
  $('#pills-pedidos table tbody tr').each((_, tr) => {
    const $tds = $(tr).find('td');
    if ($tds.length < 4) return;
    const numero = $tds.eq(0).text().trim();
    const fecha = $tds.eq(1).text().trim();
    const importe = $tds.eq(2).text().replace(/[^\d.,]/g, '').trim();
    const href = $tds.eq(3).find('a').attr('href') || null;
    if (numero && href) pedidos.push({ numero, fecha, importe, href });
  });
  // Los más nuevos primero — cofiba.es los da en el orden de su propia
  // tabla, que no siempre es cronológico.
  pedidos.sort((a, b) => parsearFechaEs(b.fecha) - parsearFechaEs(a.fecha));
  return pedidos;
}

// El enlace de descarga de cada pedido (y de albaranes/facturas, con la
// misma pinta) apunta a visor.php con parámetros de la sesión de cofiba.es —
// el navegador del cliente no tiene esa sesión (solo la tiene este backend),
// así que hay que traerse el PDF aquí y reenviarlo, no enlazar directo.
export async function getCopiaDocumento({ http }, { href }) {
  const url = new URL(href, BASE);
  // Solo se permite reenviar visor.php: es un proxy autenticado hacia
  // cofiba.es, así que limitar la ruta evita que se use para pedir
  // cualquier otra cosa de su web con nuestra sesión.
  if (url.origin !== BASE || url.pathname !== '/visor.php') {
    const err = new Error('Enlace de documento no válido.');
    err.code = 'INVALID_DOC_URL';
    throw err;
  }
  const res = await http.get(url.toString(), { responseType: 'arraybuffer' });
  if (res.status >= 400) {
    const err = new Error(`La web respondió con error ${res.status} al pedir el documento.`);
    err.code = 'DOC_FAILED';
    throw err;
  }
  return { contentType: res.headers['content-type'] || 'application/pdf', data: res.data };
}

// Used to submit the catalog's whole "Añadir al carrito" form first, then a
// separate call to fix the price (see git history if this ever needs
// resurrecting) — but that always left TWO real, permanent rows for the
// same articulo in the cart, one an eternal 0,00€ ghost the first form-post
// creates and one with the real price from the second call. Cofiba.es never
// merges them. Confirmed live that /forms/cestacarrito.php alone — the same
// call actualizarCantidadCarrito already uses for quantity changes — adds a
// brand-new articulo just fine, with the correct price, as a single clean
// row. So adding and updating quantity are now exactly the same operation;
// no more need to find the product's own catalog page/button/form at all.
// La app cachea listados de productos (localStorage/IndexedDB en el
// cliente, caché en memoria del servidor) para ir rápido — pero eso significa
// que se puede intentar añadir un artículo que YA NO existe de verdad en
// cofiba.es (dado de baja, referencia cambiada...). cestacarrito.php responde
// 200 igual en ese caso (confirmado en vivo: cuerpo vacío, sin error), así
// que un simple status<400 no basta para saber si de verdad se añadió — hay
// que comprobar el carrito real después y, si el artículo no aparece,
// avisar en vez de dar un falso éxito.
export async function anadirAlCarrito({ http }, { articulo, cantidad }) {
  await actualizarCantidadCarrito({ http }, { articulo, cantidad });
  const carrito = await getCarrito({ http });
  const linea = carrito.lineas.find((l) => l.codigo === articulo);
  if (!linea || !(Number(linea.cantidad) > 0)) {
    const err = new Error('Este producto ya no está disponible en cofiba.es — no se ha añadido al carrito.');
    err.code = 'ARTICULO_NO_DISPONIBLE';
    throw err;
  }
  return { ok: true };
}

// Same "set the real quantity" endpoint used internally by anadirAlCarrito,
// exposed on its own so the cart screen can change quantities in place.
export async function actualizarCantidadCarrito({ http }, { articulo, cantidad }) {
  const res = await http.post(
    `${BASE}/forms/cestacarrito.php`,
    new URLSearchParams({ tipo: 'C', unidades: String(cantidad), articulo }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/mi-compra.html`,
      },
    }
  );
  if (res.status >= 400) {
    const err = new Error(`La web respondió con error ${res.status} al actualizar la cantidad.`);
    err.code = 'UPDATE_FAILED';
    throw err;
  }
  return { ok: true };
}

// Confirmed from b2b.js: the "eliminar producto" (.eliminarlineacarro) button
// serializes ITS enclosing form (a small per-row form, same pattern as the
// catalog's add-to-cart button) and posts that to /forms/carrito.php.
export async function eliminarDelCarrito({ http }, { codigo }) {
  const url = `${BASE}/mi-compra.html`;
  const res = await http.get(url);
  const $ = cheerio.load(res.data);

  const $btn = $('.eliminarlineacarro')
    .filter((_, el) => $(el).closest('tr').text().includes(codigo))
    .first();
  if (!$btn.length) {
    const err = new Error(`CALIBRATION_NEEDED: no se encontró el botón de eliminar para "${codigo}" en el carrito.`);
    err.code = 'CALIBRATION_NEEDED';
    throw err;
  }
  const $form = $btn.closest('form');
  const desc = describeForm($, $form, url);
  const delRes = await http.post(`${BASE}/forms/carrito.php`, new URLSearchParams(desc.fields).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: url,
    },
  });
  if (delRes.status >= 400) {
    const err = new Error(`La web respondió con error ${delRes.status} al eliminar el producto.`);
    err.code = 'DELETE_FAILED';
    throw err;
  }
  return { ok: true };
}

// Confirmed from b2b.js: "#vaciarcesta" also just serializes its enclosing
// form and posts it to /forms/carrito.php (a hidden field there marks it as
// the "empty everything" action, same endpoint as add/remove).
export async function vaciarCarrito({ http }) {
  const url = `${BASE}/mi-compra.html`;
  const res = await http.get(url);
  const $ = cheerio.load(res.data);

  const $btn = $('#vaciarcesta').first();
  if (!$btn.length) {
    const err = new Error('CALIBRATION_NEEDED: no se encontró el botón "Vaciar el carrito" en la página.');
    err.code = 'CALIBRATION_NEEDED';
    throw err;
  }
  const $form = $btn.closest('form');
  const desc = describeForm($, $form, url);
  const vaciarRes = await http.post(`${BASE}/forms/carrito.php`, new URLSearchParams(desc.fields).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: url,
    },
  });
  if (vaciarRes.status >= 400) {
    const err = new Error(`La web respondió con error ${vaciarRes.status} al vaciar el carrito.`);
    err.code = 'EMPTY_FAILED';
    throw err;
  }
  return { ok: true };
}

// Confirmed from b2b.js (#generarpedido / #generarpedido_top): places the
// real order — POSTs the cart form plus an "observaciones" field to
// /forms/pedido.php. This is a genuine, binding order against the client's
// real account: the frontend must get explicit confirmation before calling
// this, exactly like cofiba.es's own "¿Estás seguro de generar el pedido?".
export async function finalizarPedido({ http }, { observaciones = '' }) {
  const url = `${BASE}/mi-compra.html`;
  const res = await http.get(url);
  const $ = cheerio.load(res.data);

  const $btn = $('#generarpedido, #generarpedido_top').first();
  if (!$btn.length) {
    const err = new Error('CALIBRATION_NEEDED: no se encontró el botón "Finalizar pedido" en la página.');
    err.code = 'CALIBRATION_NEEDED';
    throw err;
  }
  const $form = $btn.closest('form');
  const desc = describeForm($, $form, url);
  const body = new URLSearchParams({ ...desc.fields, observaciones });
  const pedidoRes = await http.post(`${BASE}/forms/pedido.php`, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: url,
    },
  });
  if (pedidoRes.status >= 400) {
    const err = new Error(`La web respondió con error ${pedidoRes.status} al generar el pedido.`);
    err.code = 'ORDER_FAILED';
    err.debugHtml = typeof pedidoRes.data === 'string' ? pedidoRes.data.slice(0, 1000) : JSON.stringify(pedidoRes.data);
    throw err;
  }
  return { ok: true, respuesta: pedidoRes.data };
}
