import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Carrito() {
  const [carrito, setCarrito] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyCodigo, setBusyCodigo] = useState(null);
  const [observaciones, setObservaciones] = useState('');
  const [pedidoOk, setPedidoOk] = useState(null);
  const [zoomSrc, setZoomSrc] = useState(null);

  function cargar() {
    setLoading(true);
    api
      .carrito()
      .then(setCarrito)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(cargar, []);

  async function cambiarCantidad(codigo, cantidad) {
    if (cantidad < 1) return;
    setBusyCodigo(codigo);
    setError(null);
    try {
      await api.actualizarCantidadCarrito({ articulo: codigo, cantidad });
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCodigo(null);
    }
  }

  async function eliminar(codigo) {
    if (!window.confirm('¿Eliminar este producto del carrito?')) return;
    setBusyCodigo(codigo);
    setError(null);
    try {
      await api.eliminarDelCarrito(codigo);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCodigo(null);
    }
  }

  async function vaciar() {
    if (!window.confirm('¿Vaciar todo el carrito?')) return;
    setError(null);
    try {
      await api.vaciarCarrito();
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function finalizar() {
    if (
      !window.confirm(
        'Esto genera un pedido real en cofiba.es con lo que hay en el carrito ahora mismo. ¿Confirmas que quieres finalizar el pedido?'
      )
    ) {
      return;
    }
    setError(null);
    setPedidoOk(null);
    try {
      await api.finalizarPedido(observaciones);
      setPedidoOk('Pedido generado correctamente.');
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="content">
      <p style={{ fontWeight: 500, marginBottom: 10 }}>
        Tu pedido{carrito ? ` · ${carrito.numProductos} productos` : ''}
      </p>

      {error && <div className="error-banner">{error}</div>}
      {pedidoOk && <div className="install-banner">{pedidoOk}</div>}
      {loading && <p className="muted">Cargando carrito…</p>}

      {carrito && (
        <>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            {carrito.lineas.map((l) => (
              <div
                key={l.codigo}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 12,
                  opacity: busyCodigo === l.codigo ? 0.5 : 1,
                }}
              >
                <div
                  className="cart-thumb"
                  onClick={() => l.imagen && setZoomSrc(l.imagen)}
                  style={{ cursor: l.imagen ? 'zoom-in' : 'default' }}
                >
                  {l.imagen ? <img src={l.imagen} alt="" /> : '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.descripcion || l.codigo}
                  </p>
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    Ref. {l.codigo}
                    {l.precio ? ` · ${l.precio}€/ud` : ''}
                  </p>
                  <div className="qty-stepper" style={{ marginTop: 4 }}>
                    <button
                      disabled={busyCodigo === l.codigo}
                      onClick={() => cambiarCantidad(l.codigo, (Number(l.cantidad) || 1) - 1)}
                    >
                      -
                    </button>
                    <span style={{ minWidth: 20, textAlign: 'center' }}>{l.cantidad || 1}</span>
                    <button
                      disabled={busyCodigo === l.codigo}
                      onClick={() => cambiarCantidad(l.codigo, (Number(l.cantidad) || 1) + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>{l.importe ? `${l.importe}€` : '—'}</span>
                  <button className="danger-text" disabled={busyCodigo === l.codigo} onClick={() => eliminar(l.codigo)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {carrito.lineas.length === 0 && (
              <>
                <p className="muted">El carrito está vacío.</p>
                {carrito.debug?.normalizedSample && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="muted">Ver texto crudo recibido (para depurar)</summary>
                    <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {carrito.debug.normalizedSample}
                    </pre>
                  </details>
                )}
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <table className="totals-table">
              <tbody>
                <tr>
                  <td className="muted">Importe</td>
                  <td>{carrito.totales.importe ? `${carrito.totales.importe}€` : '—'}</td>
                </tr>
                <tr>
                  <td className="muted">Dto. pronto pago</td>
                  <td style={{ color: 'var(--success)' }}>
                    {carrito.totales.descuentoProntoPago ? `-${carrito.totales.descuentoProntoPago}€` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Envío</td>
                  <td>{carrito.totales.envio ? `${carrito.totales.envio}€` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 500, borderTop: '1px solid var(--border)', paddingTop: 6 }}>TOTAL</td>
                  <td style={{ fontWeight: 500, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                    {carrito.totales.total ? `${carrito.totales.total}€` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <label className="muted">Observaciones del pedido (opcional)</label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            style={{ width: '100%', margin: '4px 0 12px', fontFamily: 'inherit', fontSize: 14, padding: 8 }}
          />

          <button className="primary" style={{ width: '100%', marginBottom: 8 }} onClick={finalizar}>
            Finalizar pedido
          </button>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button style={{ flex: 1 }} onClick={cargar}>
              Actualizar
            </button>
            <button style={{ flex: 1 }} className="danger-text" onClick={vaciar}>
              Vaciar carrito
            </button>
          </div>
          <p className="muted">
            "Finalizar pedido" genera un pedido real en tu cuenta de cofiba.es con el contenido actual del carrito.
          </p>
        </>
      )}

      {zoomSrc && (
        <div
          onClick={() => setZoomSrc(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            cursor: 'zoom-out',
            padding: 24,
          }}
        >
          <img src={zoomSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  );
}
