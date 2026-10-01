import { useEffect, useState } from 'react';

// Poner la app en la pantalla de inicio del móvil, en el mayor número de
// móviles posible:
//  - Android con Chrome/Edge/Samsung (y Chrome de ordenador): el navegador
//    lo permite directamente → botón "Instalar" de un toque.
//  - iPhone/iPad: Apple no deja que una web se instale sola → instrucciones
//    paso a paso con los mismos dibujos que se ven en pantalla.
//  - Dentro de WhatsApp, Instagram, Facebook...: desde ahí NO se puede
//    instalar → se explica cómo abrirla en el navegador de verdad.
//  - Cualquier otro: instrucciones del menú de su navegador.

const CLAVE_OCULTO = 'cofiba:instalar-oculto-hasta';
const OCULTO_DIAS = 7;

export function detectarDispositivo() {
  const ua = navigator.userAgent || '';
  // iPadOS se presenta como Mac; se distingue por la pantalla táctil.
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const dentroDeApp =
    /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Twitter|TikTok|Snapchat|MicroMessenger|GSA\//i.test(ua) ||
    (android && /; wv\)/i.test(ua));
  let navegador = 'otro';
  if (ios) {
    if (/CriOS/i.test(ua)) navegador = 'chrome';
    else if (/FxiOS/i.test(ua)) navegador = 'firefox';
    else if (/EdgiOS/i.test(ua)) navegador = 'edge';
    else if (!dentroDeApp) navegador = 'safari';
  } else if (/SamsungBrowser/i.test(ua)) navegador = 'samsung';
  else if (/Firefox/i.test(ua)) navegador = 'firefox';
  else if (/EdgA?\//i.test(ua)) navegador = 'edge';
  else if (/OPR\/|Opera/i.test(ua)) navegador = 'opera';
  else if (/Chrome/i.test(ua)) navegador = 'chrome';
  const instalada =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return { ios, android, dentroDeApp, navegador, instalada, movil: ios || android };
}

// Dibujos de los botones tal como se ven en el móvil.
const IconoCompartirIOS = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#007aff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="botón Compartir">
    <path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
    <path d="M12 15V2M8 6l4-4 4 4" />
  </svg>
);
const IconoAnadirIOS = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="icono Añadir">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const Tres = () => <span className="instalar-tecla">⋮</span>;
const Tecla = ({ children }) => <span className="instalar-tecla">{children}</span>;

function pasosPara(d) {
  if (d.dentroDeApp) {
    return {
      titulo: 'Primero ábrela en el navegador',
      aviso: 'Ahora estás dentro de otra aplicación (WhatsApp, Instagram…). Desde aquí el móvil no deja instalarla.',
      pasos: d.ios
        ? [
            <>Toca los <Tecla>···</Tecla> o el icono de la brújula 🧭 (arriba o abajo a la derecha).</>,
            <>Elige <b>«Abrir en Safari»</b> (o «Abrir en el navegador»).</>,
            <>Cuando se abra en Safari, vuelve a tocar <b>📲 Instalar en el móvil</b> y sigue los pasos.</>,
          ]
        : [
            <>Toca los tres puntos <Tres /> arriba a la derecha.</>,
            <>Elige <b>«Abrir en Chrome»</b> (o «Abrir en el navegador»).</>,
            <>Cuando se abra, vuelve a tocar <b>📲 Instalar en el móvil</b>.</>,
          ],
      copiarEnlace: true,
    };
  }
  if (d.ios) {
    const enSafari = d.navegador === 'safari';
    return {
      titulo: 'Añadir a la pantalla de inicio (iPhone)',
      pasos: [
        enSafari ? (
          <>Toca el botón <b>Compartir</b> <IconoCompartirIOS /> — está <b>abajo en el centro</b> de la pantalla (en iPad, arriba a la derecha). Si no ves la barra de abajo, toca una vez la parte de abajo de la pantalla.</>
        ) : (
          <>Toca el botón <b>Compartir</b> <IconoCompartirIOS /> — en Chrome está <b>arriba a la derecha</b>, junto a la dirección.</>
        ),
        <>Desliza la lista hacia arriba y toca <b>«Añadir a pantalla de inicio»</b> <IconoAnadirIOS />.</>,
        <>Arriba a la derecha toca <b>«Añadir»</b>.</>,
        <>¡Listo! Ya tienes el icono verde de <b>Cofiba</b> en tu pantalla. Ábrela siempre desde ahí.</>,
      ],
      nota: enSafari ? null : 'Si no aparece «Añadir a pantalla de inicio», abre esta misma página en Safari (la brújula azul) y repite los pasos.',
      copiarEnlace: !enSafari,
    };
  }
  if (d.android) {
    if (d.navegador === 'samsung') {
      return {
        titulo: 'Añadir a la pantalla de inicio (Samsung)',
        pasos: [
          <>Toca el botón de menú <Tecla>≡</Tecla> (abajo a la derecha).</>,
          <>Toca <b>«Añadir página a»</b> y luego <b>«Pantalla de inicio»</b> (en algunos modelos pone directamente <b>«Añadir a pantalla de inicio»</b>).</>,
          <>Confirma con <b>«Añadir»</b>.</>,
          <>¡Listo! Abre Cofiba desde el icono nuevo.</>,
        ],
      };
    }
    if (d.navegador === 'firefox') {
      return {
        titulo: 'Añadir a la pantalla de inicio (Firefox)',
        pasos: [
          <>Toca los tres puntos <Tres /> (arriba o abajo a la derecha).</>,
          <>Toca <b>«Instalar»</b> o <b>«Añadir a pantalla de inicio»</b>.</>,
          <>Confirma con <b>«Añadir»</b>.</>,
        ],
      };
    }
    return {
      titulo: 'Añadir a la pantalla de inicio (Android)',
      pasos: [
        <>Toca los tres puntos <Tres /> arriba a la derecha del navegador.</>,
        <>Toca <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.</>,
        <>Confirma con <b>«Instalar»</b> o <b>«Añadir»</b>.</>,
        <>¡Listo! Abre Cofiba desde el icono nuevo.</>,
      ],
    };
  }
  return {
    titulo: 'Instalar en el ordenador',
    pasos: [
      <>En Chrome o Edge, busca el icono de instalar <Tecla>⊕</Tecla> a la derecha de la barra de direcciones.</>,
      <>Toca <b>«Instalar»</b>.</>,
    ],
    nota: 'En el móvil es todavía más cómodo: abre esta misma dirección en el móvil y toca «📲 Instalar en el móvil».',
  };
}

