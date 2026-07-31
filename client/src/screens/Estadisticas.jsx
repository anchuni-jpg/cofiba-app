import { useEffect, useState } from 'react';
import { api } from '../api.js';
import CarritoIcon from '../components/CarritoIcon.jsx';

const PERIODOS = [
  { valor: '1m', etiqueta: '1 mes' },
  { valor: '3m', etiqueta: '3 meses' },
  { valor: '6m', etiqueta: '6 meses' },
  { valor: '12m', etiqueta: '12 meses' },
  { valor: 'ano', etiqueta: 'Año en curso' },
];

// Duplica nivelStock de Productos.jsx — 10 cajas o más: "STOCK" en verde,
// sin número; por debajo: "STOCK BAJO" en el color de aviso.
function nivelStock(stock, undVenta) {
  if (!Number.isFinite(stock)) return null;
  const unidadesPorCaja = parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
  const cajas = stock / unidadesPorCaja;
  if (cajas >= 10) return { texto: 'STOCK', bajo: false };
  return cajas <= 0 ? { texto: 'AGOTADO', bajo: true } : { texto: 'STOCK BAJO', bajo: true };
}

// No existe ningún endpoint de "informes" en cofiba.es — estos datos salen
// de contar, en segundo plano, cuántas veces aparece cada artículo en
// /consumo.html (el histórico real de compras de la cuenta). Por eso puede
// tardar la primera vez (recorre todo el histórico) y por eso `completo`
// puede seguir en false un rato: las cifras ya se enseñan (con lo que haya
// en caché local, al instante) pero todavía pueden crecer mientras el
// recorrido de fondo continúa. El servidor gratuito además se duerme por
// inactividad y pierde ese recorrido acumulado al despertar — por eso
// api.js#estadisticasCached nunca deja que una respuesta más nueva pero más
// pequeña "vacíe" lo que ya se había visto (ver el comentario allí).
//
// cofiba.es vende por CAJA, no por unidad suelta: el importe que manda el
// servidor ya viene calculado como precio unitario × unidades por caja ×
// cajas compradas, para que sea un importe real y no solo "precio × veces".
function formatoEuro(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function haceCuanto(desde) {
  const dias = Math.floor((Date.now() - desde) / (24 * 60 * 60 * 1000));
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'hace 1 día';
  return `hace ${dias} días`;
}

// Todo el casillero es el botón que abre la ficha (igual que en Catálogo/
// Búsqueda/Histórico) — solo el paso +/- queda fuera, con su propio
// stopPropagation, para no disparar la ficha al tocar - o +.
function FilaProducto({ p, max, onAbrir, novedad, cambioStock, onAñadir, pending, enCarrito, noDisponible }) {
  const stock = nivelStock(p.stock, p.undVenta);
  return (
    <div
      onClick={() => onAbrir(p)}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '12px 0',
        borderTop: '1px solid var(--border)',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.nombre || p.referencia || p.articulo}
          {enCarrito && (
            <span style={{ marginLeft: 5 }}>
              <CarritoIcon size={11} />
            </span>
          )}
        </p>
        {(novedad || cambioStock) && (
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {p.categoriaNombre}
            {cambioStock ? ` · ${p.stockAntes} → ${p.stockDespues} uds.` : p.precioFinal ? ` · ${p.precioFinal}€` : ''}
            {stock && <span style={{ color: stock.bajo ? 'var(--danger)' : 'var(--accent)' }}> · {stock.texto}</span>}
          </p>
        )}
        {!novedad && !cambioStock && (
          <>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {p.categoriaNombre ? `${p.categoriaNombre} · ` : ''}
              {p.veces} {p.veces === 1 ? 'caja comprada' : 'cajas compradas'}
              {stock && <span style={{ color: stock.bajo ? 'var(--danger)' : 'var(--accent)' }}> · {stock.texto}</span>}
            </p>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-1)', marginTop: 5, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(6, ((p.importe || 0) / max) * 100)}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          </>
        )}
      </div>
      {novedad && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent)',
            background: 'var(--accent-bg)',
            borderRadius: 8,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {haceCuanto(p.desde)}
        </span>
      )}
      {cambioStock && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            background: p.stockDespues > p.stockAntes ? 'var(--accent)' : 'var(--danger)',
            borderRadius: 8,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {p.stockDespues > p.stockAntes ? '▲' : '▼'} {haceCuanto(p.fecha)}
        </span>
      )}
      {!novedad && !cambioStock && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--accent)', minWidth: 60, textAlign: 'right' }}>
            {formatoEuro(p.importe)}
          </p>
          {noDisponible ? (
            <span style={{ fontSize: 10, color: 'var(--danger)' }}>No disponible</span>
          ) : (
            onAñadir && (
              <div className="qty-stepper" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onAñadir(p, -1)}>-</button>
                <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending?.[p.articulo] ?? 0}</span>
                <button onClick={() => onAñadir(p, 1)}>+</button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Ventana emergente con el detalle de un artículo, tocando desde cualquier
// listado de Estadísticas (más comprados, por categoría, novedades, cambios
// de stock o el aviso de restock) — siempre trae toda la info (buscarPorArticulo
// va incluido en el objeto en los cuatro casos), así que "también te puede
// interesar" y el paso +/- funcionan igual en cualquiera de ellos.
function ModalProducto({ p, onAbrir, onCerrar, onAñadir, pending, noDisponibles }) {
  // Los hooks van antes que cualquier return condicional — el efecto en sí
  // ya comprueba `p` por dentro.
  const [relacionados, setRelacionados] = useState(null);
  useEffect(() => {
    if (!p) {
      setRelacionados(null);
      return;
    }
    let cancelado = false;
    setRelacionados(null);
    api
      .relacionados(p.articulo)
      .then((data) => {
        if (!cancelado) setRelacionados(data.productos || []);
      })
      .catch(() => {
        if (!cancelado) setRelacionados([]);
      });
    return () => {
      cancelado = true;
    };
  }, [p]);

  if (!p) return null;
  const esCambioStock = p.stockAntes != null;
  const esNovedad = p.desde != null && !esCambioStock;
  const stock = nivelStock(p.stock, p.undVenta);
  return (
    <div
      onClick={onCerrar}
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
      {p.imagen && <img src={p.imagen} alt="" style={{ maxWidth: '100%', maxHeight: '45%', objectFit: 'contain' }} />}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          cursor: 'default',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          width: '100%',
          maxWidth: 420,
        }}
      >
        <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{p.nombre || p.referencia || p.articulo}</p>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Ref. {p.referencia || p.articulo}
          {p.categoriaNombre ? ` · ${p.categoriaNombre}` : ''}
        </p>
        <table className="totals-table">
          <tbody>
            <tr>
              <td>Precio por unidad</td>
              <td>{p.precioFinal ? `${p.precioFinal} €` : '—'}</td>
            </tr>
            {p.undVenta && (
              <tr>
                <td>Caja de</td>
                <td>{p.undVenta} uds.</td>
              </tr>
            )}
            {p.precioCaja != null && (
              <tr>
                <td>Precio por caja</td>
                <td>{formatoEuro(p.precioCaja)}</td>
              </tr>
            )}
            {Number.isFinite(p.stock) && (
              <tr>
                <td>Stock</td>
                <td>
                  {p.stock} uds.
                  {stock && <span style={{ color: stock.bajo ? 'var(--danger)' : 'var(--accent)' }}> · {stock.texto}</span>}
                </td>
              </tr>
            )}
            {!esNovedad && !esCambioStock && (
              <tr>
                <td>Cajas compradas</td>
                <td>{p.veces}</td>
              </tr>
            )}
            {!esNovedad && !esCambioStock && p.importe != null && (
              <tr>
                <td style={{ fontWeight: 600 }}>Importe total</td>
                <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{formatoEuro(p.importe)}</td>
              </tr>
            )}
            {esNovedad && (
              <tr>
                <td>Novedad</td>
                <td>{haceCuanto(p.desde)}</td>
              </tr>
            )}
            {esCambioStock && (
              <tr>
                <td style={{ fontWeight: 600 }}>Cambio de stock</td>
                <td style={{ fontWeight: 600, color: p.stockDespues > p.stockAntes ? 'var(--accent)' : 'var(--danger)' }}>
                  {p.stockAntes} → {p.stockDespues} uds. ({haceCuanto(p.fecha)})
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {noDisponibles?.has(p.articulo) ? (
            <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Ya no está disponible</span>
          ) : onAñadir ? (
            <div className="qty-stepper">
              <button onClick={() => onAñadir(p, -1)}>-</button>
              <span style={{ minWidth: 20, textAlign: 'center' }}>{pending?.[p.articulo] ?? 0}</span>
              <button onClick={() => onAñadir(p, 1)}>+</button>
            </div>
          ) : (
            <span />
          )}
          <button className="danger" onClick={onCerrar}>
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
                  style={{ flexShrink: 0, width: 84, textAlign: 'center', cursor: onAbrir ? 'pointer' : 'default' }}
                  onClick={() => onAbrir?.(r)}
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
                  {onAñadir && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAñadir(r, 1);
                      }}
                      style={{ fontSize: 10, padding: '2px 6px', marginTop: 2 }}
                    >
                      {pending?.[r.articulo] ? `✓ ${pending[r.articulo]}` : '+ Añadir'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Estadisticas({ onCartChanged, codigosEnCarrito, codigosSesion }) {
  // Icono de carrito: igual que en Productos/Búsqueda/Histórico — distinto
  // de "ya comprado" (aquí TODO lo es, por definición), marca lo que está
  // en el carrito AHORA o se pidió en esta sesión.
  function enCarritoOSesion(articulo) {
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo));
  }
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState(null);
  // Al tocar una categoría se enseñan sus productos (ya vienen del servidor
  // ordenados de más a menos vendido) en vez del resumen general — no hace
  // falta pedir nada nuevo, el desglose ya trae sus propios productos.
  const [categoriaAbierta, setCategoriaAbierta] = useState(null);
  const [novedades, setNovedades] = useState(null);
  const [cambiosStock, setCambiosStock] = useState(null);
  const [catalogoConstruyendo, setCatalogoConstruyendo] = useState(false);
  const [vista, setVista] = useState('masComprado'); // masComprado | novedades | stock
  const [productoModal, setProductoModal] = useState(null);
  // Cuánto se ha pedido de cada artículo desde aquí en esta sesión —
  // articulo -> cantidad. Mismo patrón que el paso +/- de Catálogo/
  // Búsqueda/Histórico (nunca "recordatorio de recompra" por fecha:
  // cofiba.es no guarda cuándo se compró cada cosa, ver el comentario de
  // arriba), para que Estadísticas se pida igual que el resto de la app en
  // vez de tener su propio botón especial de "un toque y ya".
  const [pending, setPending] = useState({});
  // Artículos que cofiba.es acaba de rechazar al intentar añadirlos (ver
  // ARTICULO_NO_DISPONIBLE en el servidor) — igual que en Histórico, aquí
  // no se esconde la fila (es una estadística real de lo que ya se compró),
  // solo se deja de ofrecer repetir el pedido hasta que vuelva a estar
  // disponible.
  const [noDisponibles, setNoDisponibles] = useState(new Set());
  // Periodo para "Pedidos hechos desde la app" (única parte de Estadísticas
  // con fecha real — ver el comentario largo junto a /api/facturacion en el
  // servidor). '3m' por defecto: suficiente para hacerse una idea sin ser
  // tan corto como para salir casi siempre vacío en una cuenta que no pide
  // todos los meses.
  const [periodo, setPeriodo] = useState('3m');
  const [facturacionPeriodo, setFacturacionPeriodo] = useState(null);

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
      .then(() => onCartChanged?.())
      .catch((e) => {
        setPending((s) => ({ ...s, [p.articulo]: anterior }));
        if (e.code === 'ARTICULO_NO_DISPONIBLE') setNoDisponibles((s) => new Set(s).add(p.articulo));
        setError(e.message);
      });
  }

  useEffect(() => {
    // Se calcula en este mismo dispositivo (api.js#novedadesYCambiosStock),
    // comparando contra la última foto del catálogo guardada aquí — no
    // depende de que el servidor recuerde nada entre despliegues.
    api
      .novedadesYCambiosStock()
      .then((data) => {
        setNovedades(data.novedades);
        setCambiosStock(data.cambiosStock);
        setCatalogoConstruyendo(data.construyendo);
      })
      .catch(() => {
        // Silencioso a propósito: es un dato complementario, no algo que
        // deba impedir ver el resto de Estadísticas si falla.
      });
  }, []);

  useEffect(() => {
    let cancelado = false;
    setFacturacionPeriodo(null);
    api
      .facturacion(periodo)
      .then((data) => {
        if (!cancelado) setFacturacionPeriodo(data);
      })
      .catch(() => {
        // Silencioso: es un dato complementario dentro de la pestaña, no
        // algo que deba tapar el resto de Estadísticas si falla.
      });
    return () => {
      cancelado = true;
    };
  }, [periodo]);

  function cargar({ mostrarCache }) {
    setError(null);
    if (!mostrarCache) setActualizando(true);
    let huboCache = false;
    const promesa = mostrarCache
      ? api.estadisticasCached((cacheado) => {
          huboCache = true;
          setDatos(cacheado);
          setLoading(false);
        })
      : api.estadisticas();

    promesa
      .then((data) => {
        setDatos(data);
        setLoading(false);
      })
      .catch((e) => {
        if (!huboCache) setError(e.message);
      })
      .finally(() => setActualizando(false));
  }

  useEffect(() => {
    cargar({ mostrarCache: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxCategoria = Math.max(1, ...(datos?.porCategoria || []).map((c) => c.importe || 0));
  const maxComprado = Math.max(1, ...(datos?.masComprados || []).map((p) => p.importe || 0));

  // De los cambios de stock detectados en este dispositivo, cuáles son
  // reposiciones (pasó de menos a más) de algo que esta cuenta ya ha
  // comprado antes ("masComprados" ya trae cuántas veces) — para avisar
  // "esto que sueles pedir ha vuelto a tener stock" en vez de un aviso
  // genérico. Antes lo calculaba el servidor (cruzando con su propio
  // recuento de compras); ahora que la detección de cambios de stock vive
  // en el dispositivo, el cruce se hace aquí mismo con los datos que ya
  // hay a mano, sin pedir nada nuevo.
  const vecesCompradoPorArticulo = new Map((datos?.masComprados || []).map((p) => [p.articulo, p.veces]));
  const restockHabituales = (cambiosStock || [])
    .filter((c) => c.stockDespues > c.stockAntes && vecesCompradoPorArticulo.has(c.articulo))
    .map((c) => ({ ...c, vecesCompradoAntes: vecesCompradoPorArticulo.get(c.articulo) }))
    .slice(0, 10);

  // Si la categoría abierta ya no existe en un refresco (raro, pero posible
  // si el nombre cambia), se vuelve sola al resumen en vez de enseñar una
  // pantalla rota.
  const categoria = categoriaAbierta ? datos?.porCategoria?.find((c) => c.nombre === categoriaAbierta) : null;
  useEffect(() => {
    if (categoriaAbierta && datos?.disponible && !categoria) setCategoriaAbierta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  const cabecera = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>Estadísticas</p>
      <button onClick={() => cargar({ mostrarCache: false })} disabled={actualizando} style={{ padding: '6px 10px', fontSize: 12 }}>
        {actualizando ? '⟳ Actualizando…' : '⟳ Actualizar'}
      </button>
    </div>
  );

  const botonesVista = (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
      <button
        onClick={() => setVista('masComprado')}
        style={{
          flex: 1,
          fontSize: 12,
          padding: '8px 6px',
          background: vista === 'masComprado' ? 'var(--accent)' : 'var(--surface-2)',
          color: vista === 'masComprado' ? '#fff' : 'var(--text-primary)',
          borderColor: vista === 'masComprado' ? 'var(--accent)' : 'var(--border)',
        }}
      >
        Lo más comprado
      </button>
      <button
        onClick={() => setVista('novedades')}
        style={{
          flex: 1,
          fontSize: 12,
          padding: '8px 6px',
          background: vista === 'novedades' ? 'var(--accent)' : 'var(--surface-2)',
          color: vista === 'novedades' ? '#fff' : 'var(--text-primary)',
          borderColor: vista === 'novedades' ? 'var(--accent)' : 'var(--border)',
        }}
      >
        Nuevas entradas{novedades?.length ? ` (${novedades.length})` : ''}
      </button>
      <button
        onClick={() => setVista('stock')}
        style={{
          flex: 1,
          fontSize: 12,
          padding: '8px 6px',
          background: vista === 'stock' ? 'var(--accent)' : 'var(--surface-2)',
          color: vista === 'stock' ? '#fff' : 'var(--text-primary)',
          borderColor: vista === 'stock' ? 'var(--accent)' : 'var(--border)',
        }}
      >
        Cambios de stock{cambiosStock?.length ? ` (${cambiosStock.length})` : ''}
      </button>
    </div>
  );

  if (categoria) {
    const maxProducto = Math.max(1, ...categoria.productos.map((p) => p.importe || 0));
    return (
      <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={() => setCategoriaAbierta(null)} aria-label="Volver" style={{ padding: '6px 10px' }}>
            ←
          </button>
          <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>{categoria.nombre}</p>
        </div>
        <p className="muted" style={{ marginBottom: 4 }}>
          {categoria.productos.length} artículo{categoria.productos.length === 1 ? '' : 's'} · {formatoEuro(categoria.importe)} en
          total · de más a menos vendido
        </p>
        {categoria.productos.map((p) => (
          <FilaProducto
            key={p.articulo}
            p={p}
            max={maxProducto}
            onAbrir={setProductoModal}
            onAñadir={añadir}
            pending={pending}
            enCarrito={enCarritoOSesion(p.articulo)}
            noDisponible={noDisponibles.has(p.articulo)}
          />
        ))}
        <ModalProducto
          p={productoModal}
          onAbrir={setProductoModal}
          onCerrar={() => setProductoModal(null)}
          onAñadir={añadir}
          pending={pending}
          noDisponibles={noDisponibles}
        />
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      {cabecera}

      {error && <div className="error-banner">{error}</div>}

      {loading && <p className="muted">Calculando estadísticas… (recorre tu histórico de compras, puede tardar unos minutos la primera vez)</p>}

      {!loading && datos && !datos.disponible && (
        <p className="muted">
          Todavía no hay compras registradas para calcular estadísticas, o se está recorriendo el histórico por primera vez — vuelve en
          unos minutos.
        </p>
      )}

      {!loading && datos?.disponible && (
        <>
          {restockHabituales.length > 0 && (
            <div
              style={{
                background: 'var(--accent-bg)',
                borderRadius: 'var(--radius)',
                padding: '10px 12px',
                marginBottom: 14,
              }}
            >
              <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 4px', color: 'var(--accent)' }}>
                🔔 Ha{restockHabituales.length === 1 ? '' : 'n'} vuelto a tener stock
              </p>
              <p className="muted" style={{ margin: '0 0 6px' }}>
                Productos que sueles comprar y estaban agotados o con muy poco stock.
              </p>
              {restockHabituales.map((p) => (
                <FilaProducto
                  key={p.articulo}
                  p={p}
                  onAbrir={setProductoModal}
                  cambioStock
                  enCarrito={enCarritoOSesion(p.articulo)}
                />
              ))}
            </div>
          )}

          {botonesVista}

          {vista === 'novedades' && (
            <>
              <p className="muted" style={{ marginBottom: 4 }}>
                Artículos añadidos al catálogo en los últimos 3 días.
              </p>
              <div style={{ marginBottom: 20 }}>
                {novedades && novedades.length > 0 ? (
                  novedades.map((p) => (
                    <FilaProducto
                      key={p.articulo}
                      p={p}
                      onAbrir={setProductoModal}
                      novedad
                      enCarrito={enCarritoOSesion(p.articulo)}
                    />
                  ))
                ) : (
                  <p className="muted">
                    No hay artículos nuevos en los últimos 3 días.
                    {catalogoConstruyendo && ' El catálogo se está rastreando de fondo — puede tardar un rato en completarse.'}
                  </p>
                )}
              </div>
            </>
          )}

          {vista === 'stock' && (
            <>
              <p className="muted" style={{ marginBottom: 4 }}>
                Cambios notables de los últimos 7 días: agotado, repuesto, o una bajada fuerte de existencias.
              </p>
              <div style={{ marginBottom: 20 }}>
                {cambiosStock && cambiosStock.length > 0 ? (
                  cambiosStock.map((p, idx) => (
                    <FilaProducto
                      key={`${p.articulo}-${idx}`}
                      p={p}
                      onAbrir={setProductoModal}
                      cambioStock
                      enCarrito={enCarritoOSesion(p.articulo)}
                    />
                  ))
                ) : (
                  <p className="muted">
                    Sin cambios de stock notables en los últimos 7 días.
                    {catalogoConstruyendo && ' El catálogo se está rastreando de fondo — puede tardar un rato en completarse.'}
                  </p>
                )}
              </div>
            </>
          )}

          {vista === 'masComprado' && (
            <>
              {!datos.completo && (
                <p className="muted" style={{ marginBottom: 10 }}>
                  Estas cifras se siguen completando en segundo plano — pueden crecer al actualizar.
                </p>
              )}

              <div style={{ marginBottom: 20 }}>
                {datos.masComprados.map((p) => (
                  <FilaProducto
                    key={p.articulo}
                    p={p}
                    max={maxComprado}
                    onAbrir={setProductoModal}
                    onAñadir={añadir}
                    pending={pending}
                    enCarrito={enCarritoOSesion(p.articulo)}
                    noDisponible={noDisponibles.has(p.articulo)}
                  />
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <div className="card" style={{ flex: 1, textAlign: 'center' }}>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.articulosDistintos}</p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Artículos distintos</p>
                </div>
                <div className="card" style={{ flex: 1, textAlign: 'center' }}>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.totalLineas}</p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Cajas compradas</p>
                </div>
                <div className="card" style={{ flex: 1, textAlign: 'center' }}>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{formatoEuro(datos.totalImporte)}</p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Importe total</p>
                </div>
              </div>

              {/* A diferencia de los 3 cuadros de arriba (de siempre —
                  cofiba.es no da fecha de cada compra pasada), esto SÍ tiene
                  fecha real: son los pedidos hechos desde esta misma app. */}
              <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 2px' }}>Pedidos hechos desde esta app</p>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                Los cuadros de arriba son de toda tu cuenta (sin fecha); esto solo cuenta lo pedido desde aquí.
              </p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {PERIODOS.map((op) => (
                  <button
                    key={op.valor}
                    onClick={() => setPeriodo(op.valor)}
                    style={{
                      flex: '1 1 auto',
                      fontSize: 11,
                      padding: '6px 4px',
                      background: periodo === op.valor ? 'var(--accent)' : 'var(--surface-2)',
                      color: periodo === op.valor ? '#fff' : 'var(--text-primary)',
                      borderColor: periodo === op.valor ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    {op.etiqueta}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <div className="card" style={{ flex: 1, textAlign: 'center' }}>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>
                    {facturacionPeriodo ? facturacionPeriodo.totalPedidos : '—'}
                  </p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Pedidos</p>
                </div>
                <div className="card" style={{ flex: 1, textAlign: 'center' }}>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>
                    {facturacionPeriodo ? formatoEuro(facturacionPeriodo.totalImporte) : '—'}
                  </p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Importe</p>
                </div>
              </div>

              <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 8px' }}>
                Por categoría <span className="muted" style={{ fontWeight: 400 }}>· toca una para ver sus productos</span>
              </p>
              <div>
                {datos.porCategoria.map((c) => (
                  <button
                    key={c.nombre}
                    onClick={() => setCategoriaAbierta(c.nombre)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      marginBottom: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                      <span>{c.nombre} ›</span>
                      <span className="muted">{formatoEuro(c.importe)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-1)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(4, ((c.importe || 0) / maxCategoria) * 100)}%`,
                          background: 'var(--accent)',
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <ModalProducto
        p={productoModal}
        onAbrir={setProductoModal}
        onCerrar={() => setProductoModal(null)}
        onAñadir={añadir}
        pending={pending}
        noDisponibles={noDisponibles}
      />
    </div>
  );
}
