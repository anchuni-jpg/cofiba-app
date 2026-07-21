import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds"). Duplica formatoCaja de
// Productos.jsx — es una línea, no vale la pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Igual que en Productos.jsx: en vez de sustituir la lista entera en cada
// respuesta (caché, luego la real, luego cada sondeo mientras el índice se
// sigue construyendo), se mantiene el orden de lo ya mostrado y solo se
// añaden al final los artículos nuevos que van apareciendo — así lo que ya
// se vio desde la caché no se reordena ni desaparece un instante mientras
// llegan más resultados.
function combinarResultados(anteriores, frescos) {
  const frescoPorArticulo = new Map(frescos.map((p) => [p.articulo, p]));
  const actualizados = (anteriores || [])
    .filter((p) => frescoPorArticulo.has(p.articulo))
    .map((p) => ({ ...p, ...frescoPorArticulo.get(p.articulo) }));
  const yaVistos = new Set(actualizados.map((p) => p.articulo));
  const nuevos = frescos.filter((p) => !yaVistos.has(p.articulo));
  return [...actualizados, ...nuevos];
}

export default function Busqueda({ termino, onBack, onCartChanged, codigosEnCarrito, codigosSesion, islaFiltro }) {
  // La barra de búsqueda vive en esta misma pantalla (no solo en Categorías)
  // para poder encadenar una búsqueda tras otra sin tener que volver atrás.
  // `terminoActivo` es la que de verdad dispara la consulta; `campo` es solo
  // lo que se está escribiendo, para no relanzar la búsqueda en cada tecla.
  const [terminoActivo, setTerminoActivo] = useState(termino);
  const [campo, setCampo] = useState(termino);
  const [resultados, setResultados] = useState(null);
  const [construyendo, setConstruyendo] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [totalIndice, setTotalIndice] = useState(null);
  // Cuántos de `resultados` se enseñan de momento. En vez de esperar a tener
  // la lista entera (podía tardar si el índice se estaba construyendo, o
  // simplemente ser larga) para pintar algo, se muestran los primeros 20 en
  // cuanto los haya, con un botón para ir revelando el resto de 20 en 20 —
  // así el cliente nunca se queda mirando una pantalla en blanco.
  const TANDA = 20;
  const [visibles, setVisibles] = useState(TANDA);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});
  const [zoomProducto, setZoomProducto] = useState(null);
  // `nonce` sube cada vez que se pulsa buscar aunque el término no cambie —
  // así se puede relanzar la MISMA búsqueda (p. ej. para ver las marcas de
  // "ya comprado" que hayan llegado mientras el histórico se rastrea de
  // fondo), cosa que cambiar solo terminoActivo al mismo valor no haría.
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef(null);

  function buscarDeNuevo() {
    const q = campo.trim();
    if (!q) return;
    setTerminoActivo(q);
    setNonce((n) => n + 1);
  }

  useEffect(() => {
    let cancelado = false;
    let huboCache = false;
    setResultados(null);
    setError(null);
    setConstruyendo(false);
    setProgreso(null);
    setTotalIndice(null);
    setVisibles(TANDA);

    function consultar(primera) {
      // Solo la primera consulta de esta búsqueda mira la caché local (rellena
      // el hueco antes de tener respuesta real, sobre todo si el término ya
      // se buscó antes en este dispositivo); los reintentos mientras el
      // índice se sigue construyendo van directos al servidor, que es quien
      // manda a partir de ahí.
      const promesa = primera
        ? api.buscarCached(terminoActivo, (cacheado) => {
            huboCache = true;
            if (!cancelado) setResultados((prev) => combinarResultados(prev, cacheado.resultados || []));
          })
        : api.buscar(terminoActivo);
      promesa
        .then((data) => {
          if (cancelado) return;
          if (data.error) {
            if (!huboCache) setError(`No se pudo preparar el buscador: ${data.error}`);
            return;
          }
          // Aunque siga construyéndose el índice, ya llegan resultados
          // parciales de lo recorrido hasta ahora — se muestran igual (ver
          // TANDA/visibles más abajo), y se sigue consultando cada pocos
          // segundos para completar la lista según avanza, en vez de dejar
          // al usuario esperando en blanco.
          setResultados((prev) => combinarResultados(prev, data.resultados || []));
          setConstruyendo(!!data.construyendo);
          setProgreso(data.progreso ?? null);
          setTotalIndice(data.totalIndice ?? null);
          if (data.construyendo) pollRef.current = setTimeout(() => consultar(false), 3000);
        })
        // Con la caché ya mostrando resultados válidos, un fallo de red de
        // fondo no debe taparlos con un banner de error confuso.
        .catch((e) => !cancelado && !huboCache && setError(e.message));
    }
    consultar(true);

    return () => {
      cancelado = true;
      clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminoActivo, nonce]);

  // Icono de carrito: distinto de "comprado" (histórico, ver Historico.jsx) —
  // este solo mira si el artículo está AHORA en el carrito real o se pidió
  // en esta misma sesión de la app.
  function enCarritoOSesion(articulo) {
    // pending[articulo] es el contador local, que ya cambia al instante al
    // pulsar +/- (antes de que cofiba.es confirme nada) — mirarlo aquí
    // también hace que el icono aparezca al momento, no solo el número.
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo) || (pending[articulo] ?? 0) > 0);
  }

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
        ? api.anadirAlCarrito({ categoria: p.categoria, articulo: p.articulo, cantidad: nueva, origen: p.origen })
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

  const resultadosFiltrados = resultados ? filtrarPorIsla(resultados, islaFiltro) : resultados;

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0 }}>Búsqueda</p>
      </div>

      {/* form+onSubmit en vez de solo onKeyDown==='Enter': el teclado virtual
          de algunos móviles no siempre dispara un keydown con Enter que
          React pueda leer al pulsar "Ir"/"Buscar" — el submit del
          formulario sí es fiable en cualquier dispositivo. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          buscarDeNuevo();
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 10 }}
      >
        <input
          placeholder="Producto, referencia, código..."
          value={campo}
          onChange={(e) => setCampo(e.target.value)}
        />
        <button type="submit" aria-label="Buscar">
          🔍
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {resultados === null && !error && <p className="muted">Buscando…</p>}

      {/* Antes, mientras el índice se construía y todavía no había NINGÚN
          resultado, esto no pintaba nada (ni "Buscando…", ni el listado, ni
          "no se encontraron") — la pantalla se quedaba completamente en
          blanco, indistinguible de un buscador roto. */}
      {resultados !== null && resultados.length === 0 && construyendo && (
        <p className="muted">
          Preparando el buscador por primera vez, puede tardar unos minutos…
          {totalIndice ? ` (${progreso || 0} de ${totalIndice} productos revisados)` : ''}
        </p>
      )}

      {resultados !== null && resultados.length === 0 && !construyendo && (
        <p className="muted">No se encontraron productos para "{terminoActivo}".</p>
      )}

      {resultados && resultados.length > 0 && resultadosFiltrados.length === 0 && (
        <p className="muted">Ningún resultado es de la isla seleccionada.</p>
      )}

      {resultadosFiltrados && resultadosFiltrados.length > 0 && (
        <>
          <div>
            {resultadosFiltrados.slice(0, visibles).map((p) => (
              <div className={`product-row${p.comprado ? ' product-row-comprado' : ''}`} key={p.articulo}>
                <div
                  className="product-thumb"
                  onClick={() => p.imagen && setZoomProducto(p)}
                  style={{ cursor: p.imagen ? 'zoom-in' : 'default' }}
                >
                  {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 12,
                      margin: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.nombre}
                  </p>
                  <p className="muted" style={{ margin: '2px 0' }}>
                    Ref. {p.referencia || p.articulo} · {p.categoriaNombre}
                    {p.comprado && <strong style={{ color: 'var(--accent)' }}> · Comprado</strong>}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                    {p.precioFinal ? `${p.precioFinal}€` : '—'}
                    {enCarritoOSesion(p.articulo) && (
                      <span style={{ marginLeft: 5 }}>
                        <CarritoIcon />
                      </span>
                    )}
                  </p>
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
          {resultadosFiltrados.length > visibles && (
            <div style={{ padding: '12px 0', textAlign: 'center' }}>
              <button onClick={() => setVisibles((v) => v + TANDA)} style={{ width: '100%' }}>
                Ver más ({resultadosFiltrados.length - visibles} más)
              </button>
            </div>
          )}
        </>
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
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 2px' }}>{zoomProducto.nombre}</p>
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
