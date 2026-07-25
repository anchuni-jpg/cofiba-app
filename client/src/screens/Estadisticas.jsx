import { useEffect, useState } from 'react';
import { api } from '../api.js';

// No existe ningún endpoint de "informes" en cofiba.es — estos datos salen
// de contar, en segundo plano, cuántas veces aparece cada artículo en
// /consumo.html (el histórico real de compras de la cuenta). Por eso puede
// tardar la primera vez (recorre todo el histórico) y por eso `completo`
// puede seguir en false un rato: las cifras ya se enseñan, pero todavía
// pueden crecer mientras el recorrido de fondo continúa.
//
// El importe (precio actual × veces comprado) es una aproximación: el
// histórico no guarda el precio de cada compra en su momento, así que se
// calcula con el precio de catálogo de ahora mismo.
function formatoEuro(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return (
    n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  );
}

function FilaProducto({ p, max }) {
  return (
    <div className="product-row">
      <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.nombre || p.referencia || p.articulo}
        </p>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          {p.categoriaNombre ? `${p.categoriaNombre} · ` : ''}
          {p.veces} {p.veces === 1 ? 'vez comprado' : 'veces comprado'}
          {p.precioFinal ? ` · ${p.precioFinal}€/ud` : ''}
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
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--accent)', minWidth: 60, textAlign: 'right' }}>
        {formatoEuro(p.importe)}
      </p>
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
        <p className="muted" style={{ marginBottom: 12 }}>
          {categoria.productos.length} artículo{categoria.productos.length === 1 ? '' : 's'} · {formatoEuro(categoria.importe)} en
          total · de más a menos vendido
        </p>
        {categoria.productos.map((p) => (
          <FilaProducto key={p.articulo} p={p} max={maxProducto} />
        ))}
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>Estadísticas</p>
        <button onClick={() => cargar({ mostrarCache: false })} disabled={actualizando} style={{ padding: '6px 10px', fontSize: 12 }}>
          {actualizando ? '⟳ Actualizando…' : '⟳ Actualizar'}
        </button>
      </div>

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
          {!datos.completo && (
            <p className="muted" style={{ marginBottom: 10 }}>
              Estas cifras se siguen completando en segundo plano — pueden crecer al actualizar.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <div className="card" style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.articulosDistintos}</p>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Artículos distintos</p>
            </div>
            <div className="card" style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.totalLineas}</p>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Líneas de compra</p>
            </div>
            <div className="card" style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{formatoEuro(datos.totalImporte)}</p>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>Importe total</p>
            </div>
          </div>

          <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 8px' }}>Más comprados</p>
          <div style={{ marginBottom: 20 }}>
            {datos.masComprados.map((p) => (
              <FilaProducto key={p.articulo} p={p} max={maxComprado} />
            ))}
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
    </div>
  );
}
