import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { api } from '../api.js';
import FichaProducto from './FichaProducto.jsx';

// Solo los formatos de barras "de estantería" (EAN/UPC, más Code128/39 por
// si algún proveedor pega su propia etiqueta) — limitar los formatos que
// intenta reconocer, en vez de dejarlo abierto a QR/PDF417/Aztec/etc., es lo
// que de verdad lo hace rápido: cada fotograma tarda menos en descartar
// candidatos que no van a aparecer nunca en un código de barras de producto.
const FORMATOS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

// Cooldown corto SOLO para códigos que todavía no se han capturado bien
// (fallo de red, o no encontrado) — mientras siguen delante de la cámara no
// tiene sentido reintentarlo en cada fotograma, pero si de verdad falló se
// puede volver a intentar pasado este rato. Un código YA capturado con
// éxito no usa este cooldown en absoluto: se ignora para siempre en esta
// sesión de escaneo (ver capturadosCodigosRef más abajo) — así, mantener el
// mismo producto delante de la cámara un rato no lo suma más de una vez.
const COOLDOWN_MS = 2500;
// Lecturas iguales y seguidas que hacen falta para aceptar un código.
const LECTURAS_IGUALES = 2;
const MENSAJE_MS = 2200;

// La retícula ocupa siempre este recuadro del visor (inset: RETICULA_TOP 10% RETICULA_BOTTOM más
// abajo) — ambos avisos de texto se anclan a sus bordes en vez de ir
// centrados en toda la pantalla, así queda claro que hablan de lo que se
// acaba de leer justo ahí, no de la cámara en general.
const RETICULA_TOP = '35%'; // centrado en el visor y apaisado (forma de código de barras)
const RETICULA_BOTTOM = '35%'; // distancia al borde inferior: el recuadro ocupa del 35% al 65%

// El precio llega ya formateado del servidor como texto con coma decimal
// (p. ej. "5,28"), igual que en Productos.jsx/Busqueda.jsx — Number(n) lo
// convertiría en NaN y el precio nunca se vería, así que se interpola tal cual.
function formatoEuro(n) {
  return n ? `${n}€` : null;
}

// Duplica formatoCaja de Productos.jsx — una función corta, no
// vale la pena compartir el módulo por eso (mismo criterio que el resto de
// la app). Así la lista de capturados enseña justo la misma info
// (referencia, caja) que si se navegara el catálogo normal.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Un solo AudioContext reutilizado (crear uno por pitido es innecesario y
// algunos navegadores limitan cuántos puede haber vivos a la vez). Se crea
// perezosamente en el primer pitido, no al montar el componente — abrir la
// cámara ya cuenta como gesto del usuario, así que no hace falta esperar a
// nada más para poder reproducir sonido.
let audioCtxCompartido = null;
function obtenerAudioCtx() {
  if (!audioCtxCompartido) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtxCompartido = new Ctx();
  }
  if (audioCtxCompartido.state === 'suspended') audioCtxCompartido.resume();
  return audioCtxCompartido;
}
function pitido(frecuencia, duracion) {
  const ctx = obtenerAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const ganancia = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    ganancia.gain.setValueAtTime(0.25, ctx.currentTime);
    ganancia.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duracion);
    osc.connect(ganancia).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duracion);
  } catch {
    // Sin sonido en navegadores que no lo permitan (p. ej. sin gesto del
    // usuario todavía) no debe romper el escaneo en sí.
  }
}
// Un pitido agudo y corto para "capturado" (igual que un lector de barras de
// caja real); dos graves para "no encontrado/fallo", claramente distinto al
// oído sin tener que mirar la pantalla.
function sonidoCaptura() {
  pitido(1046.5, 0.11);
}
function sonidoError() {
  pitido(220, 0.13);
  setTimeout(() => pitido(180, 0.15), 140);
}

