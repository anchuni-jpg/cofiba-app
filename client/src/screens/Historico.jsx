import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { getCache } from '../localCache.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';

// Duplica formatoCaja de Productos.jsx/Busqueda.jsx — una línea, no vale la
// pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Insensible a acentos/mayúsculas — duplica normalizar() de indiceStore.js
// del lado del servidor, para filtrar aquí lo que ya se cargó sin ir y
// volver al servidor por cada tecla.
function normalizar(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const TANDA = 20;

export default function Historico({ onCartChanged, codigosEnCarrito, codigosSesion, onIrACategoria, islaFiltro }) {
  const [filtro, setFiltro] = useState('');
  // Esto ya no es un historial que llevemos nosotros — lee directamente la
  // sección real "Comprados recientemente" de cofiba.es (/consumo.html), así
  // que refleja TODO lo comprado en la cuenta, no solo lo hecho desde la app.
  //
  // `paginas[i]` guarda los productos de la página real i-ésima. Se rellena
  // por posición (nunca se concatena a ciegas) para que aplicar la misma
  // página dos veces —una vez desde la caché local y otra con la respuesta
  // de verdad— sustituya en vez de duplicar. El recorrido de TODAS las
  // páginas se dispara solo con abrir la pestaña, sin esperar a que se pulse
  // ningún botón — "Ver más" solo revela más de lo que ya se ha traído (20
  // en 20, como en Búsqueda), nunca dispara una petición nueva por sí mismo.
  const [paginas, setPaginas] = useState([]);
  const [totalPaginas, setTotalPaginas] = useState(null);
  const [paginasCargadas, setPaginasCargadas] = useState(0);
  const [cargandoTodo, setCargandoTodo] = useState(true);
  const [visibles, setVisibles] = useState(TANDA);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [zoomProducto, setZoomProducto] = useState(null);

  const productos = paginas.flat();

  useEffect(() => {
    let cancelado = false;

    // Reconstruye al instante (sin red) todo lo que ya se había recorrido en
    // este dispositivo, encadenando la caché por su propio siguientePagina —
    // así reabrir Histórico no repite la espera real de páginas que ya se
    // habían completado antes: antes, aunque la caché mostrara el dato al
    // momento, el recorrido de fondo esperaba igualmente la respuesta real
    // de CADA página ya conocida antes de poder avanzar a una nueva, así que
    // "se ponía al día" desde cero cada vez que se abría la pestaña.
    async function reconstruirDesdeCache() {
      const paginasCache = [];
      let totalPaginasCache = null;
      let pageUrl = null;
      do {
        const cacheado = await getCache(`historico:${pageUrl || ''}`);
        if (!cacheado) break;
        paginasCache.push(cacheado.productos);
        totalPaginasCache = cacheado.totalPaginas;
        pageUrl = cacheado.siguientePagina || null;
      } while (pageUrl);
      return { paginasCache, totalPaginasCache, siguientePageUrl: pageUrl };
    }

    async function recorrerTodo() {
      const { paginasCache, totalPaginasCache, siguientePageUrl } = await reconstruirDesdeCache();
      if (cancelado) return;

      if (paginasCache.length) {
        setPaginas(paginasCache);
        setTotalPaginas(totalPaginasCache);
        setPaginasCargadas(paginasCache.length);
        setLoading(false);
      }

      // Si ya no hay más "siguiente" y algo se había cacheado, es que la
      // última vez se llegó al final del histórico real — nada que rastrear.
      if (paginasCache.length && !siguientePageUrl) {
        setCargandoTodo(false);
        return;
      }

      let pageUrl = siguientePageUrl;
      let indice = paginasCache.length;
      do {
        let huboCache = false;
        const promesa = api.historicoCached({ pageUrl }, (cacheado) => {
          if (cancelado) return;
          huboCache = true;
          const i = indice;
          setPaginas((prev) => {
            const copia = [...prev];
            copia[i] = cacheado.productos;
            return copia;
          });
          setTotalPaginas(cacheado.totalPaginas);
          setPaginasCargadas((prev) => Math.max(prev, i + 1));
          if (i === 0) setLoading(false);
        });

        let data;
        try {
          data = await promesa;
        } catch (e) {
          if (!cancelado && !huboCache) setError(e.message);
          break;
        }
        if (cancelado) return;

        const i = indice;
        setPaginas((prev) => {
          const copia = [...prev];
          copia[i] = data.productos;
          return copia;
        });
        setTotalPaginas(data.totalPaginas);
        setPaginasCargadas((prev) => Math.max(prev, i + 1));
        if (i === 0) setLoading(false);

        pageUrl = data.siguientePagina || null;
        indice += 1;
      } while (pageUrl && !cancelado);
      if (!cancelado) setCargandoTodo(false);
    }

    recorrerTodo();
    return () => {
      cancelado = true;
    };
  }, []);

  // No se espera a que cofiba.es confirme antes de reaccionar: el contador
  // cambia al instante y la petición sigue sola en segundo plano. Solo si de
  // verdad falla se corrige el contador y se avisa, y entonces sí, no antes.
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
      .then(() => onCartChanged())
      .catch((e) => {
        setPending((s) => ({ ...s, [p.articulo]: anterior }));
        setError(e.message);
      });
  }

  // Icono de carrito: distinto de estar en esta pantalla (que ya significa
  // "comprado alguna vez") — este marca lo que está en el carrito AHORA o se
  // pidió en esta sesión, igual que en Productos/Búsqueda.
  function enCarritoOSesion(articulo) {
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo));
  }

  const productosPorTexto = filtro.trim()
    ? productos.filter((p) => {
        const t = normalizar(filtro);
        return normalizar(p.nombre).includes(t) || normalizar(p.referencia || p.articulo).includes(t);
      })
    : productos;
  const productosFiltrados = filtrarPorIsla(productosPorTexto, islaFiltro);
  const visiblesLista = productosFiltrados.slice(0, visibles);
  const hayMasParaRevelar = visibles < productosFiltrados.length;

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <p style={{ fontWeight: 500, marginBottom: 10 }}>Comprados recientemente</p>

      <input
        placeholder="Buscar en tu histórico..."
        value={filtro}
        onChange={(e) => {
          setFiltro(e.target.value);
          setVisibles(TANDA);
        }}
        style={{ marginBottom: 10 }}
      />

      {error && <div className="error-banner">{error}</div>}
      {loading && (
        <p className="muted">Cargando histórico… (cofiba.es tarda bastante en generar esta página, puede llevar hasta medio minuto)</p>
      )}

      {!loading && productos.length === 0 && !error && (
        <p className="muted">Aún no hay compras registradas en tu cuenta de cofiba.es.</p>
      )}

      {!loading && productos.length > 0 && productosPorTexto.length === 0 && filtro.trim() && (
        <p className="muted">Ningún producto de tu histórico coincide con "{filtro}".</p>
      )}
      {!loading && productos.length > 0 && productosPorTexto.length > 0 && productosFiltrados.length === 0 && (
        <p className="muted">Ningún producto {filtro.trim() ? 'de esta búsqueda' : 'de tu histórico'} es de la isla seleccionada.</p>
      )}

      {!loading && productos.length > 0 && (
        <p className="muted" style={{ marginBottom: 8 }}>
          {productos.length} producto{productos.length === 1 ? '' : 's'}
          {cargandoTodo
            ? ` · se sigue completando en segundo plano (página ${paginasCargadas} de ${totalPaginas || '…'})`
            : ''}
        </p>
      )}

      <div>
        {visiblesLista.map((p, idx) => (
          // La clave incluye la posición: el mismo artículo puede aparecer
          // más de una vez en el histórico real (comprado en fechas
          // distintas), y repetir solo el articulo como key confundía a
          // React (dos filas con la misma key "se superponían" visualmente).
          <div className="product-row" key={`${p.articulo}-${idx}`}>
            <div
              className="product-thumb"
              onClick={() => p.imagen && setZoomProducto(p)}
              style={{ cursor: p.imagen ? 'zoom-in' : 'default' }}
            >
              {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.nombre || p.referencia || p.articulo}
              </p>
              <p className="muted" style={{ margin: '2px 0' }}>
                Ref. {p.referencia || p.articulo}
              </p>
              <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                {p.precioFinal ? `${p.precioFinal}€` : '—'}
                {enCarritoOSesion(p.articulo) && (
                  <span style={{ marginLeft: 5 }}>
                    <CarritoIcon />
                  </span>
                )}
              </p>
              {p.categoria && (
                <button
                  onClick={() => onIrACategoria?.(p.categoria, p.categoriaNombre, p.subcategoria)}
                  style={{ fontSize: 10, padding: '3px 8px', marginTop: 3 }}
                >
                  Ver más
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div className="qty-stepper">
                <button onClick={() => añadir(p, -1)}>-</button>
                <span style={{ minWidth: 14, textAlign: 'center', fontSize: 12 }}>{pending[p.articulo] ?? 0}</span>
                <button onClick={() => añadir(p, 1)}>+</button>
              </div>
              {p.undVenta && (
                <span className="muted" style={{ fontSize: 10 }}>
                  caja de {formatoCaja(p.undVenta)} uds
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hayMasParaRevelar && (
        <div style={{ padding: '12px 0', textAlign: 'center' }}>
          <button onClick={() => setVisibles((v) => v + TANDA)} style={{ width: '100%' }}>
            Ver más ({productosFiltrados.length - visibles} más)
          </button>
        </div>
      )}

      {!hayMasParaRevelar && cargandoTodo && productos.length > 0 && (
        <p className="muted" style={{ textAlign: 'center', padding: '12px 0' }}>
          Rastreando el resto de tu histórico en segundo plano…
        </p>
      )}

      {zoomProducto && (
        <div
          onClick={() => setZoomProducto(null)}
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
          <img src={zoomProducto.imagen} alt="" style={{ maxWidth: '100%', maxHeight: '65%', objectFit: 'contain' }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              cursor: 'default',
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              width: '100%',
              maxWidth: 420,
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 2px' }}>
              {zoomProducto.nombre || zoomProducto.referencia || zoomProducto.articulo}
            </p>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              Ref. {zoomProducto.referencia || zoomProducto.articulo}
              {zoomProducto.precioFinal ? ` · ${zoomProducto.precioFinal}€` : ''}
              {zoomProducto.undVenta ? ` · caja de ${formatoCaja(zoomProducto.undVenta)} uds` : ''}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="qty-stepper">
                <button onClick={() => añadir(zoomProducto, -1)}>-</button>
                <span style={{ minWidth: 20, textAlign: 'center' }}>{pending[zoomProducto.articulo] ?? 0}</span>
                <button onClick={() => añadir(zoomProducto, 1)}>+</button>
              </div>
              <button onClick={() => setZoomProducto(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
