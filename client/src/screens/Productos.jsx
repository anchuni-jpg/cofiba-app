import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getCache } from '../localCache.js';
import CarritoIcon from '../components/CarritoIcon.jsx';
import { filtrarPorIsla } from '../filtroIsla.js';

// Entrada vacía para una subcategoría de la que aún no se sabe nada — se usa
// como valor por defecto antes de que llegue ni siquiera la caché.
function entradaVacia() {
  return {
    paginas: [],
    subcategorias: [],
    grupo: null,
    siguienteGrupoSlug: null,
    cargandoMas: true,
    error: null,
    errorDebugHtml: null,
    debugSample: null,
  };
}

// "Und. de venta" llega como texto con formato español ("12,00"); se muestra
// como tamaño de caja legible ("caja de 12 uds").
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// El número exacto de unidades en stock no dice gran cosa por sí solo (¿224
// unidades es mucho o poco si la caja es de 100?) — lo que importa es
// cuántas CAJAS quedan. Con 10 cajas o más se enseña solo "STOCK" (en
// verde, sin número: hay de sobra); por debajo, "STOCK BAJO" en el color de
// aviso, para que salte a la vista sin tener que hacer la cuenta.
function nivelStock(stock, undVenta) {
  if (!Number.isFinite(stock)) return null;
  const unidadesPorCaja = parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
  const cajas = stock / unidadesPorCaja;
  if (cajas >= 10) return { texto: 'STOCK', bajo: false };
  // Agotado de verdad (0 cajas) es distinto de "queda poco" — mismo color de
  // aviso que STOCK BAJO, pero con su propio texto para no dar a entender
  // que todavía se puede pedir alguna caja cuando no queda ninguna.
  return cajas <= 0 ? { texto: 'AGOTADO', bajo: true } : { texto: 'STOCK BAJO', bajo: true };
}

