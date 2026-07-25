import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './styles.css';

// registerType:'autoUpdate' (vite.config.js) activa la versión nueva del
// service worker en cuanto la encuentra, sin preguntar — pero eso solo
// cambia qué código sirve a partir de ahora; la pestaña YA abierta sigue
// ejecutando en memoria el JavaScript con el que cargó, aunque el servidor
// ya tenga desplegado algo distinto. Sin este aviso, un cambio recién
// subido podía "no hacer nada" al tocar un botón nuevo: la app seguía
// viva, solo que corriendo código de antes. En cuanto el service worker
// nuevo toma el control, se recarga la página para que sea el código que
// de verdad se acaba de desplegar el que se ejecuta.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    // Una pestaña que se queda abierta mucho tiempo (o de fondo en el
    // móvil) no vuelve a comprobar por su cuenta si hay versión nueva —
    // esto lo fuerza cada hora.
    if (registration) setInterval(() => registration.update(), 60 * 60 * 1000);
  },
});
let recargandoPorSwNuevo = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (recargandoPorSwNuevo) return;
  recargandoPorSwNuevo = true;
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