// Modo "captura continua": la cámara NO se cierra sola al leer un código —
// se queda abierta para seguir leyendo uno tras otro, sumando cada
// coincidencia real del catálogo a una lista en pantalla, hasta que el
// propio cliente pulsa "Salir". Al salir se enseña esa lista para
// confirmarla (o descartarla) antes de tocar el carrito de verdad — nunca
// se añade nada solo por leerlo, hace falta el "Confirmar" explícito.
export default function BarcodeScanner({ onCerrar, onCartChanged }) {
  const [fase, setFase] = useState('camara'); // camara | revision
  const [capturados, setCapturados] = useState([]); // [{articulo, nombre, imagen, precioFinal, cantidad}]
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pistaLinterna, setPistaLinterna] = useState(null);
  // Zoom para códigos pequeños: real de la cámara si lo permite (Android),
  // si no digital (ampliando el centro de la imagen, p. ej. en iPhone).
  const pistaRef = useRef(null);
  const zoomDigitalRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  async function cambiarZoom() {
    const nuevo = zoom >= 3 ? 1 : zoom + 1;
    const pista = pistaRef.current;
    const cap = pista?.getCapabilities?.().zoom;
    if (cap && cap.max >= 2) {
      try {
        const valor = Math.min(cap.max, Math.max(cap.min || 1, nuevo));
        await pista.applyConstraints({ advanced: [{ zoom: valor }] });
        zoomDigitalRef.current = 1;
        setZoom(nuevo);
        return;
      } catch {
        // sigue con el digital
      }
    }
    zoomDigitalRef.current = nuevo;
    setZoom(nuevo);
  }
  const [linterna, setLinterna] = useState(false);
  const [eleccion, setEleccion] = useState(null);
  const [fichaCaptura, setFichaCaptura] = useState(null); // ficha ampliada abierta en la revisión // { codigo, opciones } si un EAN es de varios productos
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const ultimoRef = useRef({ codigo: null, cuando: 0 });
  const procesandoRef = useRef(false);
  const mensajeTimeoutRef = useRef(null);
  // Códigos que ya llevaron a una captura de verdad — se ignoran del todo a
  // partir de ahí (ni se vuelve a pedir al servidor), para que tener el
  // mismo producto delante de la cámara un rato no lo sume varias veces.
  const capturadosCodigosRef = useRef(new Set());
  // Artículos ya en la lista — un código DISTINTO que resulte ser el mismo
  // producto (p. ej. ean vs. referencia) tampoco debe sumar cantidad.
  const capturadosArticulosRef = useRef(new Set());

  function avisar(texto) {
    setMensaje(texto);
    clearTimeout(mensajeTimeoutRef.current);
    mensajeTimeoutRef.current = setTimeout(() => setMensaje(null), MENSAJE_MS);
  }

  function añadirCaptura(match, codigo) {
    capturadosCodigosRef.current.add(codigo);
    if (capturadosArticulosRef.current.has(match.articulo)) {
      // Ya estaba en la lista — no suma cantidad, pero el último código
      // leído (aunque sea de algo repetido) siempre se enseña el primero,
      // a la izquierda, sin scroll.
      setCapturados((prev) => {
        const fila = prev.find((c) => c.articulo === match.articulo);
        const resto = prev.filter((c) => c.articulo !== match.articulo);
        return [{ ...fila, codigosVistos: [...fila.codigosVistos, codigo] }, ...resto];
      });
      sonidoCaptura();
      avisar(`Ya estaba en la lista: ${match.nombre || match.articulo}`);
      return;
    }
    capturadosArticulosRef.current.add(match.articulo);
    // Al principio (no al final): el último capturado tiene que quedar
    // siempre a la izquierda de la tira, visible sin desplazar nada.
    setCapturados((prev) => [
      {
        articulo: match.articulo,
        nombre: match.nombre || match.referencia || match.articulo,
        referencia: match.referencia,
        imagen: match.imagen,
        precioFinal: match.precioFinal,
        undVenta: match.undVenta,
        cantidad: 1,
        codigosVistos: [codigo],
      },
      ...prev,
    ]);
    sonidoCaptura();
    avisar(`✓ ${match.nombre || match.articulo}`);
  }

  function procesarCodigo(codigo) {
    procesandoRef.current = true;
    // Primero el catálogo guardado (instantáneo); si no está ahí, la
    // búsqueda normal, que también pregunta a cofiba.es en directo.
    api
      .porCodigo(codigo)
      .then((data) => (data.resultados?.length ? data : api.buscar(codigo)))
      .then((data) => {
        // Coincidencia EXACTA por EAN, referencia o código (la búsqueda por
        // texto también devuelve parecidos, que no valen aquí).
        const coincidencias = (data.resultados || []).filter(
          (p) => p.ean === codigo || p.referencia === codigo || p.articulo === codigo
        );
        if (!coincidencias.length) {
          // No se marca como capturado — un código que no se encontró SÍ se
          // puede volver a intentar (puede que fuera una lectura a medias).
          sonidoError();
          avisar(`✗ No encontrado: "${codigo}"`);
          return;
        }
        if (coincidencias.length > 1) {
          // Varios productos comparten este EAN (variantes: p. ej. pegatinas
          // de distintos dibujos): se pregunta cuál en vez de coger el
          // primero a ciegas. Mientras se elige no se lee nada más.
          sonidoCaptura();
          setEleccion({ codigo, opciones: coincidencias });
          return true;
        }
        añadirCaptura(coincidencias[0], codigo);
      })
      .catch(() => {
        sonidoError();
        avisar('✗ Fallo al buscar ese código');
      })
      .then((esperandoEleccion) => {
        if (!esperandoEleccion) procesandoRef.current = false;
      });
  }

  function elegir(match) {
    if (match) añadirCaptura(match, eleccion.codigo);
    else capturadosCodigosRef.current.add(eleccion.codigo); // "ninguno": no volver a preguntar por este código
    setEleccion(null);
    procesandoRef.current = false;
  }

  useEffect(() => {
    if (fase !== 'camara') return undefined;
    let activo = true;
    let stream = null;
    const hints = new Map([
      [DecodeHintType.POSSIBLE_FORMATS, FORMATOS],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Confirmación: el mismo código tiene que leerse LECTURAS_IGUALES veces
    // seguidas antes de aceptarlo — descarta lecturas a medias de un código
    // mal enfocado o movido, que son las que daban productos equivocados.
    let candidato = { codigo: null, veces: 0, cuando: 0 };

    function aceptar(codigo) {
      if (capturadosCodigosRef.current.has(codigo)) return;
      const ahora = Date.now();
      if (codigo === ultimoRef.current.codigo && ahora - ultimoRef.current.cuando < COOLDOWN_MS) return;
      if (procesandoRef.current) return;
      ultimoRef.current = { codigo, cuando: ahora };
      procesarCodigo(codigo);
    }

    // Lector NATIVO del móvil (Android/Chrome: BarcodeDetector) si existe —
    // mucho más rápido y certero que zxing; si no (iPhone), zxing.
    let detector = null;
    if ('BarcodeDetector' in window) {
      window.BarcodeDetector.getSupportedFormats?.()
        .then((formatos) => {
          const queremos = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'].filter((f) => formatos.includes(f));
          if (queremos.includes('ean_13')) detector = new window.BarcodeDetector({ formats: queremos });
        })
        .catch(() => {});
    }
    // EAN/UPC traen dígito de control (el lector ya lo comprueba): basta UNA
    // lectura. Code128/39 de etiquetas internas no siempre: esas sí piden
    // dos lecturas iguales seguidas antes de aceptarlas.
    const CON_CONTROL_ZXING = new Set([BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
    const CON_CONTROL_NATIVO = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e']);

    function resultado(codigo, fiable) {
      if (!codigo) return;
      if (fiable) {
        candidato = { codigo: null, veces: 0, cuando: 0 };
        aceptar(codigo);
        return;
      }
      const ahora = Date.now();
      candidato =
        codigo === candidato.codigo && ahora - candidato.cuando < 1500
          ? { codigo, veces: candidato.veces + 1, cuando: ahora }
          : { codigo, veces: 1, cuando: ahora };
      if (candidato.veces >= LECTURAS_IGUALES) {
        candidato = { codigo: null, veces: 0, cuando: 0 };
        aceptar(codigo);
      }
    }

    // Cada fotograma se analiza de UNA de estas maneras, por turnos (medido
    // con códigos de prueba: ninguna sola lee todos los casos, juntas sí):
    //  - franja de la retícula con margen, reducida a 960 px: lo normal;
    //  - a 640 px con contraste realzado: poca luz/ruido, pequeño y algo
    //    desenfocado;
    //  - solo la retícula a resolución completa: códigos diminutos (lejos);
    //  - muy reducida (360 px) con contraste: muy desenfocado.
    // Se lee la franja de la retícula y poco más (no la imagen entera: en
    // una estantería eso cogía el código del producto de al lado).
    const PASADAS = [
      { ancho: 960, margen: 0.1, contraste: 0 },
      { ancho: 640, margen: 0.1, contraste: 3 },
      { ancho: null, margen: 0, contraste: 0 },
      { ancho: 360, margen: 0.1, contraste: 2 },
      // diminutos: la retícula ampliada x2 con suavizado (zxing no lee con
      // menos de ~1,5 px por barra; ampliando, sí hasta algo menos)
      { ancho: null, margen: 0, contraste: 0, ampliar: 2 },
    ];
    let turno = 0;

    // Gris + contraste a mano (ctx.filter no existe en todos los Safari).
    function realzar(k) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = (g - 128) * k + 128;
        d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      ctx.putImageData(img, 0, 0);
    }

    function copiarFranja(video, { ancho, margen, ampliar = 1 }) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      // El vídeo se pinta con object-fit: cover (y, con zoom digital,
      // ampliado con CSS desde el centro) — se deshace ese escalado para
      // saber qué trozo del fotograma real cae bajo la retícula.
      const escala = Math.max(cw / vw, ch / vh) * zoomDigitalRef.current;
      const offX = (vw * escala - cw) / 2;
      const offY = (vh * escala - ch) / 2;
      const top = parseFloat(RETICULA_TOP) / 100;
      const bottom = parseFloat(RETICULA_BOTTOM) / 100;
      const x1 = cw * (margen ? 0.02 : 0.06), x2 = cw * (margen ? 0.98 : 0.94);
      const y1 = ch * Math.max(0, top - margen), y2 = ch * Math.min(1, 1 - bottom + margen);
      const sx = (x1 + offX) / escala;
      const sy = (y1 + offY) / escala;
      const sw = (x2 - x1) / escala;
      const sh = (y2 - y1) / escala;
      const reduce = ancho ? Math.min(1, ancho / sw) : ampliar;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      canvas.width = Math.round(sw * reduce);
      canvas.height = Math.round(sh * reduce);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }

    async function leerFotograma() {
      const video = videoRef.current;
      if (!activo || !video || video.readyState < 2 || !video.videoWidth) return;
      turno += 1;

      // Lector nativo (si hay): en todos los fotogramas menos uno de cada
      // tres, que se deja a zxing por si acaso el nativo no lo pilla.
      if (detector && turno % 3 !== 0) {
        copiarFranja(video, { ancho: null, margen: 0.1 }); // el nativo es rápido: a resolución completa
        try {
          const encontrados = await detector.detect(canvas);
          if (encontrados.length) {
            // Si hay varios, el más cercano al centro (a la línea roja).
            const cx = canvas.width / 2, cy = canvas.height / 2;
            const dist = (d) => {
              const bb = d.boundingBox;
              return Math.hypot(bb.x + bb.width / 2 - cx, bb.y + bb.height / 2 - cy);
            };
            const mejor = encontrados.sort((p, q) => dist(p) - dist(q))[0];
            resultado(mejor.rawValue, CON_CONTROL_NATIVO.has(mejor.format));
          }
        } catch {
          detector = null; // falla el nativo: se sigue solo con zxing
        }
        return;
      }

      const pasada = PASADAS[turno % PASADAS.length];
      copiarFranja(video, pasada);
      if (pasada.contraste) realzar(pasada.contraste);
      try {
        const r = reader.decodeFromCanvas(canvas);
        resultado(r.getText(), CON_CONTROL_ZXING.has(r.getBarcodeFormat()));
      } catch {
        // Nada legible en este fotograma.
      }
    }

    // Bucle sin solaparse: el siguiente fotograma se analiza cuando acaba
    // el anterior (con setInterval, si un análisis tardaba más que el
    // intervalo, se amontonaban y el escáner iba a trompicones).
    async function bucle() {
      while (activo) {
        await leerFotograma();
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'environment',
          // Más resolución = barras más nítidas dentro de la retícula.
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
      })
      // Plan B: algún móvil rechaza esas preferencias — se pide la cámara
      // trasera sin más, antes que quedarse sin escáner.
      .catch((e) =>
        e?.name === 'NotAllowedError' ? Promise.reject(e) : navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      )
      .then(async (s) => {
        stream = s;
        if (!activo) return s.getTracks().forEach((t) => t.stop());
        // Enfoque continuo donde el móvil lo permita (Android/Chrome).
        const pista = s.getVideoTracks()[0];
        try {
          if (pista.getCapabilities?.().focusMode?.includes('continuous')) {
            await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          }
        } catch {
          // No soportado: se queda con el enfoque por defecto.
        }
        pistaRef.current = pista;
        const video = videoRef.current;
        video.srcObject = s;
        // Sin esperar a play(): el bucle ya comprueba él solo si el vídeo
        // tiene imagen (readyState), y en algún navegador play() tarda o
        // no resuelve nunca.
        video.play().catch(() => {});
        bucle();
        // Linterna, si la cámara la tiene (para pasillos con poca luz).
        try {
          if (pista.getCapabilities?.().torch) setPistaLinterna(pista);
        } catch {
          // nada
        }
      })
      .catch((e) => {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado — actívalo en los ajustes del navegador para escanear.'
            : 'No se pudo abrir la cámara: ' + e.message
        );
      });

    controlsRef.current = {
      stop() {
        activo = false;
        stream?.getTracks().forEach((t) => t.stop());
      },
    };

    return () => {
      activo = false;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  useEffect(() => () => clearTimeout(mensajeTimeoutRef.current), []);

  function salirDeCamara() {
    controlsRef.current?.stop();
    setFase('revision');
  }

  function quitarCapturado(articulo) {
    setCapturados((prev) => {
      const fila = prev.find((c) => c.articulo === articulo);
      // Si se quita de la lista a mano, se libera también del "ya
      // capturado" — si el cliente vuelve a escanearlo, debe poder volver a
      // añadirlo (los códigos concretos que se leyeron para esta fila
      // quedan guardados en la propia fila, ver procesarCodigo).
      fila?.codigosVistos?.forEach((c) => capturadosCodigosRef.current.delete(c));
      capturadosArticulosRef.current.delete(articulo);
      return prev.filter((c) => c.articulo !== articulo);
    });
  }

  function cambiarCantidad(articulo, delta) {
    setCapturados((prev) =>
      prev
        .map((c) => (c.articulo === articulo ? { ...c, cantidad: Math.max(1, c.cantidad + delta) } : c))
        .filter(Boolean)
    );
  }

  function confirmar() {
    if (!capturados.length) return;
    setConfirmando(true);
    Promise.all(capturados.map((c) => api.anadirAlCarrito({ articulo: c.articulo, cantidad: c.cantidad })))
      .then(() => {
        onCartChanged?.();
        onCerrar();
      })
      .catch((e) => {
        setError(e.message);
        setConfirmando(false);
      });
  }

  const totalUnidades = capturados.reduce((acc, c) => acc + c.cantidad, 0);

  if (fase === 'revision') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--surface-2)',
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 500 }}>
            Capturado{capturados.length === 1 ? '' : 's'} ({totalUnidades} caja{totalUnidades === 1 ? '' : 's'})
          </p>
          <button className="danger" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
          {capturados.length === 0 ? (
            <p className="muted" style={{ marginTop: 16 }}>
              No se capturó ningún código. Vuelve a "Seguir escaneando" o cierra.
            </p>
          ) : (
            // Misma info que una fila normal de Catálogo/Búsqueda/Histórico
            // (Ref., precio, caja de N uds) — para que
            // repasar lo capturado dé exactamente la misma confianza que
            // navegar el catálogo, no una versión reducida.
            capturados.map((c) => {
              return (
                <div
                  key={c.articulo}
                  className="product-row"
                  data-articulo={c.articulo}
                  onClick={() => setFichaCaptura(c)}
                  style={{ cursor: 'zoom-in' }}
                >
                  <div className="product-thumb">{c.imagen ? <img src={c.imagen} alt="" /> : '—'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.nombre}
                    </p>
                    <p className="muted" style={{ margin: '2px 0' }}>
                      Ref. {c.referencia || c.articulo}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--accent)' }}>
                      {formatoEuro(c.precioFinal) || '—'}
                    </p>
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                  >
                    <div className="qty-stepper">
                      <button onClick={() => cambiarCantidad(c.articulo, -1)}>-</button>
                      <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{c.cantidad}</span>
                      <button onClick={() => cambiarCantidad(c.articulo, 1)}>+</button>
                    </div>
                    {c.undVenta && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        caja de {formatoCaja(c.undVenta)} uds
                      </span>
                    )}
                    <button className="danger-text" onClick={() => quitarCapturado(c.articulo)} aria-label="Quitar">
                      ✕ Quitar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--border)' }}>
          <button style={{ flex: 1 }} onClick={() => setFase('camara')}>
            📷 Seguir escaneando
          </button>
          <button
            className="primary"
            style={{ flex: 1 }}
            onClick={confirmar}
            disabled={!capturados.length || confirmando}
          >
            {confirmando ? 'Añadiendo…' : `Confirmar → carrito`}
          </button>
        </div>

        {/* La misma ficha ampliada que en el catálogo: pasar de uno a otro
            deslizando o con las flechas. Aquí + y − cambian lo capturado
            (nada entra en el carrito hasta "Confirmar"). */}
        {fichaCaptura && (
          <FichaProducto
            lista={capturados}
            inicial={fichaCaptura}
            onCerrar={() => setFichaCaptura(null)}
            pending={Object.fromEntries(capturados.map((c) => [c.articulo, c.cantidad]))}
            añadir={(p, delta) => {
              if (capturadosArticulosRef.current.has(p.articulo)) cambiarCantidad(p.articulo, delta);
              else if (delta > 0) añadirCaptura(p, p.ean || p.referencia || p.articulo);
            }}
            noDisponibles={new Set()}
            error={null}
          />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
        <p style={{ color: '#fff', margin: 0, fontSize: 13, flex: 1, minWidth: 0, paddingRight: 8 }}>
          Apunta a un código de barras{capturados.length > 0 ? ` · ${totalUnidades} capturado${totalUnidades === 1 ? '' : 's'}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={cambiarZoom}
            aria-label="Acercar"
            style={{ background: zoom > 1 ? '#20944b' : 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', fontWeight: 700, whiteSpace: 'nowrap', padding: '8px 10px' }}
          >
            🔍 {zoom}x
          </button>
          {pistaLinterna && (
            <button
              onClick={() => {
                const nueva = !linterna;
                pistaLinterna.applyConstraints({ advanced: [{ torch: nueva }] }).then(() => setLinterna(nueva)).catch(() => {});
              }}
              aria-label={linterna ? 'Apagar linterna' : 'Encender linterna'}
              style={{ background: linterna ? '#ffd60a' : 'rgba(255,255,255,0.15)', color: linterna ? '#000' : '#fff', border: 'none' }}
            >
              🔦
            </button>
          )}
          <button className="danger" onClick={salirDeCamara}>
            Salir
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: 16 }}>
          <div className="error-banner">{error}</div>
        </div>
      ) : (
        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: zoomDigitalRef.current > 1 ? `scale(${zoomDigitalRef.current})` : undefined,
              transition: 'transform 0.2s ease',
            }}
          />
          {/* Solo un marco visual para apuntar — el área real que escanea
              zxing es el fotograma entero, no solo dentro de este recuadro. */}
          <div
            style={{
              position: 'absolute',
              inset: `${RETICULA_TOP} 6% ${RETICULA_BOTTOM}`,
              border: '2px solid var(--accent)',
              borderRadius: 8,
              boxShadow: '0 0 0 2000px rgba(0,0,0,0.4)',
            }}
          >
            {/* Línea roja tipo láser en el centro: dónde poner las barras. */}
            <div className="escaner-laser" />
          </div>
          {capturados.length > 0 && (
            // Justo ENCIMA de la retícula, fijo mientras haya algo capturado
            // (no un aviso que se apaga solo como `mensaje` de abajo) — el
            // nombre de lo último capturado, para saber sin duda qué se
            // acaba de meter en la lista.
            <div
              style={{
                position: 'absolute',
                top: RETICULA_TOP,
                left: 16,
                right: 16,
                transform: 'translateY(calc(-100% - 10px))',
                textAlign: 'center',
                color: 'var(--accent)',
                fontSize: 15,
                fontWeight: 700,
                textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {capturados[0].nombre}
            </div>
          )}
          {mensaje && (
            // Justo DEBAJO de la retícula (no en medio de la pantalla) — verde
            // cuando confirma una captura, rojizo cuando avisa de que no se
            // encontró o falló, para distinguirlos también por color.
            <div
              style={{
                position: 'absolute',
                top: `calc(100% - ${RETICULA_BOTTOM})`,
                left: 16,
                right: 16,
                transform: 'translateY(10px)',
                textAlign: 'center',
                background: 'rgba(0,0,0,0.8)',
                color: mensaje.startsWith('✗') ? '#ff8a80' : 'var(--accent)',
                padding: '14px 16px',
                borderRadius: 'var(--radius)',
                fontSize: 19,
                fontWeight: 700,
                lineHeight: 1.3,
              }}
            >
              {mensaje}
            </div>
          )}
        </div>
      )}

      {eleccion && (
        <div className="escaner-eleccion">
          <div className="escaner-eleccion-caja">
            <p style={{ fontWeight: 600, margin: '0 0 2px' }}>Este código es de varios productos</p>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
              Toca el que tienes en la mano ({eleccion.codigo})
            </p>
            <div style={{ overflowY: 'auto', maxHeight: '55vh' }}>
              {eleccion.opciones.map((p) => (
                <button key={p.articulo} className="escaner-eleccion-opcion" onClick={() => elegir(p)}>
                  <div className="product-thumb" style={{ width: 56, height: 56, flexShrink: 0 }}>
                    {p.imagen ? <img src={p.imagen} alt="" /> : '—'}
                  </div>
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14 }}>{p.nombre || p.articulo}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Ref. {p.referencia || p.articulo}
                      {p.precioFinal ? ` · ${p.precioFinal}€` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <button className="danger" style={{ width: '100%', marginTop: 10 }} onClick={() => elegir(null)}>
              Ninguno
            </button>
          </div>
        </div>
      )}

      {/* Tira de lo capturado hasta ahora, visible mientras se sigue
          escaneando — así se ve "en directo" lo que ya se ha metido en la
          lista sin tener que salir de la cámara para comprobarlo. Bastante
          más grande que un chip normal (era difícil distinguir qué se
          acababa de capturar), y la última captura (siempre al final del
          array — solo se añade al final) todavía más grande, a modo de
          confirmación visual clara de "esto es justo lo que acabas de
          leer". Si esto deja menos alto para el visor de la cámara arriba,
          es aceptable — se encoge solo (flex:1 en el visor). */}
      {capturados.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 10,
            overflowX: 'auto',
            padding: 14,
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          {capturados.map((c, idx) => {
            // Ahora se añade al PRINCIPIO del array (ver procesarCodigo), así
            // que la última captura es el índice 0, no el último.
            const esUltima = idx === 0;
            const tamThumb = esUltima ? 64 : 44;
            return (
              <div
                key={c.articulo}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  // Blanco fijo a propósito (no var(--surface-2)): esta tira
                  // vive siempre sobre la cámara oscura, sea cual sea el
                  // tema de la app — y por eso el texto de dentro también
                  // necesita un color fijo oscuro, no heredar
                  // --text-primary (que en modo oscuro es casi blanco y
                  // quedaría invisible sobre este mismo fondo blanco).
                  background: '#fff',
                  color: '#222',
                  borderRadius: 'var(--radius)',
                  padding: esUltima ? '8px 10px' : '6px 8px',
                  border: esUltima ? '2px solid var(--accent)' : 'none',
                }}
              >
                <div className="product-thumb" style={{ width: tamThumb, height: tamThumb }}>
                  {c.imagen ? <img src={c.imagen} alt="" /> : '—'}
                </div>
                <span style={{ fontSize: esUltima ? 13 : 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  ×{c.cantidad}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
