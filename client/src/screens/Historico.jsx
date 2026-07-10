import { useEffect, useState } from 'react';
import { api } from '../api.js';

function formatFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Historico({ onCartChanged }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [añadido, setAñadido] = useState({});

  useEffect(() => {
    api
      .historico()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function repetir(item) {
    setAñadido((s) => ({ ...s, [item.articulo]: 'cargando' }));
    setError(null);
    try {
      await api.anadirAlCarrito({ categoria: item.categoria, articulo: item.articulo, cantidad: item.cantidad || 1 });
      setAñadido((s) => ({ ...s, [item.articulo]: 'ok' }));
      onCartChanged();
    } catch (e) {
      setAñadido((s) => ({ ...s, [item.articulo]: null }));
      setError(e.message);
    }
  }

  return (
    <div className="content">
      <p style={{ fontWeight: 500, marginBottom: 10 }}>Productos comprados antes</p>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Cargando histórico…</p>}

      {!loading && items.length === 0 && !error && (
        <p className="muted">
          Aún no hay histórico: aparecerá aquí en cuanto finalices tu primer pedido desde la app.
        </p>
      )}

      <div>
        {items.map((item) => (
          <div className="product-row" key={item.articulo}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.descripcion || item.articulo}
              </p>
              <p className="muted" style={{ margin: '2px 0' }}>
                Última compra: {formatFecha(item.fecha)}
                {item.cantidad ? ` · ${item.cantidad} ud.` : ''}
              </p>
            </div>
            <button
              className="primary"
              disabled={añadido[item.articulo] === 'cargando'}
              onClick={() => repetir(item)}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              {añadido[item.articulo] === 'ok' ? 'Añadido ✓' : añadido[item.articulo] === 'cargando' ? '…' : '+ Añadir'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
