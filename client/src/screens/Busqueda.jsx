import { useEffect, useRef, useState, Suspense, lazy } from 'react';
import { api } from '../api.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';

// Igual que en Categorias.jsx: solo se descarga si de verdad se usa.
const BarcodeScanner = lazy(() => import('../components/BarcodeScanner.jsx'));

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds"). Duplica formatoCaja de
// Productos.jsx — es una línea, no vale la pena compartir el módulo por eso.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Duplica nivelStock de Productos.jsx — 10 cajas o más: "STOCK" en verde,
// sin número; por debajo: "STOCK BAJO" en el color de aviso.
function nivelStock(stock, undVenta) {
  if (!Number.isFinite(stock)) return null;
  const unidadesPorCaja = parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
  const cajas = stock / unidadesPorCaja;
  if (cajas >= 10) return { texto: 'STOCK', bajo: false };
  return cajas <= 0 ? { texto: 'AGOTADO', bajo: true } : { texto: 'STOCK BAJO', bajo: true };
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

export default function Busqueda({
  termino,
  codigoEscaneado,
  onCodigoConsumido,
  onBack,
  onCartChanged,
  codigosEnCarrito,
  codigosSesion,
  islaFiltro,
  vistaColumnas,
  onCambiarVista,
}) {
  // La barra de búsqueda vive en esta misma pantalla (no solo en Categorías)
  // para poder encadenar una búsqueda tras otra sin tener que volver atrás.
  // `terminoActivo` es la que de verdad dispara la consulta; `campo` es solo
  // lo que se está escribiendo, para no relanzar la búsqueda en cada tecla.
  const [terminoActivo, setTerminoActivo] = useState(termino);
  const [campo, setCampo] = useState(termino);
  const [escaneando, setEscaneando] = useState(false);
  // Código de barras a la espera de un resultado exacto — al llegar
  // `resultados`, si alguno coincide de verdad (ean/referencia/articulo) se
  // abre su ficha directamente en vez de dejar solo la lista. Se consume
  // (null) en cuanto se usa, tanto si hubo coincidencia como si no, para no
  // intentarlo de nuevo en una búsqueda posterior sin relación.
  const [autoAbrirCodigo, setAutoAbrirCodigo] = useState(null);
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
  // Artículos que cofiba.es acaba de rechazar al intentar añadirlos (ver
  // ARTICULO_NO_DISPONIBLE en el servidor) — se quitan de la vista al
  // momento, sin esperar a la próxima búsqueda.
  const [noDisponibles, setNoDisponibles] = useState(new Set());
  const [zoomProducto, setZoomProducto] = useState(null);
  // "También te puede interesar" (afinidad por subcategoría + popularidad
  // global) — se pide solo al abrir la ficha, no para toda la lista.
  const [relacionados, setRelacionados] = useState(null);
  useEffect(() => {
    if (!zoomProducto) {
      setRelacionados(null);
      return;
    }
    let cancelado = false;
    setRelacionados(null);
    api
      .relacionados(zoomProducto.articulo)
      .then((data) => {
        if (!cancelado) setRelacionados(data.productos || []);
      })
      .catch(() => {
        if (!cancelado) setRelacionados([]);
      });
    return () => {
      cancelado = true;
    };
  }, [zoomProducto]);
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

  // Compartida por el escáner de aquí mismo y por el de Categorías (vía
  // `codigoEscaneado`, más abajo) — lanza la búsqueda y deja el código
  // marcado para que, en cuanto lleguen resultados, se intente abrir la
  // ficha directamente.
  function buscarPorCodigo(codigo) {
    setCampo(codigo);
    setTerminoActivo(codigo);
    setAutoAbrirCodigo(codigo);
    setNonce((n) => n + 1);
  }

  // Un escaneo hecho desde Categorías llega como prop (esta pantalla ni
  // siquiera estaba montada todavía cuando ocurrió) — se consume una sola
  // vez para no repetir la búsqueda si el componente se vuelve a renderizar.
  useEffect(() => {
    if (!codigoEscaneado) return;
    buscarPorCodigo(codigoEscaneado);
    onCodigoConsumido?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoEscaneado]);

  // En cuanto hay resultados y queda un código de barras por resolver, se
  // busca una coincidencia EXACTA (no basta con que el término aparezca
  // dentro, como hace el buscador normal) por ean, referencia o articulo —
  // y se abre su ficha sola. Si no hay ninguna coincidencia exacta, se deja
  // la lista de resultados normal y ya está (no es un fallo, simplemente el
  // código no se pudo emparejar con precisión).
  useEffect(() => {
    if (!autoAbrirCodigo || !resultados) return;
    const match = resultados.find(
      (p) => p.ean === autoAbrirCodigo || p.referencia === autoAbrirCodigo || p.articulo === autoAbrirCodigo
    );
    if (match) setZoomProducto(match);
    setAutoAbrirCodigo(null);
  }, [resultados, autoAbrirCodigo]);

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
        // cofiba.es lo sigue enseñando en su buscador pero ya no lo vende de
        // verdad — se quita de esta vista al momento (el servidor ya lo
        // esconde de las próximas búsquedas durante unos días).
        if (e.code === 'ARTICULO_NO_DISPONIBLE') setNoDisponibles((s) => new Set(s).add(p.articulo));
        setError(e.message);
      });
  }

  const resultadosDisponibles =
    resultados && noDisponibles.size ? resultados.filter((p) => !noDisponibles.has(p.articulo)) : resultados;
  const resultadosFiltrados = resultadosDisponibles ? filtrarPorIsla(resultadosDisponibles, islaFiltro) : resultadosDisponibles;

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>Búsqueda</p>
        <button onClick={onCambiarVista} aria-label="Cambiar vista" style={{ padding: '6px 10px', fontSize: 12 }}>
          {vistaColumnas === 1 ? '☰ Lista' : `▦ ${vistaColumnas}`}
        </button>
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
        <button type="button" onClick={() => setEscaneando(true)} aria-label="Escanear código de barras">
          📷
        </button>
      </form>

      {escaneando && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onCerrar={() => setEscaneando(false)}
            onDetectado={(codigo) => {
              setEscaneando(false);
              buscarPorCodigo(codigo);
            }}
          />
        </Suspense>
      )}

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
          {vistaColumnas === 1 ? (
            <div>
              {resultadosFiltrados.slice(0, visibles).map((p) => (
                <div
                  className={`product-row${p.comprado ? ' product-row-comprado' : ''}${
                    enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''
                  }`}
                  key={p.articulo}
                  onClick={() => setZoomProducto(p)}
                  style={{ cursor: 'zoom-in' }}
                >
                  <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.nombre}
                    </p>
                    <p className="muted" style={{ margin: '2px 0' }}>
                      Ref. {p.referencia || p.articulo} · {p.categoriaNombre}
                      {p.comprado && <strong style={{ color: 'var(--accent)' }}> · Comprado</strong>}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                      {p.precioFinal ? `${p.precioFinal}€` : '—'}
                      {enCarritoOSesion(p.articulo) && (
                        <span style={{ marginLeft: 5 }}>
                          <CarritoIcon />
                        </span>
                      )}
                      {(() => {
                        const info = nivelStock(p.stock, p.undVenta);
                        return (
                          info && (
                            <span style={{ marginLeft: 5, fontSize: 11, color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                              {info.texto}
                            </span>
                          )
                        );
                      })()}
                    </p>
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                  >
                    <div className="qty-stepper">
                      <button onClick={() => añadir(p, -1)}>-</button>
                      <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending[p.articulo] ?? 0}</span>
                      <button onClick={() => añadir(p, 1)}>+</button>
                    </div>
                    {p.undVenta && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        caja de {formatoCaja(p.undVenta)} uds
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="producto-grid" style={{ gridTemplateColumns: `repeat(${vistaColumnas}, 1fr)` }}>
              {resultadosFiltrados.slice(0, visibles).map((p) => (
                <div
                  className={`producto-card${p.comprado ? ' product-row-comprado' : ''}${
                    enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''
                  }`}
                  key={p.articulo}
                  onClick={() => setZoomProducto(p)}
                  style={{ cursor: 'zoom-in' }}
                >
                  <div className="product-thumb">{p.imagen ? <img src={p.imagen} alt="" /> : '—'}</div>
                  <p
                    style={{
                      fontSize: 13,
                      margin: '4px 0 0',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {p.nombre}
                  </p>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                    {p.precioFinal ? `${p.precioFinal}€` : '—'}
                    {enCarritoOSesion(p.articulo) && (
                      <span style={{ marginLeft: 4 }}>
                        <CarritoIcon size={11} />
                      </span>
                    )}
                    {(() => {
                      const info = nivelStock(p.stock, p.undVenta);
                      return (
                        info && (
                          <span style={{ marginLeft: 4, fontSize: 10, color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                            {info.texto}
                          </span>
                        )
                      );
                    })()}
                  </p>
                  <div className="qty-stepper" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => añadir(p, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending[p.articulo] ?? 0}</span>
                    <button onClick={() => añadir(p, 1)}>+</button>
                  </div>
                  {p.undVenta && (
                    <span className="muted" style={{ fontSize: 10 }}>
                      caja de {formatoCaja(p.undVenta)} uds
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
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
              {(() => {
                const info = nivelStock(zoomProducto.stock, zoomProducto.undVenta);
                return (
                  info && <span style={{ color: info.bajo ? 'var(--danger)' : 'var(--accent)' }}> · {info.texto}</span>
                );
              })()}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              {noDisponibles.has(zoomProducto.articulo) ? (
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Ya no está disponible</span>
              ) : (
                <div className="qty-stepper">
                  <button onClick={() => añadir(zoomProducto, -1)}>-</button>
                  <span style={{ minWidth: 20, textAlign: 'center' }}>{pending[zoomProducto.articulo] ?? 0}</span>
                  <button onClick={() => añadir(zoomProducto, 1)}>+</button>
                </div>
              )}
              <button onClick={() => setZoomProducto(null)}>Cerrar</button>
            </div>

            {relacionados && relacionados.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>También te puede interesar</p>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                  {relacionados.map((r) => (
                    <div
                      key={r.articulo}
                      style={{ flexShrink: 0, width: 84, textAlign: 'center', cursor: 'pointer' }}
                      onClick={() => setZoomProducto(r)}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          añadir(r, 1);
                        }}
                        style={{ fontSize: 10, padding: '2px 6px', marginTop: 2 }}
                      >
                        {pending[r.articulo] ? `✓ ${pending[r.articulo]}` : '+ Añadir'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
