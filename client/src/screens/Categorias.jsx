import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Categorias({ onOpenCategoria, onSearch }) {
  const [categorias, setCategorias] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [codigo, setCodigo] = useState('');

  useEffect(() => {
    api
      .categorias()
      .then(setCategorias)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="content">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          placeholder="Producto, referencia, código..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch(q)}
        />
        <button onClick={() => onSearch(q)} aria-label="Buscar">
          🔍
        </button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Añadir por código..."
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        <button onClick={() => codigo && onSearch(codigo)}>+</button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Cargando categorías…</p>}

      <p className="muted" style={{ marginBottom: 8 }}>
        Categorías
      </p>
      <div className="cat-grid">
        {categorias.map((c) => (
          <button key={c.slug} className="cat-tile" onClick={() => onOpenCategoria(c)}>
            {c.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}
