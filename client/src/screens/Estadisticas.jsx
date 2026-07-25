import { useEffect, useState } from 'react';
import { api } from '../api.js';

// No existe ningún endpoint de "informes" en cofiba.es — estos datos salen
// de contar, en segundo plano, cuántas veces aparece cada artículo en
// /consumo.html (el histórico real de compras de la cuenta). Por eso puede
// tardar la primera vez (recorre todo el histórico) y por eso `completo`
// puede seguir en false un rato: las cifras ya se enseñan, pero todavía
// pueden crecer mientras el recorrido de fondo continúa.
export default function Estadisticas() {
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState(null);

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

  const maxCategoria = datos?.porCategoria?.[0]?.veces || 1;
  const maxComprado = datos?.masComprados?.[0]?.veces || 1;

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
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.articulosDistintos}</p>
              <p className="muted" style={{ margin: '2px 0 0' }}>Artículos distintos comprados</p>
            </div>
            <div className="card" style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{datos.totalLineas}</p>
              <p className="muted" style={{ margin: '2px 0 0' }}>Líneas de compra en total</p>
            </div>
          </div>

          <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 8px' }}>Más comprados</p>
          <div style={{ marginBottom: 20 }}>
            {datos.masComprados.map((p) => (
              <div key={p.articulo} className="product-row">
                <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.nombre || p.referencia || p.articulo}
                  </p>
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    {p.categoriaNombre}
                    {p.precioFinal ? ` · ${p.precioFinal}€` : ''}
                  </p>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 3,
                      background: 'var(--surface-1)',
                      marginTop: 5,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(6, (p.veces / maxComprado) * 100)}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--accent)', minWidth: 24, textAlign: 'right' }}>
                  {p.veces}
                </p>
              </div>
            ))}
          </div>

          <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 8px' }}>Por categoría</p>
          <div>
            {datos.porCategoria.map((c) => (
              <div key={c.nombre} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span>{c.nombre}</span>
                  <span className="muted">{c.veces}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-1)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(4, (c.veces / maxCategoria) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
