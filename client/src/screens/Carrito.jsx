import { useEffect, useState } from 'react';
import { api } from '../api.js';
import FichaProducto from '../components/FichaProducto.jsx';

// "Und. de venta" llega como texto con formato español ("12,00").
function numeroCaja(undVenta) {
  const n = parseFloat(String(undVenta ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function formatoNumero(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

export default function Carrito({ onCartChanged, onPedidoFinalizado }) {
  const [carrito, setCarrito] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyCodigo, setBusyCodigo] = useState(null);
  const [observaciones, setObservaciones] = useState('');
  // Aviso a pantalla completa mientras se envía el pedido y al terminar:
  // null | { estado: 'enviando' } | { estado: 'ok', total }. Un simple texto
  // arriba del carrito pasaba desapercibido y la clienta no sabía si el
  // pedido había salido o no.
  const [envio, setEnvio] = useState(null);
  // Ficha ampliada (la misma que en el resto de la app).
  const [zoomCodigo, setZoomCodigo] = useState(null);
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
        setSaliendoCodigo(null);
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

  const [saliendoCodigo, setSaliendoCodigo] = useState(null);
  async function eliminar(codigo) {
    if (!window.confirm('¿Eliminar este producto del carrito?')) return;
    setBusyCodigo(codigo);
    setError(null);
    try {
      await api.eliminarDelCarrito(codigo);
      // La línea sale deslizándose y plegándose antes de recargar.
      setSaliendoCodigo(codigo);
      await new Promise((r) => setTimeout(r, 380));
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
    const total = carrito?.totales?.total || null;
    setEnvio({ estado: 'enviando' });
    // El carrito se vacía en cofiba.es al finalizar, así que hay que guardar
    // qué artículos llevaba ANTES de que eso pase — si no, el icono de "en
    // el carrito o comprado en esta sesión" desaparecería de golpe justo
    // después de comprar, cuando es precisamente cuando más sentido tiene.
    const codigos = carrito?.lineas.map((l) => l.codigo) || [];
    try {
      await api.finalizarPedido(observaciones);
      setEnvio({ estado: 'ok', total });
      setObservaciones('');
      onPedidoFinalizado?.(codigos);
      cargar();
    } catch (e) {
      setEnvio(null);
      setError(`No se ha podido enviar el pedido: ${e.message}`);
      window.scrollTo(0, 0);
    }
  }

  return (
    <div className="content">
      <p style={{ fontWeight: 500, marginBottom: 10 }}>
        Tu pedido
        {carrito && (
          <>
            {' · '}
            <span className="cuenta-pop" key={'n' + carrito.numProductos}>{carrito.numProductos}</span> productos
          </>
        )}
      </p>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Cargando carrito…</p>}

      {carrito && (
        <>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            {carrito.lineas.map((l) => (
              <div
                key={l.codigo}
                className={`carrito-linea${saliendoCodigo === l.codigo ? ' quitando' : ''}`}
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
                  onClick={() => setZoomCodigo(l.codigo)}
                  style={{ cursor: 'zoom-in' }}
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
                    <span className="cuenta-pop" key={'c' + l.cantidad} style={{ minWidth: 20, textAlign: 'center' }}>{l.cantidad || 1}</span>
                    <button
                      disabled={busyCodigo === l.codigo}
                      onClick={() => cambiarCantidad(l.codigo, (Number(l.cantidad) || 1) + 1)}
                    >
                      +
                    </button>
                    {/* Cajas pedidas y cuántas unidades son en total. */}
                    <span className="carrito-cajas">
                      {(() => {
                        const cajas = Number(l.cantidad) || 1;
                        const porCaja = numeroCaja(l.undVenta);
                        const txtCajas = `${cajas} ${cajas === 1 ? 'caja' : 'cajas'}`;
                        if (!porCaja) return txtCajas;
                        return (
                          <>
                            {txtCajas} de {formatoNumero(porCaja)} uds
                            <br />
                            <strong className="cuenta-pop" key={'u' + cajas}>{formatoNumero(cajas * porCaja)} unidades</strong>
                          </>
                        );
                      })()}
                    </span>
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

          {/* Orden pedido: justo debajo del listado va lo más importante —
              el propio botón de finalizar — y el resto (importe,
              observaciones, actualizar/borrar, pedido mínimo) va
              detrás en ese mismo orden, no repartido por toda la pantalla. */}
          <button
            className="primary"
            style={{ width: '100%', marginTop: 4, marginBottom: 4 }}
            disabled={envio?.estado === 'enviando' || carrito.lineas.length === 0}
            onClick={finalizar}
          >
            {envio?.estado === 'enviando' ? 'Enviando pedido…' : 'Finalizar pedido'}
          </button>
          <p className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
            Genera un pedido real en tu cuenta de cofiba.es con el contenido actual del carrito.
          </p>

          <div className="card" style={{ marginBottom: 12 }}>
            {/* Las mismas líneas que el carrito de la web de cofiba.es: con
                productos de distinto IVA hay una base y un IVA (con su
                recargo) por cada tipo. */}
            <table className="totals-table">
              <tbody>
                {carrito.totales.lineas?.length ? (
                  carrito.totales.lineas.map((l, i) => {
                    const esTotal = /^TOTAL$/i.test(l.etiqueta);
                    const estilo = esTotal ? { fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6, fontSize: 16 } : undefined;
                    return (
                      <tr key={i}>
                        <td className={esTotal ? undefined : 'muted'} style={estilo}>
                          {esTotal ? 'TOTAL' : (l.etiqueta.charAt(0) + l.etiqueta.slice(1).toLowerCase()).replace(/iva/g, 'IVA').replace(/^Rec /, 'REC ')}
                        </td>
                        <td style={estilo}>{l.valor}€</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td style={{ fontWeight: 500 }}>TOTAL</td>
                    <td style={{ fontWeight: 500 }}>{carrito.totales.total ? `${carrito.totales.total}€` : '—'}</td>
                  </tr>
                )}
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

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={{ flex: 1 }} onClick={cargar}>
              Actualizar
            </button>
            <button style={{ flex: 1 }} className="danger-text" onClick={vaciar}>
              Vaciar carrito
            </button>
          </div>

          <p className="muted" style={{ marginBottom: 12 }}>
            Pedido mínimo para envío: 100€ (entregas en Mallorca) · 200€ (resto de islas y península). Por debajo de
            ese importe, cofiba.es informa por email del coste del transporte antes de prepararlo.
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

      {envio && (
        <div className="envio-overlay" role="alertdialog" aria-live="assertive">
          <div className="envio-caja">
            {envio.estado === 'enviando' ? (
              <>
                <div className="envio-spinner" />
                <p className="envio-titulo">Enviando pedido…</p>
                <p className="muted">No cierres la app hasta que termine.</p>
              </>
            ) : (
              <>
                <div className="envio-check">✓</div>
                <p className="envio-titulo">¡Pedido enviado correctamente!</p>
                <p className="muted">
                  {envio.total ? `Total: ${envio.total}€. ` : ''}
                  Ya está registrado en Cofiba. Lo verás en «Copias de pedido».
                </p>
                <button className="primary" style={{ width: '100%', marginTop: 12 }} onClick={() => setEnvio(null)}>
                  Aceptar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {zoomCodigo && carrito && (() => {
        // Las líneas del carrito con la forma de producto de la ficha.
        const lista = carrito.lineas.map((l) => ({
          ...l,
          articulo: l.codigo,
          nombre: l.descripcion || l.codigo,
          referencia: l.codigo,
          precioFinal: l.precio,
        }));
        const inicial = lista.find((p) => p.articulo === zoomCodigo);
        if (!inicial) return null;
        return (
          <FichaProducto
            lista={lista}
            inicial={inicial}
            onCerrar={() => setZoomCodigo(null)}
            pending={Object.fromEntries(lista.map((p) => [p.articulo, Number(p.cantidad) || 1]))}
            añadir={(p, delta) => {
              const linea = carrito.lineas.find((l) => l.codigo === p.articulo);
              if (linea) cambiarCantidad(p.articulo, (Number(linea.cantidad) || 1) + delta);
              else if (delta > 0)
                api
                  .anadirAlCarrito({ categoria: p.categoria, articulo: p.articulo, cantidad: 1 })
                  .then(() => cargar())
                  .catch((e) => setError(e.message));
            }}
            noDisponibles={new Set()}
            error={error}
          />
        );
      })()}
    </div>
  );
}