// Abre la guía desde cualquier sitio de la app (p. ej. el botón del Catálogo).
export function abrirGuiaInstalacion() {
  window.dispatchEvent(new Event('cofiba:abrir-instalar'));
}

export function useInstalable() {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = () => forzar((n) => n + 1);
    window.addEventListener('cofiba:instalable', f);
    return () => window.removeEventListener('cofiba:instalable', f);
  }, []);
  return detectarDispositivo();
}

export default function InstalarApp() {
  const d = useInstalable();
  const [guia, setGuia] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [oculto, setOculto] = useState(() => {
    try {
      return Number(localStorage.getItem(CLAVE_OCULTO) || 0) > Date.now();
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const abrir = () => setGuia(true);
    window.addEventListener('cofiba:abrir-instalar', abrir);
    return () => window.removeEventListener('cofiba:abrir-instalar', abrir);
  }, []);

  if (d.instalada) return null;

  async function instalar() {
    const evento = window.__cofibaInstalar;
    if (evento) {
      evento.prompt();
      const { outcome } = await evento.userChoice.catch(() => ({}));
      if (outcome === 'accepted') window.__cofibaInstalar = null;
      return;
    }
    setGuia(true);
  }

  function ahoraNo() {
    setOculto(true);
    try {
      localStorage.setItem(CLAVE_OCULTO, String(Date.now() + OCULTO_DIAS * 24 * 60 * 60 * 1000));
    } catch {
      // nada
    }
  }

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(location.origin);
      setCopiado(true);
    } catch {
      window.prompt('Copia este enlace:', location.origin);
    }
  }

  const info = pasosPara(d);

  return (
    <>
      {!oculto && d.movil && (
        <div className="instalar-banner">
          <img src="/icons/icon-192.png" alt="" width="40" height="40" style={{ borderRadius: 9, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>Pon Cofiba en tu pantalla de inicio</b>
            <br />
            <span style={{ fontSize: 12 }}>Se abre al momento, como una app más.</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className="primary" onClick={instalar}>
              {window.__cofibaInstalar ? 'Instalar' : 'Ver cómo'}
            </button>
            <button className="instalar-ahora-no" onClick={ahoraNo}>
              Ahora no
            </button>
          </span>
        </div>
      )}

      {guia && (
        <div className="instalar-overlay" role="dialog" aria-modal="true">
          <div className="instalar-caja">
            <p className="instalar-titulo">📲 {info.titulo}</p>
            {info.aviso && <p className="instalar-aviso">{info.aviso}</p>}
            {window.__cofibaInstalar && !d.dentroDeApp && (
              <button className="primary" style={{ width: '100%', marginBottom: 12 }} onClick={instalar}>
                Instalar ahora (un toque)
              </button>
            )}
            <ol className="instalar-pasos">
              {info.pasos.map((p, i) => (
                <li key={i}>
                  <span className="instalar-num">{i + 1}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
            {info.nota && <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>{info.nota}</p>}
            {info.copiarEnlace && (
              <button style={{ width: '100%', marginBottom: 8 }} onClick={copiarEnlace}>
                {copiado ? '✓ Enlace copiado — pégalo en el navegador' : '🔗 Copiar el enlace de la app'}
              </button>
            )}
            <button className="danger" style={{ width: '100%' }} onClick={() => setGuia(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
