import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = 'https://www.cofiba.es';

// cofiba.es's server does not send its intermediate CA certificate in the TLS
// handshake (only the leaf cert). Browsers paper over this by fetching the
// missing intermediate themselves; Node does not, so plain axios/https fails
// verification with "unable to verify the first certificate". We fix this
// properly (rather than disabling verification) by trusting Node's normal CA
// bundle *plus* the one specific intermediate this site is missing.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cofibaIntermediate = fs.readFileSync(path.join(__dirname, 'cofiba-intermediate.pem'), 'utf8');
const httpsAgent = new https.Agent({
  ca: [...tls.rootCertificates, cofibaIntermediate],
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

  http.interceptors.request.use(async (config) => {
    const url = new URL(config.url, BASE).toString();
    const cookie = await jar.getCookieString(url);
    if (cookie) config.headers.Cookie = cookie;
    return config;
  });

  http.interceptors.response.use(async (response) => {
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
  });

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

// Recorre el catálogo entero por sus páginas normales de categoría/
// subcategoría (modo "false", que sí traen el nombre completo — a
// diferencia del buscador propio de cofiba.es) para construir un índice
// plano que luego se pueda filtrar en memoria. Es una operación pesada (todo
// el catálogo son varios miles de productos repartidos en cientos de
// páginas reales) pensada para ejecutarse una vez y guardarse en caché, no
// en cada búsqueda — ver indiceStore.js. Una pequeña pausa entre peticiones
// evita machacar el servidor de cofiba.es con cientos de peticiones seguidas.
function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

export async function crawlCatalogo(session, onProgreso) {
  const categorias = (await getCategorias(session)).filter((c) => c.slug !== 'todas');
  const indice = [];
  function añadirProducto(item) {
    indice.push(item);
    // Se pasa también el producto recién añadido (no solo el contador) para
    // que quien construye el índice pueda dejarlo buscable de inmediato,
    // sin esperar a que termine todo el catálogo (que puede tardar bastante).
    onProgreso?.(item, indice.length);
  }

  // Primero descubre las subcategorías de cada categoría (pocas peticiones,
  // rápido). Guarda la propia respuesta como "semilla" para la categoría
  // plana sin subcategorías, para no volver a pedir esa misma página.
  const tareas = [];
  await conLimite(categorias, 4, async (cat) => {
    const primera = await getProductos(session, { categoria: cat.slug, page: 1 });
    await esperar(120);
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

  // Cada subcategoría recorre sus propias páginas en cadena (siguientePagina
  // depende de la anterior), pero varias subcategorías/categorías distintas
  // se hacen a la vez — cofiba.es aguanta bien unas pocas peticiones en
  // paralelo, y así el primer índice tarda minutos en vez de más de una
  // hora yendo petición a petición.
  await conLimite(tareas, 4, async (t) => {
    let pageUrl = null;
    let r = t.seed;
    do {
      if (!r) {
        r = await getProductos(session, { categoria: t.cat.slug, subcategoria: t.sub?.slug, pageUrl });
        await esperar(120);
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

  const totales = {
    importe: normalized.match(/\bIMPORTE\s*([\d.,]+)\s*€/)?.[1] || null,
    descuentoProntoPago: normalized.match(/pronto pago\s*-\s*([\d.,]+)\s*€/i)?.[1] || null,
    envio: normalized.match(/GASTOS DE ENV[IÍ]O\s*([\d.,]+)\s*€/i)?.[1] || null,
    baseImponible: normalized.match(/Base imponible[^0-9]*([\d.,]+)\s*€/i)?.[1] || null,
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

// The simple "accion=A&articulo=X&unidades=N" shortcut (modelled on the
// site's own "añadir por código" feature) does register the SKU — cofiba.es
// confirms with a real "Añadido a la cesta!" message and an incrementing
// total_carrito — but the line then shows Importe: 0,00€ in /mi-compra.html.
// The catalog's own "Añadir al carrito" button instead submits the *whole
// form* around it (see #buyNormal in b2b.js: `form.serialize()`), which
// carries extra hidden fields (multiplo/pvp/existencia) this shortcut skips
// and which turn out to be required for the price to actually register. So
// we replicate that exactly: fetch the category page, find this product's
// real button via its data-articulo (now a precise, confirmed anchor), grab
// its enclosing form, and submit all of it with the quantity field set.
export async function anadirAlCarrito({ http }, { categoria, articulo, cantidad, origen }) {
  // Re-fetch the exact listing page the product was seen on: category page 1
  // only contains the buy-forms of its own 12 products, so adds from deeper
  // pages or subcategory listings failed with CALIBRATION_NEEDED before.
  const catUrl = origen && origen.startsWith(BASE) ? origen : `${BASE}/marca/todas/categoria/${categoria}/false`;
  const catRes = await http.get(catUrl);
  const $ = cheerio.load(catRes.data);

  const $btn = $(`[data-articulo="${articulo}"]`).first();
  const $form = $btn.closest('form');
  if (!$btn.length || !$form.length) {
    const err = new Error(
      `CALIBRATION_NEEDED: ${
        !$btn.length
          ? `no se encontró ningún elemento con data-articulo="${articulo}" en la categoría "${categoria}"`
          : 'se encontró el botón pero no hay un <form> por encima en el HTML'
      }.`
    );
    err.code = 'CALIBRATION_NEEDED';
    throw err;
  }

  // The form's own action="#" is a placeholder — b2b.js's #buyNormal handler
  // ignores it and always POSTs to /forms/carrito.php via AJAX, so we do too.
  const desc = describeForm($, $form, catUrl);
  const qtyFieldName = $form
    .find('input')
    .filter((_, el) => /unidad/i.test($(el).attr('id') || '') || /unidad/i.test($(el).attr('name') || ''))
    .first()
    .attr('name');
  const body = new URLSearchParams({ ...desc.fields, ...(qtyFieldName ? { [qtyFieldName]: String(cantidad) } : {}) });

  const addRes = await http.post(`${BASE}/forms/carrito.php`, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: catUrl,
    },
  });
  console.log('[anadirAlCarrito] action:', desc.action, 'body:', body.toString());
  console.log('[anadirAlCarrito] status:', addRes.status, 'respuesta:', JSON.stringify(addRes.data).slice(0, 500));
  if (addRes.status >= 400) {
    const err = new Error(`La web respondió con error ${addRes.status} al intentar añadir el producto.`);
    err.code = 'ADD_FAILED';
    err.debugHtml = typeof addRes.data === 'string' ? addRes.data.slice(0, 1000) : JSON.stringify(addRes.data);
    throw err;
  }

  // Adding the SKU alone leaves its cart line priced at 0 — /mi-compra.html's
  // own inline script shows the *quantity input's change handler* is what
  // actually commits the priced quantity, via a second, separate endpoint:
  //   POST /forms/cestacarrito.php   body: tipo=C&unidades=N&articulo=X
  // We replicate that here so the line has a real Importe without requiring
  // the user to manually retype the quantity on the cart page.
  const fijarRes = await http.post(
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
  console.log(
    '[anadirAlCarrito] cestacarrito status:',
    fijarRes.status,
    'respuesta:',
    typeof fijarRes.data === 'string' ? fijarRes.data.slice(0, 300) : JSON.stringify(fijarRes.data).slice(0, 300)
  );

  return { ok: true, respuesta: addRes.data };
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
