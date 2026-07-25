import { useEffect, useState } from 'react';
import { api } from '../api.js';

// No existe ningún endpoint de "informes" en cofiba.es — estos datos salen
// de contar, en segundo plano, cuántas veces aparece cada artículo en
// /consumo.html (el histórico real de compras de la cuenta). Por eso puede
// tardar la primera vez (recorre todo el histórico) y por eso `completo`
// puede seguir en false un rato: las cifras ya se enseñan (con lo que haya
// en caché local, al instante) pero todavía pueden crecer mientras el
// recorrido de fondo continúa — y ese recorrido ahora se guarda en el
// servidor a medida que avanza, así que un reinicio no le hace empezar de
// cero otra vez.
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

function FilaProducto({ p, max, onAbrir, novedad }) {
  return (
    <button
      onClick={() => onAbrir(p)}
      className="fila-clicable"
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: '12px 0',
        borderTop: '1px solid var(--border)',
        cursor: 'pointer',
        gap: 10,
      }}
    >
      <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.nombre || p.referencia || p.articulo}
        </p>
        {novedad ? (
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {p.categoriaNombre}
            {p.precioFinal ? ` · ${p.precioFinal}€` : ''}
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {p.categoriaNombre ? `${p.categoriaNombre} · ` : ''}
              {p.veces} {p.veces === 1 ? 'caja comprada' : 'cajas compradas'}
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
      {novedad ? (
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
      ) : (
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--accent)', minWidth: 60, textAlign: 'right' }}>
          {formatoEuro(p.importe)}
        </p>
      )}
    </button>
  );
}

// Ventana emergente con el detalle de un artículo, tocando desde cualquier
// listado de Estadísticas (más comprados, por categoría o novedades).
function ModalProducto({ p, onCerrar }) {
  if (!p) return null;
  const esNovedad = p.desde != null && p.veces == null;
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
                <td>{p.stock} uds.</td>
              </tr>
            )}
            {!esNovedad && (
              <tr>
                <td>Cajas compradas</td>
                <td>{p.veces}</td>
              </tr>
            )}
            {!esNovedad && p.importe != null && (
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
          </tbody>
        </table>
        <button onClick={onCerrar} style={{ width: '100%', marginTop: 12 }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export default function Estadisticas() {
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState(null);
  // Al tocar una categoría se enseñan sus productos (ya vienen del servidor
  // ordenados de más a menos vendido) en vez del resumen general — no hace
  // falta pedir nada nuevo, el desglose ya trae sus propios productos.
  const [categoriaAbierta, setCategoriaAbierta] = useState(null);
  const [novedades, setNovedades] = useState(null);
  const [vista, setVista] = useState('masComprado'); // masComprado | novedades
  const [productoModal, setProductoModal] = useState(null);

  useEffect(() => {
    // Su propia caché con límite de un día (api.novedadesCached) — no hace
    // falta volver a pedirla de verdad cada vez que se entra aquí en el
    // mismo día, el catálogo no cambia más a menudo que eso.
    api
      .novedadesCached((cacheado) => setNovedades(cacheado.productos))
      .then((data) => setNovedades(data.productos))
      .catch(() => {
        // Silencioso a propósito: es un dato complementario, no algo que
        // deba impedir ver el resto de Estadísticas si falla.
      });
  }, []);

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
        Lo más comprado en Cofiba
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
          <FilaProducto key={p.articulo} p={p} max={maxProducto} onAbrir={setProductoModal} />
        ))}
        <ModalProducto p={productoModal} onCerrar={() => setProductoModal(null)} />
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
          {botonesVista}

          {vista === 'novedades' && (
            <>
              <p className="muted" style={{ marginBottom: 4 }}>
                Artículos añadidos al catálogo en los últimos 3 días.
              </p>
              <div style={{ marginBottom: 20 }}>
                {novedades && novedades.length > 0 ? (
                  novedades.map((p) => <FilaProducto key={p.articulo} p={p} onAbrir={setProductoModal} novedad />)
                ) : (
                  <p className="muted">No hay artículos nuevos en los últimos 3 días.</p>
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
                  <FilaProducto key={p.articulo} p={p} max={maxComprado} onAbrir={setProductoModal} />
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

      <ModalProducto p={productoModal} onCerrar={() => setProductoModal(null)} />
    </div>
  );
}
