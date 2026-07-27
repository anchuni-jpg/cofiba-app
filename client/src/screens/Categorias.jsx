import { useEffect, useState, Suspense, lazy } from 'react';
import { api } from '../api.js';
import { ISLAS } from '../filtroIsla.js';
// La librería de lectura de códigos de barras pesa varios cientos de KB —
// cargarla solo al pulsar el botón de la cámara (en vez de en el bundle
// principal) evita que TODA visita a la app pague ese peso de más solo por
// si acaso alguien escanea algo.
const BarcodeScanner = lazy(() => import('../components/BarcodeScanner.jsx'));

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

const APP_VERSION = '0.9';

// Cofiba no da un icono por categoría — esto es solo decorativo, para que la
// rejilla se reconozca de un vistazo. Por palabra clave en el slug (no
// coincidencia exacta) para que aguante si cofiba.es renombra alguna
// categoría ligeramente; 📦 de reserva para cualquiera que no encaje.
function iconoCategoria(slug) {
  const s = slug || '';
  if (s.includes('playa')) return '🏖️';
  if (s.includes('fumador')) return '🚬';
  if (s.includes('juguete')) return '🧸';
  if (s.includes('juego')) return '🎲';
  if (s.includes('textil')) return '👕';
  if (s.includes('postal')) return '🖼️';
  if (s.includes('pila')) return '🔋';
  if (s.includes('arte')) return '🎨';
  if (s.includes('souvenir')) return '🎁';
  if (s.includes('multiprecio')) return '🏷️';
  return '📦';
}

export default function Categorias({ onOpenCategoria, onSearch, islaFiltro, onCambiarIsla, onCartChanged }) {
  const [categorias, setCategorias] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [escaneando, setEscaneando] = useState(false);

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
        <button type="button" onClick={() => setEscaneando(true)} aria-label="Escanear código de barras">
          📷
        </button>
      </form>

      {escaneando && (
        <Suspense fallback={null}>
          <BarcodeScanner onCerrar={() => setEscaneando(false)} onCartChanged={onCartChanged} />
        </Suspense>
      )}

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Cargando categorías…</p>}

      <p className="muted" style={{ marginBottom: 8 }}>
        Categorías
      </p>
      <div className="cat-grid">
        {categorias.map((c) => (
          <button
            key={c.slug}
            className="cat-tile"
            onClick={() => onOpenCategoria(c)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{iconoCategoria(c.slug)}</span>
            {c.nombre}
          </button>
        ))}
      </div>

      {/* Filtro global de isla: al activar una, Productos/Búsqueda/Histórico
          esconden lo que su nombre diga claramente de otra isla distinta —
          ver filtroIsla.js. Pulsar la ya activa la quita (vuelve a enseñar
          todo). */}
      <div
        style={{
          display: 'flex',
          marginTop: 16,
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        {ISLAS.map((isla, idx) => {
          const activa = islaFiltro === isla.valor;
          return (
            <button
              key={isla.valor}
              onClick={() => onCambiarIsla(isla.valor)}
              style={{
                flex: 1,
                borderRadius: 0,
                border: 'none',
                borderLeft: idx > 0 ? '1px solid var(--border)' : 'none',
                background: activa ? 'var(--accent)' : 'var(--surface-1)',
                color: activa ? '#fff' : 'var(--text-primary)',
                padding: '14px 4px',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {isla.nombre}
            </button>
          );
        })}
      </div>

      <a
        href="https://www.cofiba.es"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', marginTop: 8 }}
      >
        <button className="primary" style={{ width: '100%' }}>
          Página oficial ↗
        </button>
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
