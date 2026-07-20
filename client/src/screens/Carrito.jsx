import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Carrito({ onCartChanged, onPedidoFinalizado }) {
  const [carrito, setCarrito] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyCodigo, setBusyCodigo] = useState(null);
  const [observaciones, setObservaciones] = useState('');
  const [pedidoOk, setPedidoOk] = useState(null);
  const [zoomSrc, setZoomSrc] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [pedidosError, setPedidosError] = useState(null);
  const [descargando, setDescargando] = useState(null);

  // Copias de pedido: viven en mi-cuenta.html (pestaña "Pedidos pendientes"
  // de cofiba.es), no en el carrito — se cargan aparte para no bloquear ni
  // depender de la carga del carrito en sí.
  useEffect(() => {
    api
      .pedidosPendientes()
      .then(setPedidos)
      .catch((e) => setPedidosError(e.message));
  }, []);

  async function verCopia(pedido) {
    // La pestaña se abre YA, antes de esperar el PDF: si se abre después del
    // await, el navegador ya no lo asocia con el clic del usuario y algunos
    // (Safari sobre todo) la bloquean como pop-up. Abriéndola en blanco aquí
    // mismo y rellenándola luego con el PDF de verdad evita eso.
    const ventana = window.open('', '_blank');
    setDescargando(pedido.href);
    try {
      const blob = await api.copiaPedido(pedido.href);
      const url = URL.createObjectURL(blob);
      if (ventana && !ventana.closed) ventana.location = url;
      else window.open(url, '_blank');
      // Da tiempo a que la pestaña termine de cargar el PDF antes de liberar
      // el object URL — revocarlo antes de tiempo la dejaría en blanco.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      ventana?.close();
      setPedidosError(e.message);
    } finally {
      setDescargando(null);
    }
  }

  function cargar() {
    setLoading(true);
    api
      .carrito()
      .then((data) => {
        setCarrito(data);
        // El badge de la botonera de abajo vive en App.jsx: sin esto se
        // quedaba con el número de antes de borrar/vaciar aunque aquí
        // dentro sí se actualizara. Los códigos también, para el icono de
        // "en el carrito" en Productos/Búsqueda.
        onCartChanged?.(data.numProductos, data.lineas.map((l) => l.codigo));
      })
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
    // El carrito se vacía en cofiba.es al finalizar, así que hay que guardar
    // qué artículos llevaba ANTES de que eso pase — si no, el icono de "en
    // el carrito o comprado en esta sesión" desaparecería de golpe justo
    // después de comprar, cuando es precisamente cuando más sentido tiene.
    const codigos = carrito?.lineas.map((l) => l.codigo) || [];
    try {
      await api.finalizarPedido(observaciones);
      setPedidoOk('Pedido generado correctamente.');
      onPedidoFinalizado?.(codigos);
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
            {carrito.lineas.length === 0 && <p className="muted">El carrito está vacío.</p>}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <table className="totals-table">
              <tbody>
                <tr>
                  <td className="muted">Importe</td>
                  <td>{carrito.totales.importe ? `${carrito.totales.importe}€` : '—'}</td>
                </tr>
                <tr>
                  <td className="muted">IVA{carrito.totales.iva?.rate ? ` (${carrito.totales.iva.rate}%)` : ''}</td>
                  <td>{carrito.totales.iva?.valor ? `${carrito.totales.iva.valor}€` : '—'}</td>
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

          <p className="muted" style={{ marginBottom: 12 }}>
            Pedido mínimo para envío: 100€ (entregas en Mallorca) · 200€ (resto de islas y península). Por debajo de
            ese importe, cofiba.es informa por email del coste del transporte antes de prepararlo.
          </p>

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

      {/* Copias de pedido: documentos reales de tu cuenta de cofiba.es (mi-
          cuenta.html, pestaña "Pedidos pendientes"), no algo que generemos
          nosotros — por eso van aparte, debajo de todo lo del carrito. */}
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ fontWeight: 500, marginBottom: 8 }}>Copias de pedido</p>
        {pedidosError && <div className="error-banner">{pedidosError}</div>}
        {!pedidosError && pedidos.length === 0 && <p className="muted">No hay pedidos pendientes en tu cuenta.</p>}
        {pedidos.map((p) => (
          <div
            key={p.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 0',
              borderTop: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            <div>
              <p style={{ margin: 0 }}>
                Pedido {p.numero} · {p.fecha}
              </p>
              <p className="muted" style={{ margin: '2px 0 0' }}>
                {p.importe}€
              </p>
            </div>
            <button disabled={descargando === p.href} onClick={() => verCopia(p)}>
              {descargando === p.href ? 'Abriendo…' : 'Ver copia'}
            </button>
          </div>
        ))}
      </div>

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
