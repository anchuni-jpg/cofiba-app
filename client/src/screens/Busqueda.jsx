import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds"). Duplica formatoCaja de
// Productos.jsx — es una línea, no vale la pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

export default function Busqueda({ termino, onBack, onCartChanged }) {
  const [resultados, setResultados] = useState(null);
  const [construyendo, setConstruyendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});
  const [zoomProducto, setZoomProducto] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    let cancelado = false;
    setResultados(null);
    setError(null);
    setConstruyendo(false);

    function consultar() {
      api
        .buscar(termino)
        .then((data) => {
          if (cancelado) return;
          if (data.error) {
            setError(`No se pudo preparar el buscador: ${data.error}`);
            return;
          }
          // Aunque siga construyéndose el índice, ya llegan resultados
          // parciales de lo recorrido hasta ahora — se muestran igual, y se
          // sigue consultando cada pocos segundos para completar la lista
          // según avanza, en vez de dejar al usuario esperando en blanco.
          setResultados(data.resultados || []);
          setConstruyendo(!!data.construyendo);
          setProgreso(data.progreso || 0);
          if (data.construyendo) pollRef.current = setTimeout(consultar, 3000);
        })
        .catch((e) => !cancelado && setError(e.message));
    }
    consultar();

    return () => {
      cancelado = true;
      clearTimeout(pollRef.current);
    };
  }, [termino]);

  async function añadir(p, delta) {
    const anterior = pending[p.articulo] ?? 0;
    const nueva = Math.max(0, anterior + delta);
    if (nueva === anterior) return;
    setPending((s) => ({ ...s, [p.articulo]: nueva }));
    try {
      if (anterior === 0) {
        await api.anadirAlCarrito({ categoria: p.categoria, articulo: p.articulo, cantidad: nueva, origen: p.origen });
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0 }}>Búsqueda: {termino}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {construyendo && !error && !resultados?.length && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px' }}>Preparando el buscador por primera vez…</p>
          <p className="muted" style={{ margin: 0 }}>
            Recorriendo el catálogo de cofiba.es ({progreso} productos vistos hasta ahora). Puede tardar unos
            minutos la primera vez; luego las búsquedas son instantáneas.
          </p>
        </div>
      )}

      {resultados === null && !error && <p className="muted">Buscando…</p>}

      {resultados !== null && resultados.length === 0 && !construyendo && (
        <p className="muted">No se encontraron productos para "{termino}".</p>
      )}

      {resultados && resultados.length > 0 && (
        <>
          <p className="muted" style={{ marginBottom: 8 }}>
            {resultados.length} resultado{resultados.length === 1 ? '' : 's'}
            {construyendo ? ' · el índice se sigue completando, puede haber más en unos segundos' : ''}
          </p>
          <div>
            {resultados.map((p) => (
              <div className="product-row" key={p.articulo}>
                <div
                  className="product-thumb"
                  onClick={() => p.imagen && setZoomProducto(p)}
                  style={{ cursor: p.imagen ? 'zoom-in' : 'default' }}
                >
                  {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 12,
                      margin: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.nombre}
                  </p>
                  <p className="muted" style={{ margin: '2px 0' }}>
                    Ref. {p.referencia || p.articulo} · {p.categoriaNombre}
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
        </>
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
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 2px' }}>{zoomProducto.nombre}</p>
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
