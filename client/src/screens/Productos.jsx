import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds").
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

export default function Productos({ categoria, query, onBack, onCartChanged, cartCount }) {
  // La navegación (subcategoría elegida, página dentro del grupo actual y
  // pila para "Anterior") se guarda junto a la clave del contexto que la
  // creó. Cuando cambia la categoría/búsqueda/subcategoría, la clave deja de
  // coincidir y el estado viejo se descarta en el MISMO render — sin efectos
  // de reseteo que llegan tarde. Antes ese desfase disparaba una petición
  // con el pageUrl de la subcategoría anterior, y ese es el motivo de que el
  // contador de páginas se volviera loco al cambiar de subcategoría.
  const catKey = `${categoria?.slug || 'todas'}|${query || ''}`;
  const [subcatSel, setSubcatSel] = useState({ key: catKey, slug: null });
  const subcategoria = subcatSel.key === catKey ? subcatSel.slug : null;
  const ctxKey = `${catKey}|${subcategoria || ''}`;
  const [nav, setNav] = useState({ key: ctxKey, pageUrl: null, grupo: null, stack: [] });
  const effNav = nav.key === ctxKey ? nav : { key: ctxKey, pageUrl: null, grupo: null, stack: [] };

  const [productos, setProductos] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [grupoActual, setGrupoActual] = useState(null);
  const [siguientePagina, setSiguientePagina] = useState(null);
  const [siguienteGrupo, setSiguienteGrupo] = useState(null);
  const [totalPaginas, setTotalPaginas] = useState(null);
  const [paginaInicio, setPaginaInicio] = useState(null);
  const [paginaFin, setPaginaFin] = useState(null);
  const [error, setError] = useState(null);
  const [errorDebugHtml, setErrorDebugHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [debugSample, setDebugSample] = useState(null);
  const [zoomProducto, setZoomProducto] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    // Si al llegar la respuesta ya se pidió otra cosa (cambio rápido de
    // subcategoría o de página), se ignora: la última petición siempre gana.
    let cancelado = false;
    setLoading(true);
    setError(null);
    setErrorDebugHtml(null);
    setDebugSample(null);
    api
      .productos({
        categoria: categoria?.slug || 'todas',
        subcategoria,
        q: query,
        pageUrl: effNav.pageUrl,
        grupo: effNav.grupo,
      })
      .then((data) => {
        if (cancelado) return;
        setProductos(data.productos);
        setSubcategorias(data.subcategorias || []);
        setGrupoActual(data.grupo || null);
        setTotalPaginas(data.totalPaginas);
        setPaginaInicio(data.paginaInicio);
        setPaginaFin(data.paginaFin);
        setSiguientePagina(data.siguientePagina || null);
        setSiguienteGrupo(data.siguienteGrupo || null);
        setDebugSample(data.debug?.normalizedSample || null);
        // Al llegar una página nueva, el listado empieza por arriba (tanto el
        // contenedor con scroll propio como la ventana, según el layout).
        contentRef.current?.scrollTo({ top: 0 });
        window.scrollTo({ top: 0 });
      })
      .catch((e) => {
        if (!cancelado) setError(e.message);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, effNav.pageUrl, effNav.grupo]);

  // El servidor pudo auto-elegir el primer grupo (o saltar grupos vacíos):
  // para paginar dentro del grupo hay que usar el que realmente sirvió.
  const grupoEfectivo = grupoActual?.slug || effNav.grupo;

  function irASiguiente() {
    const destino = siguientePagina
      ? { pageUrl: siguientePagina, grupo: grupoEfectivo }
      : siguienteGrupo
      ? { pageUrl: null, grupo: siguienteGrupo }
      : null;
    if (!destino) return;
    setNav({ key: ctxKey, ...destino, stack: [...effNav.stack, { pageUrl: effNav.pageUrl, grupo: effNav.grupo }] });
  }

  function irAAnterior() {
    if (!effNav.stack.length) return;
    const prev = effNav.stack[effNav.stack.length - 1];
    setNav({ key: ctxKey, pageUrl: prev.pageUrl, grupo: prev.grupo, stack: effNav.stack.slice(0, -1) });
  }

  async function añadir(p, delta) {
    const anterior = pending[p.articulo] ?? 0;
    const nueva = Math.max(0, anterior + delta);
    if (nueva === anterior) return;
    setPending((s) => ({ ...s, [p.articulo]: nueva }));
    try {
      if (anterior === 0) {
        // Primera vez que se pulsa + para este producto: aún no está en el
        // carrito, así que hay que añadirlo (no solo fijar su cantidad).
        await api.anadirAlCarrito({
          categoria: categoria?.slug || 'todas',
          articulo: p.articulo,
          cantidad: nueva,
          origen: p.origen,
        });
      } else if (nueva === 0) {
        // Bajar hasta 0 ya no es "menos cantidad", es sacarlo del carrito.
        // Antes el botón "-" solo tocaba este contador local y nunca
        // llegaba a quitar nada del carrito real.
        await api.eliminarDelCarrito(p.articulo);
      } else {
        await api.actualizarCantidadCarrito({ articulo: p.articulo, cantidad: nueva });
      }
      // cofiba.es's own total_carrito counts "add events", not distinct
      // products — always refetch our own parsed cart so the badge matches
      // what the Carrito tab shows.
      onCartChanged();
    } catch (e) {
      setPending((s) => ({ ...s, [p.articulo]: anterior }));
      setError(e.message);
      setErrorDebugHtml(e.debugHtml || null);
    }
  }

  // "de N" solo aporta información cuando queda más detrás de lo que ya se
  // ve (paginaFin < totalPaginas). Si ya se llegó a la última página real,
  // repetirlo ("Páginas 1-2 de 2") es redundante y confunde.
  const rango = paginaInicio === paginaFin ? `Página ${paginaInicio}` : `Páginas ${paginaInicio}-${paginaFin}`;
  const etiquetaPaginas = totalPaginas ? (paginaFin < totalPaginas ? `${rango} de ${totalPaginas}` : rango) : '';
  const hayPaginacion = totalPaginas > 1 || siguienteGrupo || effNav.stack.length > 0;

  return (
    <div className="content" ref={contentRef} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0 }}>{categoria?.nombre || `Búsqueda: ${query}`}</p>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          {errorDebugHtml && (
            <details style={{ marginTop: 6 }}>
              <summary>Ver HTML de depuración</summary>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{errorDebugHtml}</pre>
            </details>
          )}
        </div>
      )}

      {subcategorias.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
          <button
            onClick={() => setSubcatSel({ key: catKey, slug: null })}
            style={{
              flexShrink: 0,
              fontSize: 11,
              padding: '6px 10px',
              background: !subcategoria && !grupoEfectivo ? 'var(--accent)' : 'var(--surface-2)',
              color: !subcategoria && !grupoEfectivo ? '#fff' : 'var(--text-primary)',
              borderColor: !subcategoria && !grupoEfectivo ? 'var(--accent)' : 'var(--border)',
            }}
          >
            Todas
          </button>
          {subcategorias.map((s) => {
            // En modo "Todas" se va recorriendo un grupo detrás de otro:
            // el chip resaltado debe seguir a ese grupo, no quedarse fijo en
            // "Todas", para que se vea en qué subcategoría estás de verdad.
            const activa = subcategoria === s.slug || (!subcategoria && grupoEfectivo === s.slug);
            return (
              <button
                key={s.slug}
                onClick={() => setSubcatSel({ key: catKey, slug: s.slug })}
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  padding: '6px 10px',
                  whiteSpace: 'nowrap',
                  background: activa ? 'var(--accent)' : 'var(--surface-2)',
                  color: activa ? '#fff' : 'var(--text-primary)',
                  borderColor: activa ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {s.nombre}
              </button>
            );
          })}
        </div>
      )}

      {loading && <p className="muted">Cargando productos…</p>}
      {!loading && productos.length === 0 && !error && (
        <>
          <p className="muted">No se encontraron productos.</p>
          {debugSample && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted">Ver texto crudo recibido (para depurar)</summary>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{debugSample}</pre>
            </details>
          )}
        </>
      )}

      {!loading && productos.length > 0 && grupoActual && !subcategoria && (
        <p
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: 'var(--accent)',
            margin: '4px 0 2px',
            letterSpacing: 0.3,
          }}
        >
          {grupoActual.nombre}
        </p>
      )}

      <div>
        {productos.map((p) => (
          <div className="product-row" key={p.articulo}>
            <div
              className="product-thumb"
              onClick={() => p.imagen && setZoomProducto(p)}
              style={{ cursor: p.imagen ? 'zoom-in' : 'default' }}
            >
              {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.nombre || p.referencia || p.articulo}
              </p>
              <p className="muted" style={{ margin: '2px 0' }}>
                Ref. {p.referencia || p.articulo}
              </p>
              <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                {p.precioFinal ? `${p.precioFinal}€` : '—'}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div className="qty-stepper">
                <button onClick={() => añadir(p, -1)}>-</button>
                <span style={{ minWidth: 14, textAlign: 'center', fontSize: 12 }}>{pending[p.articulo] ?? 0}</span>
                <button onClick={() => añadir(p, 1)}>+</button>
              </div>
              {p.undVenta && (
                <span className="muted" style={{ fontSize: 10 }}>
                  caja de {formatoCaja(p.undVenta)} uds
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hayPaginacion && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button disabled={effNav.stack.length === 0} onClick={irAAnterior}>
              Anterior
            </button>
            <span className="muted" style={{ textAlign: 'center' }}>
              {grupoActual && !subcategoria ? grupoActual.nombre : ''}
              {grupoActual && !subcategoria && etiquetaPaginas ? ' · ' : ''}
              {etiquetaPaginas}
            </span>
            <button disabled={!siguientePagina && !siguienteGrupo} onClick={irASiguiente}>
              Siguiente
            </button>
          </div>
        </div>
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
          <img
            src={zoomProducto.imagen}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '65%', objectFit: 'contain' }}
          />
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
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="qty-stepper">
                <button onClick={() => añadir(zoomProducto, -1)}>-</button>
                <span style={{ minWidth: 20, textAlign: 'center' }}>{pending[zoomProducto.articulo] ?? 0}</span>
                <button onClick={() => añadir(zoomProducto, 1)}>+</button>
              </div>
              <button onClick={() => setZoomProducto(null)}>Cerrar</button>
            </div>
            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 11, margin: '8px 0 0' }}>{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
