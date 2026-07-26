import { useEffect, useRef, useState } from 'react';
import { getToken, api } from './api.js';
import Login from './screens/Login.jsx';
import Categorias from './screens/Categorias.jsx';
import Productos from './screens/Productos.jsx';
import Carrito from './screens/Carrito.jsx';
import Historico from './screens/Historico.jsx';
import Busqueda from './screens/Busqueda.jsx';
import Estadisticas from './screens/Estadisticas.jsx';

function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  useEffect(() => {
    function onPrompt(e) {
      e.preventDefault();
      setDeferred(e);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return { deferred, isStandalone, isIos };
}

// Qué está "comprado" (Histórico) y qué está "en el carrito ahora mismo o
// pedido en esta sesión" son dos cosas distintas: lo primero viene de las
// compras reales pasadas en la cuenta de cofiba.es (compradosStore.js en el
// servidor); lo segundo es un icono de carrito que solo depende de la
// actividad de AHORA — así el usuario ve de un vistazo qué ya tiene metido
// sin confundirlo con lo que compró en el pasado. sessionStorage (no
// localStorage) porque "esta sesión" debe olvidarse al cerrar la pestaña,
// pero sobrevivir a una recarga de la página mientras tanto.
const CLAVE_SESION = 'cofiba:comprados-sesion';

function cargarCompradosSesion() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(CLAVE_SESION) || '[]'));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [tab, setTab] = useState('categorias'); // categorias | productos | busqueda | carrito | historico | estadisticas
  const [categoria, setCategoria] = useState(null);
  // Solo se rellena al venir del botón "Ver más" de Histórico — le dice a
  // Productos en qué subcategoría entrar directamente en vez de la primera
  // alfabética de siempre. Se limpia en cuanto se abre una categoría por el
  // camino normal (tocando un tile en Categorías), para que no se cuele en
  // una navegación que no tiene nada que ver.
  const [subcategoriaInicial, setSubcategoriaInicial] = useState(null);
  const [busqueda, setBusqueda] = useState(null);
  // Filtro global de isla (Mallorca/Ibiza/Formentera) — se activa desde
  // Categorías pero afecta a Productos/Búsqueda/Histórico por igual, así que
  // vive aquí arriba. Persistido en localStorage (no sessionStorage): es una
  // preferencia del dispositivo, tiene sentido que sobreviva a cerrar la app.
  const [islaFiltro, setIslaFiltro] = useState(() => localStorage.getItem('cofiba:isla-filtro') || null);
  // Cuántas columnas usan las listas de productos (Productos/Búsqueda/
  // Histórico) — 1 es la fila de siempre, 2/3 son tarjetas en rejilla más
  // compactas. También preferencia de dispositivo, mismo motivo que la isla.
  const [vistaColumnas, setVistaColumnas] = useState(() => Number(localStorage.getItem('cofiba:columnas')) || 1);
  const [cartCount, setCartCount] = useState(0);
  const [codigosEnCarrito, setCodigosEnCarrito] = useState(new Set());
  const [codigosSesion, setCodigosSesion] = useState(cargarCompradosSesion);
  const [sessionExpired, setSessionExpired] = useState(false);
  const { deferred, isStandalone, isIos } = useInstallPrompt();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const [cuenta, setCuenta] = useState(null);

  function refreshCartCount(directCount, directCodigos) {
    if (Number.isFinite(directCount)) {
      setCartCount(directCount);
      if (directCodigos) setCodigosEnCarrito(new Set(directCodigos));
      return;
    }
    api
      .carrito()
      .then((c) => {
        setCartCount(c.numProductos);
        setCodigosEnCarrito(new Set(c.lineas.map((l) => l.codigo)));
      })
      .catch(() => {});
  }

  // Se llama justo después de finalizar un pedido con éxito, con los
  // artículos que llevaba el carrito en ese momento — el carrito real se
  // vacía al finalizar, así que sin esto el icono de carrito desaparecería
  // de golpe aunque el usuario lo acabara de comprar en esta misma sesión.
  function marcarCompradosSesion(codigos) {
    setCodigosSesion((anteriores) => {
      const combinado = new Set(anteriores);
      codigos.forEach((c) => combinado.add(c));
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify([...combinado]));
      return combinado;
    });
  }

  // Pulsar la isla ya activa la desactiva (vuelve a enseñar todo) — sin esto
  // no habría forma de quitar el filtro una vez puesto salvo borrando datos
  // del navegador.
  function cambiarIsla(valor) {
    setIslaFiltro((actual) => {
      const nuevo = actual === valor ? null : valor;
      if (nuevo) localStorage.setItem('cofiba:isla-filtro', nuevo);
      else localStorage.removeItem('cofiba:isla-filtro');
      return nuevo;
    });
  }

  // 1 -> 2 -> 3 -> 1 ...
  function cambiarVista() {
    setVistaColumnas((actual) => {
      const nuevo = actual >= 3 ? 1 : actual + 1;
      localStorage.setItem('cofiba:columnas', String(nuevo));
      return nuevo;
    });
  }

  useEffect(() => {
    if (loggedIn) refreshCartCount();
  }, [loggedIn]);

  // El botón/gesto "atrás" del móvil (o del navegador) antes cerraba la app
  // entera de golpe en cuanto no había página anterior de verdad en el
  // historial — una PWA de una sola página nunca añade ninguna por sí sola.
  // Retrocede pantalla a pantalla de verdad (cada cambio de pestaña,
  // categoría o búsqueda deja su propia entrada), no solo "vuelve a
  // Categorías de un salto" — así se comporta como el usuario espera de
  // cualquier navegación normal. `restaurandoRef` evita un bucle: al
  // restaurar un estado desde popstate, ese cambio de tab/categoria/
  // busqueda no debe volver a empujar OTRA entrada nueva.
  const restaurandoRef = useRef(false);
  const primeraVezRef = useRef(true);

  useEffect(() => {
    function onPopState(e) {
      restaurandoRef.current = true;
      const s = e.state || {};
      setTab(s.tab || 'categorias');
      setCategoria(s.categoria || null);
      setBusqueda(s.busqueda || null);
      setSubcategoriaInicial(s.subcategoriaInicial || null);
    }
    window.addEventListener('popstate', onPopState);
    // Dejar el estado inicial (Categorías) en la propia entrada de carga,
    // para que haya algo coherente a lo que volver si el primer "atrás"
    // aterriza aquí.
    window.history.replaceState({ tab: 'categorias', categoria: null, busqueda: null, subcategoriaInicial: null }, '');
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (restaurandoRef.current) {
      restaurandoRef.current = false;
      return;
    }
    // El primer render también dispara este efecto (con el estado inicial,
    // ya cubierto por el replaceState de arriba) — sin este guard se
    // empujaba una entrada de más nada más arrancar.
    if (primeraVezRef.current) {
      primeraVezRef.current = false;
      return;
    }
    window.history.pushState({ tab, categoria, busqueda, subcategoriaInicial }, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categoria, busqueda]);

  // Vive aquí (no en Categorías) porque la barra superior es la misma en
  // todas las pantallas — así el nombre del cliente logeado queda siempre
  // visible, no solo al entrar en Categorías.
  useEffect(() => {
    if (!loggedIn) return;
    api
      .miCuentaCached((cacheado) => setCuenta(cacheado))
      .then(setCuenta)
      .catch(() => {
        // Silencioso a propósito: es un dato complementario, no algo que
        // deba impedir usar el resto de la app si falla puntualmente.
      });
  }, [loggedIn]);

  useEffect(() => {
    function onExpired() {
      setLoggedIn(false);
      setSessionExpired(true);
    }
    window.addEventListener('cofiba:session-expired', onExpired);
    return () => window.removeEventListener('cofiba:session-expired', onExpired);
  }, []);

  // Si el cliente lleva 15 minutos sin entrar en la app (móvil bloqueado,
  // cambiado de app, o la pestaña cerrada del todo y reabierta más tarde),
  // al volver debe empezar de nuevo por la pantalla de credenciales en vez
  // de continuar donde lo dejó — aunque el token siga siendo técnicamente
  // válido. Se mide con la Page Visibility API (no un simple timer, que
  // seguiría corriendo aunque el navegador esté descartado en segundo
  // plano) y se guarda en localStorage (no una ref) para que sobreviva a
  // cerrar del todo la app y volver a abrirla más tarde.
  const INACTIVIDAD_MS = 15 * 60 * 1000;
  const CLAVE_ULTIMA_ACTIVIDAD = 'cofiba:ultima-actividad';
  useEffect(() => {
    function marcarActividad() {
      localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now()));
    }
    function comprobar() {
      if (document.visibilityState === 'hidden') {
        marcarActividad();
        return;
      }
      const ultima = Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD) || 0);
      if (ultima && Date.now() - ultima >= INACTIVIDAD_MS) {
        api.logout();
        setLoggedIn(false);
      }
      marcarActividad();
    }
    document.addEventListener('visibilitychange', comprobar);
    window.addEventListener('pagehide', marcarActividad);
    comprobar();
    return () => {
      document.removeEventListener('visibilitychange', comprobar);
      window.removeEventListener('pagehide', marcarActividad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loggedIn) {
    return (
      <Login
        expiredNotice={sessionExpired}
        onLoggedIn={() => {
          setSessionExpired(false);
          setLoggedIn(true);
        }}
      />
    );
  }

  return (
    // En móvil (columna) es una sola pantalla con la nav pegada abajo, como
    // siempre. A partir de cierto ancho (o en apaisado) `.app-shell` pasa a
    // fila y `.bottomnav` se convierte en un panel lateral fijo — el orden
    // real en el DOM no cambia, solo el `order` en CSS por breakpoint, ver
    // styles.css.
    <div className="app-shell">
      {/* Sin botón propio para "Productos": a esa pantalla solo se llega
          tocando una categoría desde Catálogo (o "Ver más" en Histórico) —
          por eso no aparece aquí abajo, aunque su ruta siga existiendo. */}
      <div className="bottomnav">
        <button className={tab === 'categorias' ? 'active' : ''} onClick={() => setTab('categorias')}>
          Catálogo
        </button>
        <button className={tab === 'historico' ? 'active' : ''} onClick={() => setTab('historico')}>
          Histórico
        </button>
        <button className={tab === 'carrito' ? 'active' : ''} onClick={() => setTab('carrito')}>
          Carrito{cartCount > 0 ? <span className="badge">{cartCount}</span> : null}
        </button>
        <button className={tab === 'estadisticas' ? 'active' : ''} onClick={() => setTab('estadisticas')}>
          Estadísticas
        </button>
      </div>

      <div className="app-main">
        <div className="topbar">
          <img src="/logo/cofiba-logo.jpg" alt="Cofiba" style={{ height: 24, flexShrink: 0 }} />
          {cuenta?.datosFiscales?.Nombre && (
            <p
              className="muted"
              style={{
                flex: 1,
                minWidth: 0,
                margin: '0 10px',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={cuenta.datosFiscales.Nombre}
            >
              {cuenta.datosFiscales.Nombre}
            </p>
          )}
          <button className="danger-text" style={{ flexShrink: 0 }} onClick={() => (api.logout(), setLoggedIn(false))}>
            Salir
          </button>
        </div>

        {!isStandalone && !dismissedInstall && (
          <div className="install-banner">
            <span>
              {deferred
                ? 'Instala esta app en tu móvil para acceso rápido.'
                : isIos
                ? 'En Safari: pulsa Compartir → "Añadir a pantalla de inicio".'
                : 'Instálala desde el menú del navegador.'}
            </span>
            {deferred ? (
              <button
                onClick={async () => {
                  deferred.prompt();
                  setDismissedInstall(true);
                }}
              >
                Instalar
              </button>
            ) : (
              <button onClick={() => setDismissedInstall(true)}>Vale</button>
            )}
          </div>
        )}

        {tab === 'categorias' && (
          <Categorias
            onOpenCategoria={(c) => {
              setCategoria(c);
              setSubcategoriaInicial(null);
              setTab('productos');
            }}
            onSearch={(q) => {
              setBusqueda(q);
              setTab('busqueda');
            }}
            islaFiltro={islaFiltro}
            onCambiarIsla={cambiarIsla}
          />
        )}
        {tab === 'productos' && (
          <Productos
            categoria={categoria}
            subcategoriaInicial={subcategoriaInicial}
            onBack={() => setTab('categorias')}
            onCartChanged={refreshCartCount}
            cartCount={cartCount}
            codigosEnCarrito={codigosEnCarrito}
            codigosSesion={codigosSesion}
            islaFiltro={islaFiltro}
            vistaColumnas={vistaColumnas}
            onCambiarVista={cambiarVista}
          />
        )}
        {tab === 'busqueda' && (
          <Busqueda
            termino={busqueda}
            onBack={() => setTab('categorias')}
            onCartChanged={refreshCartCount}
            codigosEnCarrito={codigosEnCarrito}
            codigosSesion={codigosSesion}
            islaFiltro={islaFiltro}
            vistaColumnas={vistaColumnas}
            onCambiarVista={cambiarVista}
          />
        )}
        {tab === 'carrito' && <Carrito onCartChanged={refreshCartCount} onPedidoFinalizado={marcarCompradosSesion} />}
        {tab === 'historico' && (
          <Historico
            onCartChanged={refreshCartCount}
            codigosEnCarrito={codigosEnCarrito}
            codigosSesion={codigosSesion}
            islaFiltro={islaFiltro}
            vistaColumnas={vistaColumnas}
            onCambiarVista={cambiarVista}
            onIrACategoria={(categoriaSlug, categoriaNombre, subcategoriaSlug) => {
              setCategoria({ slug: categoriaSlug, nombre: categoriaNombre || categoriaSlug });
              setSubcategoriaInicial(subcategoriaSlug || null);
              setTab('productos');
            }}
          />
        )}
        {tab === 'estadisticas' && (
          <Estadisticas onCartChanged={refreshCartCount} codigosEnCarrito={codigosEnCarrito} codigosSesion={codigosSesion} />
        )}
      </div>
    </div>
  );
}
