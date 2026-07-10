import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Productos({ categoria, query, onBack, onCartChanged, cartCount }) {
  const [productos, setProductos] = useState([]);
  const [pageUrl, setPageUrl] = useState(null);
  const [historial, setHistorial] = useState([]); // stack of previous pageUrls
  const [siguientePagina, setSiguientePagina] = useState(null);
  const [totalPaginas, setTotalPaginas] = useState(null);
  const [error, setError] = useState(null);
  const [errorDebugHtml, setErrorDebugHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [debugSample, setDebugSample] = useState(null);
  const [debugPaginacion, setDebugPaginacion] = useState(null);

  useEffect(() => {
    setPageUrl(null);
    setHistorial([]);
  }, [categoria, query]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setErrorDebugHtml(null);
    setDebugSample(null);
    setDebugPaginacion(null);
    api
      .productos({ categoria: categoria?.slug || 'todas', q: query, pageUrl })
      .then((data) => {
        setProductos(data.productos);
        setTotalPaginas(data.totalPaginas);
        setSiguientePagina(data.siguientePagina || null);
        setDebugSample(data.debug?.normalizedSample || null);
        setDebugPaginacion(data.debug?.paginacionHtml || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [categoria, query, pageUrl]);

  function irASiguiente() {
    setHistorial((h) => [...h, pageUrl]);
    setPageUrl(siguientePagina);
  }
  function irAAnterior() {
    setHistorial((h) => {
      const prev = h[h.length - 1] ?? null;
      setPageUrl(prev);
      return h.slice(0, -1);
    });
  }

  async function añadir(p, delta) {
    const nueva = Math.max(0, (pending[p.articulo] ?? 0) + delta);
    setPending((s) => ({ ...s, [p.articulo]: nueva }));
    if (delta > 0) {
      try {
        await api.anadirAlCarrito({
          categoria: categoria?.slug || 'todas',
          articulo: p.articulo,
          cantidad: 1,
        });
        // cofiba.es's own total_carrito counts "add events", not distinct
        // products — clicking + twice on the same item bumps it twice even
        // though the cart still shows one line. Always refetch our own
        // parsed cart so the badge matches what the Carrito tab shows.
        onCartChanged();
      } catch (e) {
        setError(e.message);
        setErrorDebugHtml(e.debugHtml || null);
      }
    }
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
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

      <div>
        {productos.map((p) => (
          <div className="product-row" key={p.articulo}>
            <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.nombre || p.referencia || p.articulo}
              </p>
              <p className="muted" style={{ margin: '2px 0' }}>
                Ref. {p.referencia || p.articulo}
                {p.undVenta ? ` · caja ${p.undVenta}` : ''}
              </p>
              <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                {p.precioFinal ? `${p.precioFinal}€` : '—'}
              </p>
            </div>
            <div className="qty-stepper">
              <button onClick={() => añadir(p, -1)}>-</button>
              <span style={{ minWidth: 14, textAlign: 'center', fontSize: 12 }}>{pending[p.articulo] ?? 0}</span>
              <button onClick={() => añadir(p, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button disabled={historial.length === 0} onClick={irAAnterior}>
              Anterior
            </button>
            <span className="muted">{totalPaginas} páginas en total</span>
            <button disabled={!siguientePagina} onClick={irASiguiente}>
              Siguiente
            </button>
          </div>
          {!siguientePagina && (
            <p className="muted" style={{ marginTop: 6 }}>
              Esta categoría tiene más páginas pero todavía no localizamos el enlace real de "siguiente" en la web —
              de momento usa el buscador para llegar a productos más allá de esta página.
              {debugPaginacion && (
                <details style={{ marginTop: 6 }}>
                  <summary>Ver HTML de depuración</summary>
                  <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{debugPaginacion}</pre>
                </details>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
