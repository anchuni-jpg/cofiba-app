import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Duplica formatoCaja de Productos.jsx/Busqueda.jsx — una línea, no vale la
// pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

export default function Historico({ onCartChanged }) {
  // Esto ya no es un historial que llevemos nosotros — lee directamente la
  // sección real "Comprados recientemente" de cofiba.es (/consumo.html), así
  // que refleja TODO lo comprado en la cuenta, no solo lo hecho desde la app.
  const [productos, setProductos] = useState([]);
  const [totalPaginas, setTotalPaginas] = useState(null);
  const [paginaFin, setPaginaFin] = useState(null);
  const [siguientePagina, setSiguientePagina] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [pending, setPending] = useState({});
  const [zoomProducto, setZoomProducto] = useState(null);

  // Mismo patrón que Búsqueda: "Ver más" va añadiendo al final del listado
  // en vez de sustituirlo por una página nueva — al usuario le resulta más
  // natural seguir bajando que tener que pulsar Anterior/Siguiente.
  function cargar(pageUrl) {
    const esPrimera = !pageUrl;
    (esPrimera ? setLoading : setCargandoMas)(true);
    api
      .historico({ pageUrl })
      .then((data) => {
        setProductos((prev) => (esPrimera ? data.productos : [...prev, ...data.productos]));
        setPaginaFin(data.paginaFin);
        setTotalPaginas(data.totalPaginas);
        setSiguientePagina(data.siguientePagina || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => (esPrimera ? setLoading : setCargandoMas)(false));
  }

  useEffect(() => cargar(null), []);

  async function añadir(p, delta) {
    const anterior = pending[p.articulo] ?? 0;
    const nueva = Math.max(0, anterior + delta);
    if (nueva === anterior) return;
    setPending((s) => ({ ...s, [p.articulo]: nueva }));
    try {
      if (anterior === 0) {
        await api.anadirAlCarrito({ articulo: p.articulo, cantidad: nueva });
      } else if (nueva === 0) {
        await api.eliminarDelCarrito(p.articulo);
      } else {
        await api.actualizarCantidadCarrito({ articulo: p.articulo, cantidad: nueva });
      }
      onCartChanged();
    } catch (e) {
      setPending((s) => ({ ...s, [p.articulo]: anterior }));
      setError(e.message);
    }
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <p style={{ fontWeight: 500, marginBottom: 10 }}>Comprados recientemente</p>

      {error && <div className="error-banner">{error}</div>}
      {loading && (
        <p className="muted">Cargando histórico… (cofiba.es tarda bastante en generar esta página, puede llevar hasta medio minuto)</p>
      )}

      {!loading && productos.length === 0 && !error && (
        <p className="muted">Aún no hay compras registradas en tu cuenta de cofiba.es.</p>
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

      {siguientePagina && (
        <div style={{ padding: '12px 0', textAlign: 'center' }}>
          <button onClick={() => cargar(siguientePagina)} disabled={cargandoMas} style={{ width: '100%' }}>
            {cargandoMas ? 'Cargando…' : 'Ver más'}
          </button>
          {totalPaginas && (
            <p className="muted" style={{ marginTop: 6 }}>
              Página {paginaFin} de {totalPaginas}
            </p>
          )}
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
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="qty-stepper">
                <button onClick={() => añadir(zoomProducto, -1)}>-</button>
                <span style={{ minWidth: 20, textAlign: 'center' }}>{pending[zoomProducto.articulo] ?? 0}</span>
                <button onClick={() => añadir(zoomProducto, 1)}>+</button>
              </div>
              <button onClick={() => setZoomProducto(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
