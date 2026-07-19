import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds").
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

export default function Productos({ categoria, onBack, onCartChanged, cartCount }) {
  // La navegación (subcategoría activa, página dentro de ella y pila para
  // "Anterior") se guarda junto a la clave del contexto que la creó. Cuando
  // cambia la categoría/búsqueda, la clave deja de coincidir y el estado
  // viejo se descarta en el MISMO render — sin efectos de reseteo que llegan
  // tarde. `subcategoria: null` significa "que el servidor elija la primera
  // alfabética"; da igual si se llega así o pulsando un chip, el recorrido
  // (Siguiente pasa a la próxima subcategoría al agotar la actual) funciona
  // igual desde ese punto en adelante — no hace falta un botón "Todas"
  // aparte, porque siempre empieza por la primera subcategoría de todos modos.
  const ctxKey = categoria?.slug || 'todas';
  const [nav, setNav] = useState({ key: ctxKey, subcategoria: null, pageUrl: null, stack: [] });
  const effNav = nav.key === ctxKey ? nav : { key: ctxKey, subcategoria: null, pageUrl: null, stack: [] };

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
  const chipsRef = useRef(null);

  useEffect(() => {
    // Si al llegar la respuesta ya se pidió otra cosa (cambio rápido de
    // subcategoría o de página), se ignora: la última petición siempre gana.
    let cancelado = false;
    let huboCache = false;
    setLoading(true);
    setError(null);
    setErrorDebugHtml(null);
    setDebugSample(null);

    function aplicar(data) {
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
    }

    api
      .productosCached(
        { categoria: categoria?.slug || 'todas', subcategoria: effNav.subcategoria, pageUrl: effNav.pageUrl },
        (cacheado) => {
          huboCache = true;
          aplicar(cacheado);
          if (!cancelado) setLoading(false);
        }
      )
      .then(aplicar)
      .catch((e) => {
        // Si ya se pudo enseñar algo de la caché, un fallo de la petición de
        // verdad (p. ej. el servidor reiniciándose) no debe tapar esos datos
        // ya válidos con un banner de error confuso — se queda como está y
        // ya se reintentará solo la próxima vez que se entre aquí.
        if (!cancelado && !huboCache) setError(e.message);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, effNav.pageUrl, effNav.subcategoria]);

  // El servidor pudo auto-elegir la primera subcategoría (o saltar alguna
  // vacía): para paginar dentro de ella hay que usar la que realmente sirvió.
  const grupoEfectivo = grupoActual?.slug || effNav.subcategoria;

  // La fila de chips hace scroll horizontal propio: al avanzar de
  // subcategoría en subcategoría el chip resaltado puede quedar fuera de la
  // vista, así que se lleva a la vista solo (sin mover el resto de la
  // pantalla) cada vez que cambia cuál está activo.
  useEffect(() => {
    if (!grupoEfectivo || !chipsRef.current) return;
    const el = chipsRef.current.querySelector(`[data-slug="${grupoEfectivo}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [grupoEfectivo]);

  function irASiguiente() {
    const destino = siguientePagina
      ? { subcategoria: effNav.subcategoria, pageUrl: siguientePagina }
      : siguienteGrupo
      ? { subcategoria: siguienteGrupo, pageUrl: null }
      : null;
    if (!destino) return;
    setNav({
      key: ctxKey,
      ...destino,
      stack: [...effNav.stack, { subcategoria: effNav.subcategoria, pageUrl: effNav.pageUrl }],
    });
  }

  function irAAnterior() {
    if (!effNav.stack.length) return;
    const prev = effNav.stack[effNav.stack.length - 1];
    setNav({ key: ctxKey, subcategoria: prev.subcategoria, pageUrl: prev.pageUrl, stack: effNav.stack.slice(0, -1) });
  }

  function elegirSubcategoria(slug) {
    setNav({ key: ctxKey, subcategoria: slug, pageUrl: null, stack: [] });
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

  // El rango de páginas reales (p.ej. "1-2 de 2") solo tiene sentido cuando
  // pulsar "Siguiente" enseña MÁS productos de esta MISMA subcategoría
  // (siguientePagina). Varias páginas reales de cofiba.es pueden fusionarse
  // en una sola pantalla nuestra (p.ej. 12+3 productos en 2 páginas reales
  // de "bolsa-compra" caben enteros en una única vista) — en ese caso,
  // mostrar "Páginas 1-2" es confuso: el usuario ve una sola pantalla con
  // todo, no dos. Cuando siguientePagina es null, "Siguiente" (si existe)
  // pasa a la SIGUIENTE subcategoría, no a más de esta, así que no hay
  // ningún número de página que enseñar.
  const rango = paginaInicio === paginaFin ? `Página ${paginaInicio}` : `Páginas ${paginaInicio}-${paginaFin}`;
  const etiquetaPaginas = siguientePagina && totalPaginas ? `${rango} de ${totalPaginas}` : '';
  const hayPaginacion = !!siguientePagina || !!siguienteGrupo || effNav.stack.length > 0;

  return (
    <div className="content" ref={contentRef} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0 }}>{categoria?.nombre}</p>
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
        <div ref={chipsRef} style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
          {subcategorias.map((s) => {
            const activa = grupoEfectivo === s.slug;
            return (
              <button
                key={s.slug}
                data-slug={s.slug}
                onClick={() => elegirSubcategoria(s.slug)}
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

      {!loading && productos.length > 0 && grupoActual && (
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
          <div className={`product-row${p.comprado ? ' product-row-comprado' : ''}`} key={p.articulo}>
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
                {p.comprado && <strong style={{ color: 'var(--accent)' }}> · Comprado</strong>}
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
              {grupoActual ? grupoActual.nombre : ''}
              {grupoActual && etiquetaPaginas ? ' · ' : ''}
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
