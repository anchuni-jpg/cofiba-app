import { useEffect, useState } from 'react';
import { getToken, api } from './api.js';
import Login from './screens/Login.jsx';
import Categorias from './screens/Categorias.jsx';
import Productos from './screens/Productos.jsx';
import Carrito from './screens/Carrito.jsx';
import Historico from './screens/Historico.jsx';
import Busqueda from './screens/Busqueda.jsx';

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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [tab, setTab] = useState('categorias'); // categorias | productos | busqueda | carrito | historico
  const [categoria, setCategoria] = useState(null);
  const [busqueda, setBusqueda] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const { deferred, isStandalone, isIos } = useInstallPrompt();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const [cuenta, setCuenta] = useState(null);

  function refreshCartCount(directCount) {
    if (Number.isFinite(directCount)) {
      setCartCount(directCount);
      return;
    }
    api
      .carrito()
      .then((c) => setCartCount(c.numProductos))
      .catch(() => {});
  }

  useEffect(() => {
    if (loggedIn) refreshCartCount();
  }, [loggedIn]);

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
    <>
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
            setTab('productos');
          }}
          onSearch={(q) => {
            setBusqueda(q);
            setTab('busqueda');
          }}
        />
      )}
      {tab === 'productos' && (
        <Productos
          categoria={categoria}
          onBack={() => setTab('categorias')}
          onCartChanged={refreshCartCount}
          cartCount={cartCount}
        />
      )}
      {tab === 'busqueda' && (
        <Busqueda termino={busqueda} onBack={() => setTab('categorias')} onCartChanged={refreshCartCount} />
      )}
      {tab === 'carrito' && <Carrito onCartChanged={refreshCartCount} />}
      {tab === 'historico' && <Historico onCartChanged={refreshCartCount} />}

      <div className="bottomnav">
        <button className={tab === 'categorias' ? 'active' : ''} onClick={() => setTab('categorias')}>
          Categorías
        </button>
        <button className={tab === 'productos' ? 'active' : ''} onClick={() => setTab('productos')} disabled={!categoria}>
          Productos
        </button>
        <button className={tab === 'carrito' ? 'active' : ''} onClick={() => setTab('carrito')}>
          Carrito{cartCount > 0 ? <span className="badge">{cartCount}</span> : null}
        </button>
        <button className={tab === 'historico' ? 'active' : ''} onClick={() => setTab('historico')}>
          Histórico
        </button>
      </div>
    </>
  );
}
