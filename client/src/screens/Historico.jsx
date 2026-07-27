import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getCache } from '../localCache.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';

// Duplica formatoCaja de Productos.jsx/Busqueda.jsx — una línea, no vale la
// pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Duplica nivelStock de Productos.jsx — 10 cajas o más: "STOCK" en verde,
// sin número; por debajo: "STOCK BAJO" en el color de aviso.
function nivelStock(stock, undVenta) {
  if (!Number.isFinite(stock)) return null;
  const unidadesPorCaja = parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
  const cajas = stock / unidadesPorCaja;
  if (cajas >= 10) return { texto: 'STOCK', bajo: false };
  return cajas <= 0 ? { texto: 'AGOTADO', bajo: true } : { texto: 'STOCK BAJO', bajo: true };
}

// Insensible a acentos/mayúsculas — duplica normalizar() de indiceStore.js
// del lado del servidor, para filtrar aquí lo que ya se cargó sin ir y
// volver al servidor por cada tecla.
function normalizar(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const TANDA = 20;

export default function Historico({
  onCartChanged,
  codigosEnCarrito,
  codigosSesion,
  onIrACategoria,
  islaFiltro,
  vistaColumnas,
  onCambiarVista,
}) {
  const [filtro, setFiltro] = useState('');
  // Esto ya no es un historial que llevemos nosotros — lee directamente la
  // sección real "Comprados recientemente" de cofiba.es (/consumo.html), así
  // que refleja TODO lo comprado en la cuenta, no solo lo hecho desde la app.
  //
  // `paginas[i]` guarda los productos de la página real i-ésima. Se rellena
  // por posición (nunca se concatena a ciegas) para que aplicar la misma
  // página dos veces —una vez desde la caché local y otra con la respuesta
  // de verdad— sustituya en vez de duplicar. El recorrido de TODAS las
  // páginas se dispara solo con abrir la pestaña, sin esperar a que se pulse
  // ningún botón — "Ver más" solo revela más de lo que ya se ha traído (20
  // en 20, como en Búsqueda), nunca dispara una petición nueva por sí mismo.
  const [paginas, setPaginas] = useState([]);
  const [totalPaginas, setTotalPaginas] = useState(null);
  const [paginasCargadas, setPaginasCargadas] = useState(0);
  const [cargandoTodo, setCargandoTodo] = useState(true);
  const [visibles, setVisibles] = useState(TANDA);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  // Artículos que cofiba.es acaba de rechazar al intentar añadirlos (ver
  // ARTICULO_NO_DISPONIBLE en el servidor) — el histórico en sí no los
  // esconde (es un hecho pasado real), pero deja de ofrecer repetir su
  // compra hasta que vuelva a estar disponible.
  const [noDisponibles, setNoDisponibles] = useState(new Set());
  const [zoomProducto, setZoomProducto] = useState(null);
  // "También te puede interesar" (afinidad por subcategoría + popularidad
  // global) — mismo patrón que Productos.jsx/Busqueda.jsx, se pide solo al
  // abrir la ficha, no para toda la lista.
  const [relacionados, setRelacionados] = useState(null);
  useEffect(() => {
    if (!zoomProducto) {
      setRelacionados(null);
      return;
    }
    let cancelado = false;
    setRelacionados(null);
    api
      .relacionados(zoomProducto.articulo)
      .then((data) => {
        if (!cancelado) setRelacionados(data.productos || []);
      })
      .catch(() => {
        if (!cancelado) setRelacionados([]);
      });
    return () => {
      cancelado = true;
    };
  }, [zoomProducto]);
  // Cada llamada a recorrerTodo (al montar, o al pulsar "Actualizar") saca un
  // número nuevo; una llamada en curso se sabe superada (y deja de tocar
  // estado) en cuanto ve que ya no es la más reciente — así pulsar
  // "Actualizar" mientras el recorrido automático seguía en marcha no acaba
  // con dos recorridos escribiendo a la vez.
  const recorridoIdRef = useRef(0);

  const productos = paginas.flat();

  // Reconstruye al instante (sin red) todo lo que ya se había recorrido en
  // este dispositivo, encadenando la caché por su propio siguientePagina —
  // así reabrir Histórico pinta algo de inmediato en vez de una pantalla en
  // blanco mientras se confirma que sigue igual.
  async function reconstruirDesdeCache() {
    const paginasCache = [];
    let totalPaginasCache = null;
    let pageUrl = null;
    do {
      // "v2": mismo motivo que en api.js#historicoCached — clave nueva para
      // no quedarse atascado en una caché completa de antes de que existiera
      // el campo "categoria" (el botón "Ver más").
      const cacheado = await getCache(`historico:v2:${pageUrl || ''}`);
      if (!cacheado) break;
      paginasCache.push(cacheado.productos);
      totalPaginasCache = cacheado.totalPaginas;
      pageUrl = cacheado.siguientePagina || null;
    } while (pageUrl);
    return { paginasCache, totalPaginasCache, siguientePageUrl: pageUrl };
  }

  // Recorre TODO el histórico real, de la primera página en adelante. Solo
  // el botón "Actualizar" fuerza (forzar=1, salta la caché de 3 minutos del
  // servidor) — al entrar en la pestaña normalmente NO se fuerza nada: si ya
  // se recorrió hace poco, cada página sale de la caché del servidor casi al
  // instante, y si Cofiba.es no ha cambiado nada no hay motivo para volver a
  // pedirlo todo desde cero cada vez (antes SÍ forzaba siempre, y eso era
  // justo lo que dejaba el histórico "buscando todo el rato" compitiendo con
  // la navegación real del catálogo, que comparte la misma cuenta/cola de
  // cofiba.es).
  function recorrerTodo({ mostrarCache, forzar }) {
    const miId = ++recorridoIdRef.current;
    const vigente = () => recorridoIdRef.current === miId;

    setCargandoTodo(true);
    setError(null);

    (async () => {
      let indice = 0;
      if (mostrarCache) {
        const { paginasCache, totalPaginasCache } = await reconstruirDesdeCache();
        if (!vigente()) return;
        if (paginasCache.length) {
          setPaginas(paginasCache);
          setTotalPaginas(totalPaginasCache);
          setPaginasCargadas(paginasCache.length);
          setLoading(false);
        }
      }

      let pageUrl = null;
      do {
        // Comprobado ANTES de pedir la siguiente página (no solo al final del
        // bucle): si se salió de Histórico (cambio de pestaña) mientras
        // esperábamos, esto para el recorrido en el acto en vez de lanzar
        // una petición lenta de más que ya nadie va a ver.
        if (!vigente()) return;
        let huboCache = false;
        const i = indice;
        const promesa = api.historicoCached({ pageUrl, forzar }, (cacheado) => {
          if (!vigente() || i > 0) return;
          // Solo la página 1 usa el aviso instantáneo de caché — de la 2 en
          // adelante ya se está mirando de verdad, mostrar aquí una versión
          // vieja de una página posterior solo generaría parpadeo.
          huboCache = true;
          setPaginas((prev) => {
            const copia = [...prev];
            copia[i] = cacheado.productos;
            return copia;
          });
          setTotalPaginas(cacheado.totalPaginas);
          setLoading(false);
        });

        let data;
        try {
          data = await promesa;
        } catch (e) {
          if (vigente() && !huboCache) setError(e.message);
          break;
        }
        if (!vigente()) return;

        setPaginas((prev) => {
          const copia = [...prev];
          copia[i] = data.productos;
          return copia;
        });
        setTotalPaginas(data.totalPaginas);
        setPaginasCargadas((prev) => Math.max(prev, i + 1));
        setLoading(false);

        pageUrl = data.siguientePagina || null;
        indice += 1;
      } while (pageUrl && vigente());
      if (vigente()) setCargandoTodo(false);
    })();
  }

  useEffect(() => {
    recorrerTodo({ mostrarCache: true, forzar: false });
    // Al salir de la pestaña (Histórico se desmonta: App.jsx solo lo renderiza
    // con tab==='historico') se invalida el recorrido en curso — la
    // pestaña en la que se esté ahora (Catálogo, Búsqueda...) tiene
    // prioridad y no debe esperar detrás de páginas de /consumo.html que ya
    // no le interesan a nadie en este momento. Al volver a Histórico, este
    // mismo efecto se dispara de nuevo y retoma desde la caché.
    return () => {
      recorridoIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Botón manual: repite el mismo recorrido completo sin esperar a salir y
  // volver a entrar en la pestaña. No se limpia `paginas` antes de empezar
  // para no hacer parpadear la lista — cada página se va sustituyendo en su
  // sitio según llega la respuesta fresca, igual que el recorrido automático.
  function actualizar() {
    recorrerTodo({ mostrarCache: false, forzar: true });
  }

  // No se espera a que cofiba.es confirme antes de reaccionar: el contador
  // cambia al instante y la petición sigue sola en segundo plano. Solo si de
  // verdad falla se corrige el contador y se avisa, y entonces sí, no antes.
  function añadir(p, delta) {
    const anterior = pending[p.articulo] ?? 0;
    const nueva = Math.max(0, anterior + delta);
    if (nueva === anterior) return;
    setPending((s) => ({ ...s, [p.articulo]: nueva }));

    const promesa =
      anterior === 0
        ? api.anadirAlCarrito({ articulo: p.articulo, cantidad: nueva })
        : nueva === 0
        ? api.eliminarDelCarrito(p.articulo)
        : api.actualizarCantidadCarrito({ articulo: p.articulo, cantidad: nueva });

    promesa
      .then(() => onCartChanged())
      .catch((e) => {
        setPending((s) => ({ ...s, [p.articulo]: anterior }));
        // A diferencia de Catálogo/Búsqueda, aquí NO se quita la fila (es un
        // hecho de compra real pasado, esconderlo falsearía el histórico) —
        // solo se deja de ofrecer repetirla hasta que vuelva a estar
        // disponible.
        if (e.code === 'ARTICULO_NO_DISPONIBLE') setNoDisponibles((s) => new Set(s).add(p.articulo));
        setError(e.message);
      });
  }

  // Icono de carrito: distinto de estar en esta pantalla (que ya significa
  // "comprado alguna vez") — este marca lo que está en el carrito AHORA o se
  // pidió en esta sesión, igual que en Productos/Búsqueda.
  function enCarritoOSesion(articulo) {
    // pending[articulo] es el contador local, que ya cambia al instante al
    // pulsar +/- (antes de que cofiba.es confirme nada) — mirarlo aquí
    // también hace que el icono aparezca al momento, no solo el número.
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo) || (pending[articulo] ?? 0) > 0);
  }

  const productosPorTexto = filtro.trim()
    ? productos.filter((p) => {
        const t = normalizar(filtro);
        return normalizar(p.nombre).includes(t) || normalizar(p.referencia || p.articulo).includes(t);
      })
    : productos;
  // Orden: categoría → subcategoría → nombre. El histórico llega de
  // /consumo.html en orden cronológico (más reciente primero) — se
  // reordena aquí, no en el servidor, porque solo aquí se conoce ya el
  // "categoriaNombre"/"subcategoriaNombre" con el que agrupar (vienen del
  // índice del catálogo, que puede completarse después de que ya se
  // hubiera pedido esta página). El mismo artículo comprado varias veces
  // en fechas distintas no se fusiona en una sola fila — sigue apareciendo
  // una vez por compra, solo que ahora una junto a la otra.
  const productosFiltrados = filtrarPorIsla(productosPorTexto, islaFiltro)
    .slice()
    .sort((a, b) => {
      const catA = a.categoriaNombre || 'Sin categoría';
      const catB = b.categoriaNombre || 'Sin categoría';
      if (catA !== catB) return catA.localeCompare(catB, 'es');
      const subA = a.subcategoriaNombre || a.subcategoria || 'Otros';
      const subB = b.subcategoriaNombre || b.subcategoria || 'Otros';
      if (subA !== subB) return subA.localeCompare(subB, 'es');
      return normalizar(a.nombre || a.referencia || a.articulo).localeCompare(
        normalizar(b.nombre || b.referencia || b.articulo),
        'es'
      );
    });
  const visiblesLista = productosFiltrados.slice(0, visibles);
  const hayMasParaRevelar = visibles < productosFiltrados.length;

  // Para saber, al pintar cada fila, si hace falta abrir un grupo nuevo
  // (cabecera de categoría y/o subcategoría) comparando con la fila
  // anterior YA VISIBLE — no con la anterior en la lista completa, que
  // podría no estar pintada todavía si `visibles` la dejó fuera.
  function grupoDe(p) {
    return {
      categoria: p.categoriaNombre || 'Sin categoría',
      subcategoria: p.subcategoriaNombre || p.subcategoria || 'Otros',
    };
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>Comprados recientemente</p>
        <button
          onClick={actualizar}
          disabled={cargandoTodo}
          aria-label="Actualizar histórico"
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          {/* Con número de página real (no solo "Actualizando…" fijo) — un
              recorrido forzado de todo el histórico son varias páginas
              lentas de cofiba.es, una por una; sin progreso visible parecía
              colgado aunque estuviera avanzando de verdad. */}
          {cargandoTodo ? `⟳ Actualizando… (${paginasCargadas}/${totalPaginas || '…'})` : '⟳ Actualizar'}
        </button>
        <button onClick={onCambiarVista} aria-label="Cambiar vista" style={{ padding: '6px 10px', fontSize: 12 }}>
          {vistaColumnas === 1 ? '☰ Lista' : `▦ ${vistaColumnas}`}
        </button>
      </div>

      <input
        placeholder="Buscar en tu histórico..."
        value={filtro}
        onChange={(e) => {
          setFiltro(e.target.value);
          setVisibles(TANDA);
        }}
        style={{ marginBottom: 10 }}
      />

      {error && <div className="error-banner">{error}</div>}
      {loading && (
        <p className="muted">Cargando histórico… (cofiba.es tarda bastante en generar esta página, puede llevar hasta medio minuto)</p>
      )}

      {!loading && productos.length === 0 && !error && (
        <p className="muted">Aún no hay compras registradas en tu cuenta de cofiba.es.</p>
      )}

      {!loading && productos.length > 0 && productosPorTexto.length === 0 && filtro.trim() && (
        <p className="muted">Ningún producto de tu histórico coincide con "{filtro}".</p>
      )}
      {!loading && productos.length > 0 && productosPorTexto.length > 0 && productosFiltrados.length === 0 && (
        <p className="muted">Ningún producto {filtro.trim() ? 'de esta búsqueda' : 'de tu histórico'} es de la isla seleccionada.</p>
      )}

      {!loading && productos.length > 0 && (
        <p className="muted" style={{ marginBottom: 8 }}>
          {productos.length} producto{productos.length === 1 ? '' : 's'}
          {cargandoTodo
            ? ` · se sigue completando en segundo plano (página ${paginasCargadas} de ${totalPaginas || '…'})`
            : ''}
        </p>
      )}

      {vistaColumnas === 1 ? (
        <div>
          {visiblesLista.map((p, idx) => {
            const grupo = grupoDe(p);
            const grupoAnterior = idx > 0 ? grupoDe(visiblesLista[idx - 1]) : null;
            const nuevaCategoria = !grupoAnterior || grupo.categoria !== grupoAnterior.categoria;
            const nuevaSubcategoria = nuevaCategoria || grupo.subcategoria !== grupoAnterior.subcategoria;
            return (
              // La clave incluye la posición: el mismo artículo puede aparecer
              // más de una vez en el histórico real (comprado en fechas
              // distintas), y repetir solo el articulo como key confundía a
              // React (dos filas con la misma key "se superponían" visualmente).
              <div key={`${p.articulo}-${idx}`}>
                {nuevaSubcategoria && (
                  <div
                    style={{
                      marginTop: idx === 0 ? 0 : 16,
                      marginBottom: 6,
                      background: 'var(--accent-bg)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: 6,
                      padding: '6px 10px',
                    }}
                  >
                    {nuevaCategoria && (
                      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 2px' }}>{grupo.categoria}</p>
                    )}
                    <p
                      style={{
                        fontWeight: 600,
                        fontSize: 11,
                        margin: 0,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: 'var(--accent)',
                      }}
                    >
                      {grupo.subcategoria}
                    </p>
                  </div>
                )}
                <div
                  className={`product-row${enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''}`}
                  onClick={() => setZoomProducto(p)}
                  style={{ cursor: 'zoom-in' }}
                >
              <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.nombre || p.referencia || p.articulo}
                </p>
                <p className="muted" style={{ margin: '2px 0' }}>
                  Ref. {p.referencia || p.articulo}
                </p>
                <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                  {p.precioFinal ? `${p.precioFinal}€` : '—'}
                  {enCarritoOSesion(p.articulo) && (
                    <span style={{ marginLeft: 5 }}>
                      <CarritoIcon />
                    </span>
                  )}
                  {(() => {
                    const info = nivelStock(p.stock, p.undVenta);
                    return (
                      info && (
                        <span style={{ marginLeft: 5, fontSize: 11, color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                          {info.texto}
                        </span>
                      )
                    );
                  })()}
                </p>
                {p.categoria && (
                  <button
                    className="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onIrACategoria?.(p.categoria, p.categoriaNombre, p.subcategoria);
                    }}
                    style={{ fontSize: 11, padding: '3px 8px', marginTop: 3 }}
                  >
                    Ver más
                  </button>
                )}
              </div>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
                {noDisponibles.has(p.articulo) ? (
                  <span className="muted" style={{ fontSize: 10, color: 'var(--danger)', textAlign: 'center' }}>
                    No disponible
                  </span>
                ) : (
                  <div className="qty-stepper">
                    <button onClick={() => añadir(p, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending[p.articulo] ?? 0}</span>
                    <button onClick={() => añadir(p, 1)}>+</button>
                  </div>
                )}
                {p.undVenta && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    caja de {formatoCaja(p.undVenta)} uds
                  </span>
                )}
              </div>
            </div>
          </div>
            );
          })}
        </div>
      ) : (
        <div className="producto-grid" style={{ gridTemplateColumns: `repeat(${vistaColumnas}, 1fr)` }}>
          {visiblesLista.map((p, idx) => {
            const grupo = grupoDe(p);
            const grupoAnterior = idx > 0 ? grupoDe(visiblesLista[idx - 1]) : null;
            const nuevaCategoria = !grupoAnterior || grupo.categoria !== grupoAnterior.categoria;
            const nuevaSubcategoria = nuevaCategoria || grupo.subcategoria !== grupoAnterior.subcategoria;
            return (
              <Fragment key={`${p.articulo}-${idx}`}>
                {nuevaSubcategoria && (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      marginTop: idx === 0 ? 0 : 10,
                      marginBottom: 4,
                      background: 'var(--accent-bg)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: 6,
                      padding: '6px 10px',
                    }}
                  >
                    {nuevaCategoria && (
                      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 2px' }}>{grupo.categoria}</p>
                    )}
                    <p
                      style={{
                        fontWeight: 600,
                        fontSize: 11,
                        margin: 0,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: 'var(--accent)',
                      }}
                    >
                      {grupo.subcategoria}
                    </p>
                  </div>
                )}
                <div
                  className={`producto-card${enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''}`}
                  onClick={() => setZoomProducto(p)}
                  style={{ cursor: 'zoom-in' }}
                >
              <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
              <p
                style={{
                  fontSize: 13,
                  margin: '4px 0 0',
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {p.nombre || p.referencia || p.articulo}
              </p>
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                {p.precioFinal ? `${p.precioFinal}€` : '—'}
                {enCarritoOSesion(p.articulo) && (
                  <span style={{ marginLeft: 4 }}>
                    <CarritoIcon size={11} />
                  </span>
                )}
                {(() => {
                  const info = nivelStock(p.stock, p.undVenta);
                  return (
                    info && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                        {info.texto}
                      </span>
                    )
                  );
                })()}
              </p>
              {p.categoria && (
                <button
                  className="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onIrACategoria?.(p.categoria, p.categoriaNombre, p.subcategoria);
                  }}
                  style={{ fontSize: 10, padding: '3px 8px', marginTop: 3 }}
                >
                  Ver más
                </button>
              )}
              {/* Todo el bloque final (paso +/- o "No disponible", más la
                  etiqueta de caja) va en marginTop:'auto' — empuja lo que
                  sea que haya al fondo de la tarjeta, igual en toda la fila
                  aunque el nombre o el botón "Ver más" ocupen distinto
                  espacio arriba de una tarjeta a otra. */}
              <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                {noDisponibles.has(p.articulo) ? (
                  <span
                    className="muted"
                    style={{ fontSize: 10, color: 'var(--danger)', display: 'block' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    No disponible
                  </span>
                ) : (
                  <div className="qty-stepper" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => añadir(p, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending[p.articulo] ?? 0}</span>
                    <button onClick={() => añadir(p, 1)}>+</button>
                  </div>
                )}
              </div>
              {p.undVenta && (
                <span className="muted" style={{ fontSize: 10 }}>
                  caja de {formatoCaja(p.undVenta)} uds
                </span>
              )}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {hayMasParaRevelar && (
        <div style={{ padding: '12px 0', textAlign: 'center' }}>
          <button onClick={() => setVisibles((v) => v + TANDA)} style={{ width: '100%' }}>
            Ver más ({productosFiltrados.length - visibles} más)
          </button>
        </div>
      )}

      {!hayMasParaRevelar && cargandoTodo && productos.length > 0 && (
        <p className="muted" style={{ textAlign: 'center', padding: '12px 0' }}>
          Rastreando el resto de tu histórico en segundo plano…
        </p>
      )}

      {zoomProducto && (
        <div
          onClick={() => setZoomProducto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            cursor: 'zoom-out',
            padding: 16,
            gap: 12,
          }}
        >
          <img src={zoomProducto.imagen} alt="" style={{ maxWidth: '100%', maxHeight: '65%', objectFit: 'contain' }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              cursor: 'default',
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              width: '100%',
              maxWidth: 420,
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 2px' }}>
              {zoomProducto.nombre || zoomProducto.referencia || zoomProducto.articulo}
            </p>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              Ref. {zoomProducto.referencia || zoomProducto.articulo}
              {zoomProducto.precioFinal ? ` · ${zoomProducto.precioFinal}€` : ''}
              {zoomProducto.undVenta ? ` · caja de ${formatoCaja(zoomProducto.undVenta)} uds` : ''}
              {(() => {
                const info = nivelStock(zoomProducto.stock, zoomProducto.undVenta);
                return (
                  info && <span style={{ color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}> · {info.texto}</span>
                );
              })()}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              {noDisponibles.has(zoomProducto.articulo) ? (
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Ya no está disponible</span>
              ) : (
                <div className="qty-stepper">
                  <button onClick={() => añadir(zoomProducto, -1)}>-</button>
                  <span style={{ minWidth: 20, textAlign: 'center' }}>{pending[zoomProducto.articulo] ?? 0}</span>
                  <button onClick={() => añadir(zoomProducto, 1)}>+</button>
                </div>
              )}
              <button className="danger" onClick={() => setZoomProducto(null)}>
                Cerrar
              </button>
            </div>

            {relacionados && relacionados.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>También te puede interesar</p>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                  {relacionados.map((r) => (
                    <div
                      key={r.articulo}
                      style={{ flexShrink: 0, width: 84, textAlign: 'center', cursor: 'pointer' }}
                      onClick={() => setZoomProducto(r)}
                    >
                      <div className="product-thumb" style={{ width: 84, height: 84, margin: '0 auto' }}>
                        {r.imagen ? <img src={r.imagen} alt="" /> : '—'}
                      </div>
                      <p
                        style={{
                          fontSize: 10,
                          margin: '3px 0 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {r.nombre}
                      </p>
                      <p style={{ fontSize: 11, fontWeight: 600, margin: '2px 0 0', color: 'var(--accent)' }}>
                        {r.precioFinal ? `${r.precioFinal}€` : '—'}
                        {(() => {
                          const info = nivelStock(r.stock, r.undVenta);
                          return (
                            info && (
                              <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                                {info.texto}
                              </span>
                            )
                          );
                        })()}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          añadir(r, 1);
                        }}
                        style={{ fontSize: 10, padding: '2px 6px', marginTop: 2 }}
                      >
                        {pending[r.articulo] ? `✓ ${pending[r.articulo]}` : '+ Añadir'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
