import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getCache, setCache } from '../localCache.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import FichaProducto from '../components/FichaProducto.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';
import { productosRecordados } from '../compradosLocal.js';

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

export default function Historico({
  onCartChanged,
  codigosEnCarrito,
  codigosSesion,
  onIrACategoria,
  islaFiltro,
  vista,
  onCambiarVista,
}) {
  // Mismo criterio que Productos.jsx/Busqueda.jsx: 'lista'/'lista-grande'
  // son de fila, 'grid2'/'grid3' de rejilla; `grande` solo agranda la fila.
  const esFila = vista === 'lista' || vista === 'lista-grande';
  const grande = vista === 'lista-grande';
  const columnas = vista === 'grid3' ? 3 : 2;
  const [filtro, setFiltro] = useState('');
  // Cuántos artículos revelar de golpe (y cuántos más cada "Ver más") —
  // mismo control y misma clave de localStorage que Productos.jsx, para que
  // sea UNA sola preferencia de "cuánto me gusta ver de golpe" en toda la
  // app, no una distinta por pantalla.
  const [limite, setLimite] = useState(() => Number(localStorage.getItem('cofiba:limite')) || 25);
  function cambiarLimite(n) {
    setLimite(n);
    localStorage.setItem('cofiba:limite', String(n));
    setVisibles(n);
  }
  // Lee la sección real "Comprados recientemente" de cofiba.es
  // (/consumo.html): TODO lo comprado en la cuenta, no solo desde la app.
  // El recorrido de sus páginas lo hace el servidor (historicoStore.js) y
  // recuerda por dónde iba; aquí solo se pregunta cada pocos segundos cómo
  // va mientras la pestaña está abierta. Lo último visto se guarda en el
  // dispositivo para pintarlo al instante la próxima vez.
  const [productosServidor, setProductos] = useState([]);
  const [progreso, setProgreso] = useState({ paginasCargadas: 0, totalPaginas: null, completo: false, corriendo: true });
  const cargandoTodo = !progreso.completo;
  const [visibles, setVisibles] = useState(limite);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  // Artículos que cofiba.es acaba de rechazar al intentar añadirlos (ver
  // ARTICULO_NO_DISPONIBLE en el servidor) — el histórico en sí no los
  // esconde (es un hecho pasado real), pero deja de ofrecer repetir su
  // compra hasta que vuelva a estar disponible.
  const [noDisponibles, setNoDisponibles] = useState(new Set());
  // Categorías/subcategorías ya repasadas — tocar la franja verde de la
  // cabecera QUITA el grupo entero de la vista (cabecera incluida, no solo
  // sus artículos), para ir despejando la pantalla a medida que se procesa
  // el pedido en vez de tener que desplazarse otra vez por lo ya revisado.
  // Estado local (no localStorage): al salir de Histórico y volver a entrar
  // (el componente se desmonta/monta con cada cambio de pestaña) este set
  // se reinicia solo y todo vuelve a aparecer, listo para la próxima vez.
  const [quitados, setQuitados] = useState(new Set());
  function quitarGrupo(clave) {
    setQuitados((prev) => new Set(prev).add(clave));
  }
  const [zoomProducto, setZoomProducto] = useState(null);
  // Cada bucle de consultas lleva su número; al salir de la pestaña o pulsar
  // "Actualizar" el anterior se da por superado y deja de preguntar.
  const bucleIdRef = useRef(0);
  const CLAVE_CACHE = 'historico:v3';
  const guardadoRef = useRef(0); // cuántos productos hay guardados en el móvil

  function consultar({ forzar }) {
    const miId = ++bucleIdRef.current;
    const vigente = () => bucleIdRef.current === miId;
    let version = null;
    let primera = true;
    setError(null);
    if (forzar) setProgreso((p) => ({ ...p, completo: false, corriendo: true, paginasCargadas: 0 }));

    (async () => {
      let fallosSeguidos = 0;
      while (vigente()) {
        try {
          const data = await api.historico({ version, forzar: forzar && primera });
          primera = false;
          if (!vigente()) return;
          fallosSeguidos = 0;
          version = data.version;
          setProgreso({
            paginasCargadas: data.paginasCargadas,
            totalPaginas: data.totalPaginas,
            completo: data.completo,
            corriendo: data.corriendo,
          });
          if (!data.sinCambios && data.productos) {
            // Mientras el servidor no ha terminado, su lista puede ser más
            // corta que la ya guardada en el dispositivo (p. ej. si se
            // reinició y empieza de nuevo): no se pisa una lista mejor con
            // una peor. Al completarse, manda siempre la del servidor.
            setProductos((actual) => {
              if (!data.completo && data.productos.length < actual.length) return actual;
              return data.productos;
            });
            // Lo guardado en el móvil solo se sustituye por algo igual o
            // mejor (o por el histórico ya completo): antes, una respuesta
            // corta del servidor recién reiniciado lo machacaba.
            if (data.completo || data.productos.length >= guardadoRef.current) {
              guardadoRef.current = data.productos.length;
              setCache(CLAVE_CACHE, data.productos);
            }
            if (data.productos.length > 0) setLoading(false);
          }
          if (data.completo) setLoading(false);
          // Error del recorrido en el servidor (p. ej. cofiba.es no
          // contestó): se enseña, pero se sigue preguntando — la siguiente
          // consulta lo reintenta sola desde la página donde se quedó.
          setError(data.error ? `Cofiba.es va lento, reintentando… (${data.error})` : null);
          if (data.completo && !data.corriendo) return;
        } catch (e) {
          if (!vigente()) return;
          fallosSeguidos += 1;
          if (fallosSeguidos >= 2) setError(e.message);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
  }

  useEffect(() => {
    // Primero lo guardado en el móvil, LUEGO se empieza a preguntar al
    // servidor (si no, su primera respuesta podía llegar antes y ganar).
    let vivo = true;
    getCache(CLAVE_CACHE).then((cacheado) => {
      if (!vivo) return;
      if (cacheado?.length) {
        guardadoRef.current = cacheado.length;
        setProductos(cacheado);
        setLoading(false);
      }
      consultar({ forzar: false });
    });
    // Al salir de la pestaña se deja de preguntar; el servidor pausa el
    // recorrido solo al no recibir consultas, y lo retoma al volver.
    return () => {
      vivo = false;
      bucleIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function actualizar() {
    consultar({ forzar: true });
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
        ? api.anadirAlCarrito({ articulo: p.articulo, cantidad: nueva })
        : nueva === 0
        ? api.eliminarDelCarrito(p.articulo)
        : api.actualizarCantidadCarrito({ articulo: p.articulo, cantidad: nueva });

    promesa
      .then(() => onCartChanged())
      .catch((e) => {
        setPending((s) => ({ ...s, [p.articulo]: anterior }));
        // A diferencia de Catálogo/Búsqueda, aquí NO se quita la fila (es un
        // hecho de compra real pasado, esconderlo falsearía el histórico) —
        // solo se deja de ofrecer repetirla hasta que vuelva a estar
        // disponible.
        if (e.code === 'ARTICULO_NO_DISPONIBLE') setNoDisponibles((s) => new Set(s).add(p.articulo));
        setError(e.message);
      });
  }

  // Icono de carrito: distinto de estar en esta pantalla (que ya significa
  // "comprado alguna vez") — este marca lo que está en el carrito AHORA o se
  // pidió en esta sesión, igual que en Productos/Búsqueda.
  function enCarritoOSesion(articulo) {
    // pending[articulo] es el contador local, que ya cambia al instante al
    // pulsar +/- (antes de que cofiba.es confirme nada) — mirarlo aquí
    // también hace que el icono aparezca al momento, no solo el número.
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo) || (pending[articulo] ?? 0) > 0);
  }

  // Mientras el servidor no ha leído todo el histórico, se completa con lo
  // que este móvil ya ha visto como comprado (navegando el catálogo o en
  // visitas anteriores) — ver compradosLocal.js.
  const listaHistorico = (() => {
    if (progreso.completo) return productosServidor;
    const yaEstan = new Set(productosServidor.map((p) => p.articulo));
    return productosServidor.concat(productosRecordados().filter((p) => !yaEstan.has(p.articulo)));
  })();
  const productos = listaHistorico;

  const productosPorTexto = filtro.trim()
    ? productos.filter((p) => {
        const t = normalizar(filtro);
        return normalizar(p.nombre).includes(t) || normalizar(p.referencia || p.articulo).includes(t);
      })
    : productos;
  // Orden: categoría → subcategoría → nombre. El histórico llega de
  // /consumo.html en orden cronológico (más reciente primero) — se
  // reordena aquí, no en el servidor, porque solo aquí se conoce ya el
  // "categoriaNombre"/"subcategoriaNombre" con el que agrupar (vienen del
  // índice del catálogo, que puede completarse después de que ya se
  // hubiera pedido esta página). El mismo artículo comprado varias veces
  // en fechas distintas no se fusiona en una sola fila — sigue apareciendo
  // una vez por compra, solo que ahora una junto a la otra.
  const productosFiltrados = filtrarPorIsla(productosPorTexto, islaFiltro)
    .slice()
    .sort((a, b) => {
      const catA = a.categoriaNombre || 'Sin categoría';
      const catB = b.categoriaNombre || 'Sin categoría';
      if (catA !== catB) return catA.localeCompare(catB, 'es');
      const subA = a.subcategoriaNombre || a.subcategoria || 'Otros';
      const subB = b.subcategoriaNombre || b.subcategoria || 'Otros';
      if (subA !== subB) return subA.localeCompare(subB, 'es');
      return normalizar(a.nombre || a.referencia || a.articulo).localeCompare(
        normalizar(b.nombre || b.referencia || b.articulo),
        'es'
      );
    });
  const visiblesLista = productosFiltrados.slice(0, visibles);
  const hayMasParaRevelar = visibles < productosFiltrados.length;

  // Para saber, al pintar cada fila, si hace falta abrir un grupo nuevo
  // (cabecera de categoría y/o subcategoría) comparando con la fila
  // anterior YA VISIBLE — no con la anterior en la lista completa, que
  // podría no estar pintada todavía si `visibles` la dejó fuera.
  function grupoDe(p) {
    return {
      categoria: p.categoriaNombre || 'Sin categoría',
      subcategoria: p.subcategoriaNombre || p.subcategoria || 'Otros',
    };
  }
  function claveGrupo(grupo) {
    return `${grupo.categoria}||${grupo.subcategoria}`;
  }

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>Comprados recientemente</p>
        <button
          onClick={actualizar}
          disabled={cargandoTodo}
          aria-label="Actualizar histórico"
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          {cargandoTodo ? '⟳ Actualizando…' : '⟳ Actualizar'}
        </button>
        <button onClick={onCambiarVista} aria-label="Cambiar vista" style={{ padding: '6px 10px', fontSize: 12 }}>
          {vista === 'lista' ? '☰ Lista' : vista === 'lista-grande' ? '☰ Lista XL' : `▦ ${columnas}`}
        </button>
      </div>

      <input
        placeholder="Buscar en tu histórico..."
        value={filtro}
        onChange={(e) => {
          setFiltro(e.target.value);
          setVisibles(limite);
        }}
        style={{ marginBottom: 8 }}
      />

      <select
        value={limite}
        onChange={(e) => cambiarLimite(Number(e.target.value))}
        style={{ fontSize: 12, padding: '6px 8px', marginBottom: 10 }}
        aria-label="Cuántos artículos mostrar"
      >
        <option value={10}>10 artículos</option>
        <option value={25}>25 artículos</option>
        <option value={50}>50 artículos</option>
        <option value={100}>100 artículos</option>
      </select>

      {error && <div className="error-banner">{error}</div>}
      {/* Barra de progreso real (páginas de cofiba.es ya leídas) — cada
          página tarda 15-35s en su servidor; sin progreso visible parecía
          colgado aunque estuviera avanzando. */}
      {cargandoTodo && (
        <div style={{ marginBottom: 10 }}>
          <div className="progreso-barra">
            <div
              style={{
                width: progreso.totalPaginas
                  ? `${Math.max(4, Math.round((progreso.paginasCargadas / progreso.totalPaginas) * 100))}%`
                  : '4%',
              }}
            />
          </div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            {progreso.totalPaginas
              ? `Leyendo tu histórico de Cofiba: página ${progreso.paginasCargadas} de ${progreso.totalPaginas}`
              : 'Leyendo tu histórico de Cofiba…'}
            {' · puedes ir usando lo que ya aparece'}
          </p>
        </div>
      )}
      {loading && (
        <p className="muted">Cargando histórico… (Cofiba tarda bastante en generar esta página, puede llevar hasta medio minuto)</p>
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
        </p>
      )}

      {esFila ? (
        <div>
          {visiblesLista.map((p, idx) => {
            const grupo = grupoDe(p);
            const grupoAnterior = idx > 0 ? grupoDe(visiblesLista[idx - 1]) : null;
            const nuevaCategoria = !grupoAnterior || grupo.categoria !== grupoAnterior.categoria;
            const nuevaSubcategoria = nuevaCategoria || grupo.subcategoria !== grupoAnterior.subcategoria;
            const clave = claveGrupo(grupo);
            const quitado = quitados.has(clave);
            return (
              // La clave incluye la posición: el mismo artículo puede aparecer
              // más de una vez en el histórico real (comprado en fechas
              // distintas), y repetir solo el articulo como key confundía a
              // React (dos filas con la misma key "se superponían" visualmente).
              <div key={`${p.articulo}-${idx}`}>
                {nuevaSubcategoria && !quitado && (
                  <div
                    onClick={() => quitarGrupo(clave)}
                    style={{
                      marginTop: idx === 0 ? 0 : 16,
                      marginBottom: 6,
                      background: 'var(--accent-bg)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: 6,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {nuevaCategoria && (
                        <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 3px' }}>{grupo.categoria}</p>
                      )}
                      <p
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          margin: 0,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          color: 'var(--accent)',
                        }}
                      >
                        {grupo.subcategoria}
                      </p>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0, fontWeight: 700 }}>
                      ✕ Quitar
                    </span>
                  </div>
                )}
                {!quitado && (
                <div
                  className={`product-row${grande ? ' product-row-lg' : ''}${enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''}`}
                  onClick={() => setZoomProducto(p)}
                  style={{ cursor: 'zoom-in' }}
                >
              <div className="product-thumb" style={grande ? { width: 92, height: 92 } : undefined}>
                {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: grande ? 17 : 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.nombre || p.referencia || p.articulo}
                </p>
                <p className="muted" style={grande ? { fontSize: 14, margin: '4px 0' } : { margin: '2px 0' }}>
                  Ref. {p.referencia || p.articulo}
                </p>
                <p style={{ fontSize: grande ? 17 : 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                  {p.precioFinal ? `${p.precioFinal}€` : '—'}
                  {enCarritoOSesion(p.articulo) && (
                    <span style={{ marginLeft: 5 }}>
                      <CarritoIcon size={grande ? 17 : 13} />
                    </span>
                  )}
                </p>
                {p.categoria && (
                  <button
                    className="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onIrACategoria?.(p.categoria, p.categoriaNombre, p.subcategoria);
                    }}
                    style={{ fontSize: grande ? 13 : 11, padding: grande ? '5px 10px' : '3px 8px', marginTop: 3 }}
                  >
                    Ver más
                  </button>
                )}
              </div>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
                {noDisponibles.has(p.articulo) ? (
                  <span className="muted" style={{ fontSize: 10, color: 'var(--danger)', textAlign: 'center' }}>
                    No disponible
                  </span>
                ) : (
                  <div className={grande ? 'qty-stepper qty-stepper-lg' : 'qty-stepper'}>
                    <button onClick={() => añadir(p, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: grande ? 16 : 13 }}>{pending[p.articulo] ?? 0}</span>
                    <button onClick={() => añadir(p, 1)}>+</button>
                  </div>
                )}
                {p.undVenta && (
                  <span className="muted" style={{ fontSize: grande ? 13 : 11 }}>
                    caja de {formatoCaja(p.undVenta)} uds
                  </span>
                )}
              </div>
            </div>
                )}
          </div>
            );
          })}
        </div>
      ) : (
        <div className="producto-grid" style={{ gridTemplateColumns: `repeat(${columnas}, 1fr)` }}>
          {visiblesLista.map((p, idx) => {
            const grupo = grupoDe(p);
            const grupoAnterior = idx > 0 ? grupoDe(visiblesLista[idx - 1]) : null;
            const nuevaCategoria = !grupoAnterior || grupo.categoria !== grupoAnterior.categoria;
            const nuevaSubcategoria = nuevaCategoria || grupo.subcategoria !== grupoAnterior.subcategoria;
            const clave = claveGrupo(grupo);
            const quitado = quitados.has(clave);
            return (
              <Fragment key={`${p.articulo}-${idx}`}>
                {nuevaSubcategoria && !quitado && (
                  <div
                    onClick={() => quitarGrupo(clave)}
                    style={{
                      gridColumn: '1 / -1',
                      marginTop: idx === 0 ? 0 : 10,
                      marginBottom: 4,
                      background: 'var(--accent-bg)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: 6,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {nuevaCategoria && (
                        <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 3px' }}>{grupo.categoria}</p>
                      )}
                      <p
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          margin: 0,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          color: 'var(--accent)',
                        }}
                      >
                        {grupo.subcategoria}
                      </p>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0, fontWeight: 700 }}>
                      ✕ Quitar
                    </span>
                  </div>
                )}
                {!quitado && (
                <div
                  className={`producto-card${enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''}`}
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
                {p.nombre || p.referencia || p.articulo}
              </p>
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                {p.precioFinal ? `${p.precioFinal}€` : '—'}
                {enCarritoOSesion(p.articulo) && (
                  <span style={{ marginLeft: 4 }}>
                    <CarritoIcon size={11} />
                  </span>
                )}
              </p>
              {p.categoria && (
                <button
                  className="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onIrACategoria?.(p.categoria, p.categoriaNombre, p.subcategoria);
                  }}
                  style={{ fontSize: 10, padding: '3px 8px', marginTop: 3 }}
                >
                  Ver más
                </button>
              )}
              {/* Todo el bloque final (paso +/- o "No disponible", más la
                  etiqueta de caja) va en marginTop:'auto' — empuja lo que
                  sea que haya al fondo de la tarjeta, igual en toda la fila
                  aunque el nombre o el botón "Ver más" ocupen distinto
                  espacio arriba de una tarjeta a otra. */}
              <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                {noDisponibles.has(p.articulo) ? (
                  <span
                    className="muted"
                    style={{ fontSize: 10, color: 'var(--danger)', display: 'block' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    No disponible
                  </span>
                ) : (
                  <div className="qty-stepper" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => añadir(p, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{pending[p.articulo] ?? 0}</span>
                    <button onClick={() => añadir(p, 1)}>+</button>
                  </div>
                )}
              </div>
              {p.undVenta && (
                <span className="muted" style={{ fontSize: 10 }}>
                  caja de {formatoCaja(p.undVenta)} uds
                </span>
              )}
                </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {hayMasParaRevelar && (
        <div style={{ padding: '12px 0', textAlign: 'center' }}>
          <button onClick={() => setVisibles((v) => v + limite)} style={{ width: '100%' }}>
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
        <FichaProducto
          lista={productosFiltrados.filter((p) => !quitados.has(claveGrupo(grupoDe(p))))}
          inicial={zoomProducto}
          onCerrar={() => setZoomProducto(null)}
          pending={pending}
          añadir={añadir}
          noDisponibles={noDisponibles}
          error={error}
        />
      )}
    </div>
  );
}
