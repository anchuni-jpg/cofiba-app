import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Datos propios de Cofiba (no de la cuenta del cliente) — verificados a mano
// en /contacto.html y el pie de página de cofiba.es (Port de Cariño 16 A,
// horario, teléfono, WhatsApp, emails). No cambian con la sesión de nadie,
// así que no hace falta pedirlos a cofiba.es en cada visita: se dejan fijos
// aquí y solo habría que tocarlos si la propia web los cambiara alguna vez.
const CONTACTO_COFIBA = {
  direccion: 'Port de Cariño, 16 A · 07011 Palma de Mallorca',
  horario: '08:00 - 15:00h',
  telefono: '971 736 897',
  whatsapp: '676 452 880',
  emails: ['pedidos@cofiba.es', 'info@cofiba.es'],
};

const APP_VERSION = '0.7';

export default function Categorias({ onOpenCategoria, onSearch }) {
  const [categorias, setCategorias] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let huboCache = false;
    api
      .categoriasCached((cacheado) => {
        huboCache = true;
        setCategorias(cacheado);
        setLoading(false);
      })
      .then(setCategorias)
      // Con la caché ya mostrando algo válido, un fallo de red de fondo no
      // debe tapar esos datos con un banner de error confuso.
      .catch((e) => !huboCache && setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="content">
      {/* <form onSubmit> en vez de solo onKeyDown==='Enter': en el teclado
          virtual de algunos móviles (sobre todo Android) el botón "Ir"/
          "Buscar" no siempre dispara un keydown con key==='Enter' que
          React pueda leer, así que se quedaba sin efecto — el submit del
          formulario sí es fiable en cualquier dispositivo. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(q);
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 10 }}
      >
        <input
          placeholder="Producto, referencia, código..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" aria-label="Buscar">
          🔍
        </button>
      </form>

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

      <a
        href="https://www.cofiba.es"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', marginTop: 16 }}
      >
        <button style={{ width: '100%' }}>Ver página original de cofiba.es ↗</button>
      </a>

      <div className="card" style={{ marginTop: 12, marginBottom: 12 }}>
        <p style={{ fontWeight: 500, margin: '0 0 4px' }}>Cofiba Distribuciones</p>
        <p className="muted" style={{ margin: 0 }}>{CONTACTO_COFIBA.direccion}</p>
        <p className="muted" style={{ margin: '2px 0 0' }}>Horario: {CONTACTO_COFIBA.horario}</p>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          Tel. {CONTACTO_COFIBA.telefono} · WhatsApp {CONTACTO_COFIBA.whatsapp}
        </p>
        <p className="muted" style={{ margin: '2px 0 0' }}>{CONTACTO_COFIBA.emails.join(' · ')}</p>
      </div>

      <p className="muted" style={{ textAlign: 'center', fontSize: 11, margin: '4px 0 12px' }}>
        Versión {APP_VERSION}
      </p>
    </div>
  );
}