export default function Productos({
  categoria,
  subcategoriaInicial,
  onBack,
  onCartChanged,
  cartCount,
  codigosEnCarrito,
  codigosSesion,
  islaFiltro,
  vista,
  onCambiarVista,
}) {
  // 'lista'/'lista-grande' son ambas de fila (horizontal); 'grid2'/'grid3'
  // son de rejilla (vertical, N columnas). `grande` solo afecta al tamaño
  // dentro de la vista de fila — enseña unos 4 artículos de golpe en vez de
  // los ~6-7 de la fila compacta normal.
  const esFila = vista === 'lista' || vista === 'lista-grande';
  const grande = vista === 'lista-grande';
  const columnas = vista === 'grid3' ? 3 : 2;
  // La subcategoría activa se guarda junto a la clave del contexto que la
  // creó. Cuando cambia la categoría/búsqueda, la clave deja de coincidir y
  // el estado viejo se descarta en el MISMO render — sin efectos de reseteo
  // que llegan tarde. `subcategoria: null` significa "que el servidor elija
  // la primera alfabética". `subcategoriaInicial` (viene de "Ver en
  // catálogo" en Histórico) solo se usa como valor de arranque de este
  // useState — de ahí en adelante manda `nav` como siempre.
  const ctxKey = categoria?.slug || 'todas';
  const [nav, setNav] = useState({ key: ctxKey, subcategoria: subcategoriaInicial || null });
  const effNav = nav.key === ctxKey ? nav : { key: ctxKey, subcategoria: null };

  // Cuántos artículos revelar de golpe (y cuántos más cada vez que se pulsa
  // "Ver más") — preferencia del dispositivo (como vistaColumnas), no hace
  // falta re-preguntarla cada vez.
  const [limite, setLimite] = useState(() => Number(localStorage.getItem('cofiba:limite')) || 25);
  function cambiarLimite(n) {
    setLimite(n);
    localStorage.setItem('cofiba:limite', String(n));
    setVisibles(n);
  }
  // Este sí que no se recuerda entre visitas — a diferencia del filtro de
  // isla (una elección deliberada y poco frecuente), dejarlo puesto sin
  // querer escondería productos nuevos sin que se note por qué.
  const [soloComprados, setSoloComprados] = useState(false);
  // Buscador propio de la categoría: reutiliza el mismo índice global que
  // Busqueda.jsx (api.buscar) y solo se queda con los resultados cuyo
  // articulo.categoria coincide con esta categoría — como el índice no está
  // troceado por subcategoría, "buscar en la categoría" ya cubre TODAS sus
  // subcategorías de una vez, sin tener que ir cambiando de chip.
  const [campoCat, setCampoCat] = useState('');
  const [busquedaCatActiva, setBusquedaCatActiva] = useState('');
  const [resultadosCat, setResultadosCat] = useState(null);
  const [buscandoCat, setBuscandoCat] = useState(false);
  const [errorCat, setErrorCat] = useState(null);
  const [visibles, setVisibles] = useState(limite);
  const [pending, setPending] = useState({});
  const [zoomProducto, setZoomProducto] = useState(null);
  // Artículos que cofiba.es acaba de rechazar al intentar añadirlos (ver
  // ARTICULO_NO_DISPONIBLE en el servidor) — se quitan de la vista al
  // momento, sin esperar a la próxima carga, para que nadie más tropiece
  // con el mismo error en lo que queda de esta visita.
  const [noDisponibles, setNoDisponibles] = useState(new Set());
  // "También te puede interesar" (afinidad por subcategoría + popularidad
  // global, no cesta real — cofiba.es no expone qué se compró junto en un
  // mismo pedido). Se pide solo al abrir la ficha, no para toda la lista.
  const [relacionados, setRelacionados] = useState(null);
  const contentRef = useRef(null);
  const chipsRef = useRef(null);
  const chipsRefAbajo = useRef(null);

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

  // Cada subcategoría visitada tiene su propia entrada aquí (paginas
  // acumuladas, subcategorías, grupo resuelto...), en vez de un único estado
  // "de la pantalla actual". Así, si el cliente pasa a otra subcategoría
  // mientras la anterior se sigue completando en segundo plano, esa
  // actualización no se pierde ni pisa lo que se está mirando ahora: cada
  // recorrido escribe solo en SU clave, y cuando se vuelve a esa
  // subcategoría más tarde ya está (más) lista.
  const [porSubcat, setPorSubcat] = useState({});
  const clave = `${ctxKey}::${effNav.subcategoria || '__auto__'}`;
  function actualizarSubcat(clv, updater) {
    setPorSubcat((prev) => ({ ...prev, [clv]: updater(prev[clv]) }));
  }

  // Coordinación de los recorridos en segundo plano: como mucho uno corre
  // "urgente" a la vez por subcategoría sin caché (para no dejar al cliente
  // mirando una pantalla vacía), y el resto (subcategorías que YA tenían
  // algo en caché para pintar al instante) se turnan en una cola compartida
  // en vez de competir en paralelo por la misma cuenta de cofiba.es.
  const enCursoRef = useRef(new Set());
  const colaRef = useRef([]);
  const consumiendoRef = useRef(false);
  const montadoRef = useRef(true);
  useEffect(
    () => () => {
      montadoRef.current = false;
    },
    []
  );

  async function ejecutarRecorrido(clv, categoriaSlug, subcatSolicitada) {
    if (enCursoRef.current.has(clv)) return;
    enCursoRef.current.add(clv);
    if (montadoRef.current) actualizarSubcat(clv, (prev) => ({ ...(prev || entradaVacia()), cargandoMas: true }));
    try {
      let pageUrl = null;
      let subcatEfectiva = subcatSolicitada;
      let indice = 0;
      do {
        let data;
        try {
          // Sin onCacheHit aquí a propósito: la caché de esta subcategoría ya
          // se pintó (si la había) antes de programar este recorrido — pasar
          // por productosCached solo para que siga dejando la respuesta
          // fresca guardada para la próxima vez.
          data = await api.productosCached({ categoria: categoriaSlug, subcategoria: subcatEfectiva, pageUrl });
        } catch (e) {
          if (montadoRef.current) {
            actualizarSubcat(clv, (prev) => ({
              ...(prev || entradaVacia()),
              error: e.message,
              errorDebugHtml: e.debugHtml || null,
            }));
          }
          break;
        }
        const i = indice;
        if (montadoRef.current) {
          actualizarSubcat(clv, (prev) => {
            const base = prev || entradaVacia();
            const copia = [...base.paginas];
            copia[i] = data.productos;
            return {
              ...base,
              paginas: copia,
              // Se queda siempre con la lista MÁS LARGA vista hasta ahora, no
              // solo "la fresca si no está vacía": un array vacío es
              // "verdadero" en JS (`[] || base...` nunca caía al respaldo),
              // pero además alguna respuesta puntual trae la lista
              // INCOMPLETA sin llegar a estar vacía del todo — comparar
              // longitudes cubre los dos casos y nunca deja que una lista
              // peor pise a una mejor ya vista.
              subcategorias:
                (data.subcategorias?.length || 0) > (base.subcategorias?.length || 0)
                  ? data.subcategorias
                  : base.subcategorias,
              grupo: data.grupo || base.grupo,
              siguienteGrupoSlug: data.siguienteGrupo || null,
              debugSample: data.debug?.normalizedSample || null,
            };
          });
        }
        // El servidor pudo auto-elegir la subcategoría (o saltar alguna
        // vacía) en la primera respuesta — las páginas siguientes de este
        // mismo recorrido tienen que pedir explícitamente esa misma.
        subcatEfectiva = data.grupo?.slug || subcatEfectiva;
        pageUrl = data.siguientePagina || null;
        indice += 1;
      } while (pageUrl);
    } finally {
      enCursoRef.current.delete(clv);
      if (montadoRef.current) actualizarSubcat(clv, (prev) => ({ ...(prev || entradaVacia()), cargandoMas: false }));
    }
  }

  async function consumirCola() {
    if (consumiendoRef.current) return;
    consumiendoRef.current = true;
    while (colaRef.current.length) {
      const item = colaRef.current.shift();
      if (enCursoRef.current.has(item.clave)) continue;
      await ejecutarRecorrido(item.clave, item.categoriaSlug, item.subcatSolicitada);
    }
    consumiendoRef.current = false;
  }

  // urgente=true (sin nada en caché que enseñar): arranca ya, sin esperar
  // turno — el cliente está mirando una pantalla vacía y no debe esperar
  // detrás de otra subcategoría. urgente=false (ya había algo en caché):
  // se apunta al final de la cola en vez de competir con lo que ya está en
  // marcha — "no interrumpir, poner en cola".
  function programarRecorrido(clv, categoriaSlug, subcatSolicitada, { urgente }) {
    if (enCursoRef.current.has(clv)) return;
    if (urgente) {
      ejecutarRecorrido(clv, categoriaSlug, subcatSolicitada);
    } else {
      if (colaRef.current.some((it) => it.clave === clv)) return;
      colaRef.current.push({ clave: clv, categoriaSlug, subcatSolicitada });
      consumirCola();
    }
  }

  // Reconstruye al instante (sin red) lo que ya se hubiera visto antes de
  // esta subcategoría, encadenando la caché local por su propio
  // siguientePagina — así cambiar de subcategoría pinta las fotos ya
  // conocidas de inmediato en vez de dejar al cliente mirando un hueco en
  // blanco mientras se confirma que sigue igual.
  async function reconstruirDesdeCache(categoriaSlug, subcatSolicitada) {
    const paginasCache = [];
    let subcategoriasCache = [];
    let grupoCache = null;
    let siguienteGrupoCache = null;
    let pageUrl = null;
    let subcatActual = subcatSolicitada;
    do {
      const cacheado = await getCache(`productos:${categoriaSlug}|${subcatActual || ''}|${pageUrl || ''}`);
      if (!cacheado) break;
      paginasCache.push(cacheado.productos);
      if (cacheado.subcategorias?.length) subcategoriasCache = cacheado.subcategorias;
      if (cacheado.grupo) grupoCache = cacheado.grupo;
      siguienteGrupoCache = cacheado.siguienteGrupo || null;
      subcatActual = cacheado.grupo?.slug || subcatActual;
      pageUrl = cacheado.siguientePagina || null;
    } while (pageUrl);
    return { paginasCache, subcategoriasCache, grupoCache, siguienteGrupoCache };
  }

  // El scroll se resetea al NAVEGAR de verdad (cambia categoría o
  // subcategoría) — no cada vez que llega una actualización de datos para lo
  // que ya se está mirando.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    setVisibles(limite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, effNav.subcategoria]);

  // La búsqueda de categoría es un estado aparte (no vive en `nav`), así que
  // sin esto, cambiar de categoría con una búsqueda activa dejaba los
  // resultados de la categoría ANTERIOR pegados en pantalla bajo el título
  // de la nueva.
  useEffect(() => {
    setCampoCat('');
    setBusquedaCatActiva('');
    setResultadosCat(null);
    setErrorCat(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  useEffect(() => {
    const categoriaSlug = categoria?.slug || 'todas';
    const subcatSolicitada = effNav.subcategoria;
    let cancelado = false;

    (async () => {
      const { paginasCache, subcategoriasCache, grupoCache, siguienteGrupoCache } = await reconstruirDesdeCache(
        categoriaSlug,
        subcatSolicitada
      );
      if (cancelado || !montadoRef.current) return;

      const tieneCache = paginasCache.length > 0;
      if (tieneCache) {
        actualizarSubcat(clave, () => ({
          ...entradaVacia(),
          paginas: paginasCache,
          subcategorias: subcategoriasCache,
          grupo: grupoCache,
          siguienteGrupoSlug: siguienteGrupoCache,
        }));
      } else {
        actualizarSubcat(clave, (prev) => prev || entradaVacia());
      }

      programarRecorrido(clave, categoriaSlug, subcatSolicitada, { urgente: !tieneCache });
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, effNav.subcategoria]);

  const entradaActiva = porSubcat[clave] || entradaVacia();
  // Con la búsqueda de categoría activa, la lista base es la de resultados
  // (ya filtrados a esta categoría) en vez de la subcategoría que se
  // estuviera navegando — todo lo de abajo (isla/comprados/visibles) sigue
  // funcionando igual sobre esta lista, sin duplicar esa lógica.
  const productos = busquedaCatActiva ? resultadosCat || [] : entradaActiva.paginas.flat();
  const subcategorias = entradaActiva.subcategorias;
  const grupoActual = entradaActiva.grupo;
  const siguienteGrupoSlug = entradaActiva.siguienteGrupoSlug;
  const cargandoMas = entradaActiva.cargandoMas;
  const error = busquedaCatActiva ? errorCat : entradaActiva.error;
  const errorDebugHtml = entradaActiva.errorDebugHtml;
  const debugSample = entradaActiva.debugSample;
  // Solo se enseña "Cargando productos…" a pantalla completa cuando de
  // verdad no hay nada que mostrar todavía (ni de caché ni de la red) — en
  // cuanto hay algo, aunque sea de caché, el cliente ya ve fotos mientras el
  // recorrido de fondo sigue completando el resto. Con la búsqueda de
  // categoría activa, "cargando" es simplemente `buscandoCat`, no depende
  // del recorrido de fondo de la subcategoría (que puede seguir corriendo
  // igual detrás, sin que le importe a la búsqueda).
  const loading = busquedaCatActiva ? buscandoCat && !resultadosCat : productos.length === 0 && cargandoMas;

  // El servidor pudo auto-elegir la primera subcategoría (o saltar alguna
  // vacía): los chips y la navegación de bordes usan la que realmente sirvió.
  const grupoEfectivo = grupoActual?.slug || effNav.subcategoria;

  // La fila de chips hace scroll horizontal propio: al avanzar de
  // subcategoría en subcategoría el chip resaltado puede quedar fuera de la
  // vista, así que se centra en la vista cada vez que cambia cuál está
  // activo. scrollIntoView({inline:'center'}) se queda corto en la práctica
  // (acababa desplazando hacia la derecha en vez de centrar el chip) —
  // calculando el scrollLeft a mano contra el propio contenedor sale
  // siempre centrado, sin depender de heurísticas del navegador.
  //
  // Al elegir una subcategoría sin nada aún en `porSubcat`, la entrada
  // vacía trae `subcategorias: []` durante un instante — la fila de chips
  // desaparece (y con ella chipsRef.current) hasta que llegan datos de
  // verdad. Cuando reaparece, `grupoEfectivo` casi siempre sigue siendo el
  // MISMO texto que ya tenía (la subcategoría pedida no cambia), así que un
  // efecto que solo dependa de `grupoEfectivo` no se entera de que la fila
  // acaba de volver a montarse — de ahí que antes se quedara sin centrar.
  // Añadir `subcategorias.length` como dependencia fuerza a re-comprobarlo
  // también en ese momento.
  useEffect(() => {
    if (!grupoEfectivo) return;
    // Misma lógica para las dos filas de chips (la de arriba y la repetida
    // al final del listado) — cada una centra su propio chip activo dentro
    // de SU contenedor, independientemente de la otra.
    for (const contenedor of [chipsRef.current, chipsRefAbajo.current]) {
      if (!contenedor) continue;
      const el = contenedor.querySelector(`[data-slug="${grupoEfectivo}"]`);
      if (!el) continue;
      const destino = el.offsetLeft - contenedor.clientWidth / 2 + el.clientWidth / 2;
      contenedor.scrollTo({ left: Math.max(0, destino), behavior: 'smooth' });
    }
  }, [grupoEfectivo, subcategorias.length]);

  function elegirSubcategoria(slug) {
    setNav({ key: ctxKey, subcategoria: slug });
  }

  function buscarEnCategoria() {
    const q = campoCat.trim();
    if (!q) return;
    setBuscandoCat(true);
    setErrorCat(null);
    api
      .buscar(q)
      .then((data) => {
        const propios = (data.resultados || []).filter((p) => p.categoria === ctxKey);
        setResultadosCat(propios);
        setBusquedaCatActiva(q);
        setVisibles(limite);
      })
      .catch((e) => setErrorCat(e.message))
      .finally(() => setBuscandoCat(false));
  }
  function limpiarBusquedaCat() {
    setCampoCat('');
    setBusquedaCatActiva('');
    setResultadosCat(null);
    setErrorCat(null);
    setVisibles(limite);
  }

  // Al llegar al final de una subcategoría (nada más que revelar y ya no
  // queda nada por traer de fondo), en vez de "Siguiente/Anterior" de
  // página se ofrece saltar directamente a la subcategoría vecina — el
  // recorrido alfabético completo sigue funcionando igual, solo que ahora
  // avanza de subcategoría en subcategoría en vez de de página en página.
  const idxSubcatActual = subcategorias.findIndex((s) => s.slug === grupoEfectivo);
  const subcatAnterior = idxSubcatActual > 0 ? subcategorias[idxSubcatActual - 1] : null;
  const subcatSiguiente = siguienteGrupoSlug
    ? subcategorias.find((s) => s.slug === siguienteGrupoSlug) || null
    : null;

  // No se espera a que cofiba.es confirme antes de reaccionar: el contador
  // sube/baja al instante (setPending, antes de pedir nada) y la petición de
  // verdad sigue su curso sola en segundo plano. Solo si de verdad falla
  // (p. ej. el artículo ya no existe — ver anadirAlCarrito en el servidor)
  // se corrige el contador y se avisa, y entonces sí, no antes.
  function añadir(p, delta) {
    const anterior = pending[p.articulo] ?? 0;
    const nueva = Math.max(0, anterior + delta);
    if (nueva === anterior) return;
    setPending((s) => ({ ...s, [p.articulo]: nueva }));

    const promesa =
      anterior === 0
        ? // Primera vez que se pulsa + para este producto: aún no está en el
          // carrito, así que hay que añadirlo (no solo fijar su cantidad).
          api.anadirAlCarrito({
            categoria: categoria?.slug || 'todas',
            articulo: p.articulo,
            cantidad: nueva,
            origen: p.origen,
          })
        : nueva === 0
        ? // Bajar hasta 0 ya no es "menos cantidad", es sacarlo del carrito.
          api.eliminarDelCarrito(p.articulo)
        : api.actualizarCantidadCarrito({ articulo: p.articulo, cantidad: nueva });

    promesa
      .then(() => {
        // cofiba.es's own total_carrito counts "add events", not distinct
        // products — always refetch our own parsed cart so the badge matches
        // what the Carrito tab shows.
        onCartChanged();
      })
      .catch((e) => {
        setPending((s) => ({ ...s, [p.articulo]: anterior }));
        // cofiba.es lo sigue enseñando en sus páginas pero ya no lo vende de
        // verdad — se quita de esta vista al momento (el servidor ya lo
        // esconde de las próximas cargas durante unos días), avisando por
        // qué en vez de dejar que el artículo desaparezca sin explicación.
        if (e.code === 'ARTICULO_NO_DISPONIBLE') setNoDisponibles((s) => new Set(s).add(p.articulo));
        actualizarSubcat(clave, (prev) => ({
          ...(prev || entradaVacia()),
          error: e.message,
          errorDebugHtml: e.debugHtml || null,
        }));
      });
  }

  // Icono de carrito: distinto de "comprado" (que es histórico, viene de
  // Histórico/compradosStore.js) — este solo mira si el artículo está AHORA
  // en el carrito real o se pidió en esta misma sesión de la app.
  function enCarritoOSesion(articulo) {
    // pending[articulo] es el contador local, que ya cambia al instante al
    // pulsar +/- (antes de que cofiba.es confirme nada) — mirarlo aquí
    // también hace que el icono aparezca al momento, no solo el número.
    return !!(codigosEnCarrito?.has(articulo) || codigosSesion?.has(articulo) || (pending[articulo] ?? 0) > 0);
  }

  const productosDisponibles = noDisponibles.size ? productos.filter((p) => !noDisponibles.has(p.articulo)) : productos;
  const productosPorIsla = filtrarPorIsla(productosDisponibles, islaFiltro);
  const productosPorComprado = soloComprados ? productosPorIsla.filter((p) => p.comprado) : productosPorIsla;
  const productosFiltrados = productosPorComprado.slice(0, visibles);
  const hayMasParaRevelar = visibles < productosPorComprado.length;

  return (
    <div className="content" ref={contentRef} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} aria-label="Volver" style={{ padding: '6px 10px' }}>
          ←
        </button>
        <p style={{ fontWeight: 500, margin: 0, flex: 1 }}>{categoria?.nombre}</p>
      </div>

      {/* Busca solo dentro de esta categoría (todas sus subcategorías a la
          vez, no una por una) — reutiliza el índice global de Búsqueda, así
          que encuentra por nombre/referencia/EAN igual que el buscador
          normal, pero descartando lo que no sea de aquí. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          buscarEnCategoria();
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 10 }}
      >
        <input
          placeholder={`Buscar en ${categoria?.nombre || 'esta categoría'}...`}
          value={campoCat}
          onChange={(e) => setCampoCat(e.target.value)}
        />
        <button type="submit" aria-label="Buscar en la categoría">
          🔍
        </button>
        {busquedaCatActiva && (
          <button type="button" className="danger-text" onClick={limpiarBusquedaCat} aria-label="Quitar búsqueda">
            ✕
          </button>
        )}
      </form>

      {error && (
        <div className="error-banner">
          {error}
          {errorDebugHtml && (
            <details style={{ marginTop: 6 }}>
              <summary>Ver HTML de depuración</summary>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{errorDebugHtml}</pre>
            </details>
          )}
        </div>
      )}

      {/* Cuántos enseñar / solo comprados / vista — todo junto y justo
          encima de las subcategorías, como una sola barra de controles. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        <select
          value={limite}
          onChange={(e) => cambiarLimite(Number(e.target.value))}
          style={{ fontSize: 12, padding: '6px 8px', flex: 1, minWidth: 0 }}
          aria-label="Cuántos artículos mostrar"
        >
          <option value={10}>10 artículos</option>
          <option value={25}>25 artículos</option>
          <option value={50}>50 artículos</option>
          <option value={100}>100 artículos</option>
        </select>
        <button
          onClick={() => setSoloComprados((v) => !v)}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            whiteSpace: 'nowrap',
            background: soloComprados ? 'var(--accent)' : 'var(--surface-2)',
            color: soloComprados ? '#fff' : 'var(--text-primary)',
            borderColor: soloComprados ? 'var(--accent)' : 'var(--border)',
          }}
        >
          Comprados
        </button>
        <button onClick={onCambiarVista} aria-label="Cambiar vista" style={{ padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
          {vista === 'lista' ? '☰ Lista' : vista === 'lista-grande' ? '☰ Lista XL' : `▦ ${columnas}`}
        </button>
      </div>

      {!busquedaCatActiva && subcategorias.length > 0 && (
        <div ref={chipsRef} style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
          {subcategorias.map((s) => {
            const activa = grupoEfectivo === s.slug;
            return (
              <button
                key={s.slug}
                data-slug={s.slug}
                onClick={() => elegirSubcategoria(s.slug)}
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  padding: '6px 10px',
                  whiteSpace: 'nowrap',
                  background: activa ? 'var(--accent)' : 'var(--surface-2)',
                  color: activa ? '#fff' : 'var(--text-primary)',
                  borderColor: activa ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {s.nombre}
              </button>
            );
          })}
        </div>
      )}

      {loading && <p className="muted">{busquedaCatActiva ? 'Buscando…' : 'Cargando productos…'}</p>}
      {!loading && busquedaCatActiva && productos.length === 0 && !error && (
        <p className="muted">
          No se encontró nada para "{busquedaCatActiva}" en {categoria?.nombre || 'esta categoría'}.
        </p>
      )}
      {!loading && !busquedaCatActiva && productos.length === 0 && !error && (
        <>
          <p className="muted">No se encontraron productos.</p>
          {debugSample && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted">Ver texto crudo recibido (para depurar)</summary>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{debugSample}</pre>
            </details>
          )}
        </>
      )}
      {!loading && productos.length > 0 && productosPorIsla.length === 0 && (
        <p className="muted">Ningún producto de esta pantalla es de la isla seleccionada.</p>
      )}
      {!loading && productos.length > 0 && productosPorIsla.length > 0 && productosPorComprado.length === 0 && (
        <p className="muted">Ningún producto de esta pantalla está marcado como comprado.</p>
      )}
      {!loading && busquedaCatActiva && productosPorComprado.length > 0 && (
        <p className="muted" style={{ marginBottom: 4 }}>
          {productosPorComprado.length} resultado{productosPorComprado.length === 1 ? '' : 's'} para "{busquedaCatActiva}" en{' '}
          {categoria?.nombre || 'esta categoría'}
        </p>
      )}

      {!busquedaCatActiva && !loading && productos.length > 0 && grupoActual && (
        <p
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: 'var(--accent)',
            margin: '4px 0 2px',
            letterSpacing: 0.3,
          }}
        >
          {grupoActual.nombre}
        </p>
      )}

      {esFila ? (
        <div>
          {productosFiltrados.map((p) => (
            <div
              className={`product-row${grande ? ' product-row-lg' : ''}${p.comprado ? ' product-row-comprado' : ''}${
                enCarritoOSesion(p.articulo) ? ' product-row-carrito' : ''
              }`}
              key={p.articulo}
              // Todo el casillero es el botón que abre la ficha — solo el
              // paso +/- (más abajo, con su propio stopPropagation) queda
              // fuera, para no disparar la ficha al tocar - o +.
              onClick={() => setZoomProducto(p)}
              style={{ cursor: 'zoom-in' }}
            >
              <div className="product-thumb" style={grande ? { width: 92, height: 92 } : undefined}>
                {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: grande ? 17 : 14,
                    margin: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {p.nombre || p.referencia || p.articulo}
                </p>
                <p className="muted" style={grande ? { fontSize: 14, margin: '4px 0' } : { margin: '2px 0' }}>
                  Ref. {p.referencia || p.articulo}
                  {p.comprado && <strong style={{ color: 'var(--accent)' }}> · Comprado</strong>}
                </p>
                <p style={{ fontSize: grande ? 17 : 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                  {p.precioFinal ? `${p.precioFinal}€` : '—'}
                  {enCarritoOSesion(p.articulo) && (
                    <span style={{ marginLeft: 5 }}>
                      <CarritoIcon size={grande ? 17 : 13} />
                    </span>
                  )}
                  {(() => {
                    const info = nivelStock(p.stock, p.undVenta);
                    return (
                      info && (
                        <span
                          style={{
                            marginLeft: 5,
                            fontSize: grande ? 13 : 11,
                            color: info.bajo ? 'var(--danger)' : 'var(--accent)',
                          }}
                        >
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
                <div className={grande ? 'qty-stepper qty-stepper-lg' : 'qty-stepper'}>
                  <button onClick={() => añadir(p, -1)}>-</button>
                  <span style={{ minWidth: 14, textAlign: 'center', fontSize: grande ? 16 : 13 }}>
                    {pending[p.articulo] ?? 0}
                  </span>
                  <button onClick={() => añadir(p, 1)}>+</button>
                </div>
                {p.undVenta && (
                  <span className="muted" style={{ fontSize: grande ? 13 : 11 }}>
                    caja de {formatoCaja(p.undVenta)} uds
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="producto-grid" style={{ gridTemplateColumns: `repeat(${columnas}, 1fr)` }}>
          {productosFiltrados.map((p) => (
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
                {p.nombre || p.referencia || p.articulo}
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
              {/* marginTop: 'auto' (no un valor fijo) empuja este bloque —
                  y todo lo que va detrás, la etiqueta de caja incluida — al
                  fondo de la tarjeta pase lo que pase por encima (nombres
                  de 1 o 2 líneas, con o sin insignia de stock...). Sin esto
                  los botones de comprar quedaban a distinta altura entre
                  tarjetas de la misma fila según cuánto ocupara el nombre. */}
              <div className="qty-stepper" style={{ marginTop: 'auto', paddingTop: 4 }} onClick={(e) => e.stopPropagation()}>
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

      {hayMasParaRevelar && (
        <div style={{ padding: '12px 0', textAlign: 'center' }}>
          <button onClick={() => setVisibles((v) => v + limite)} style={{ width: '100%' }}>
            Ver más ({productosPorComprado.length - visibles} más)
          </button>
        </div>
      )}

      {/* Mismo selector de subcategoría que arriba, repetido también al
          final del listado — así no hace falta subir hasta la barra
          superior para saltar de subcategoría tras revisar toda la lista.
          Un poco más grueso que el de arriba (más fácil de acertar con el
          dedo después de haber bajado toda la pantalla). */}
      {!busquedaCatActiva && subcategorias.length > 0 && (
        <div ref={chipsRefAbajo} style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 0' }}>
          {subcategorias.map((s) => {
            const activa = grupoEfectivo === s.slug;
            return (
              <button
                key={s.slug}
                data-slug={s.slug}
                onClick={() => elegirSubcategoria(s.slug)}
                style={{
                  flexShrink: 0,
                  fontSize: 13,
                  padding: '10px 16px',
                  whiteSpace: 'nowrap',
                  background: activa ? 'var(--accent)' : 'var(--surface-2)',
                  color: activa ? '#fff' : 'var(--text-primary)',
                  borderColor: activa ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {s.nombre}
              </button>
            );
          })}
        </div>
      )}

      {/* En cuanto no queda nada más que revelar de lo ya traído, se ofrece
          saltar a la subcategoría vecina — aunque el recorrido de esta
          siga completándose de fondo (cargandoMas), el cliente no debe
          quedarse mirando un aviso de "cargando" sin poder hacer nada: si
          "Siguiente" todavía no se conoce (la última página real aún no ha
          llegado), el botón sale deshabilitado y se activa solo en cuanto
          esté listo, sin bloquear el resto de la navegación mientras tanto. */}
      {!busquedaCatActiva && !hayMasParaRevelar && (subcatAnterior || subcatSiguiente || cargandoMas) && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button disabled={!subcatAnterior} onClick={() => subcatAnterior && elegirSubcategoria(subcatAnterior.slug)} style={{ flex: 1 }}>
              ← {subcatAnterior ? subcatAnterior.nombre : 'Anterior'}
            </button>
            <button
              disabled={!subcatSiguiente}
              onClick={() => subcatSiguiente && elegirSubcategoria(subcatSiguiente.slug)}
              style={{ flex: 1 }}
            >
              {subcatSiguiente ? subcatSiguiente.nombre : 'Siguiente'} →
            </button>
          </div>
        </div>
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
          <img
            src={zoomProducto.imagen}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '65%', objectFit: 'contain' }}
          />
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
              <button className="danger" onClick={() => setZoomProducto(null)}>
                Cerrar
              </button>
            </div>
            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 11, margin: '8px 0 0' }}>{error}</p>
            )}

            {relacionados && relacionados.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>También te puede interesar</p>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                  {relacionados.map((r) => (
                    <div
                      key={r.articulo}
                      style={{
                        flexShrink: 0,
                        width: 84,
                        textAlign: 'center',
                        cursor: 'pointer',
                      }}
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
