import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { api } from '../api.js';

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

// Mismo código detectado dos fotogramas seguidos (o mientras sigue delante
// de la cámara) no debe contar como dos artículos — solo pasado este rato
// se vuelve a aceptar el mismo código, tiempo de sobra para apartar la
// cámara y apuntar al siguiente producto.
const COOLDOWN_MS = 2500;
const MENSAJE_MS = 2200;

function formatoEuro(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `${n}€`;
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
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const ultimoRef = useRef({ codigo: null, cuando: 0 });
  const procesandoRef = useRef(false);
  const mensajeTimeoutRef = useRef(null);

  function avisar(texto) {
    setMensaje(texto);
    clearTimeout(mensajeTimeoutRef.current);
    mensajeTimeoutRef.current = setTimeout(() => setMensaje(null), MENSAJE_MS);
  }

  function procesarCodigo(codigo) {
    procesandoRef.current = true;
    api
      .buscar(codigo)
      .then((data) => {
        const match = (data.resultados || []).find(
          (p) => p.ean === codigo || p.referencia === codigo || p.articulo === codigo
        );
        if (!match) {
          avisar(`✗ Sin coincidencia para "${codigo}"`);
          return;
        }
        setCapturados((prev) => {
          const i = prev.findIndex((c) => c.articulo === match.articulo);
          if (i >= 0) {
            const copia = [...prev];
            copia[i] = { ...copia[i], cantidad: copia[i].cantidad + 1 };
            return copia;
          }
          return [
            ...prev,
            {
              articulo: match.articulo,
              nombre: match.nombre || match.referencia || match.articulo,
              imagen: match.imagen,
              precioFinal: match.precioFinal,
              cantidad: 1,
            },
          ];
        });
        avisar(`✓ ${match.nombre || match.articulo}`);
      })
      .catch(() => avisar('✗ Fallo al buscar ese código'))
      .finally(() => {
        procesandoRef.current = false;
      });
  }

  useEffect(() => {
    if (fase !== 'camara') return undefined;
    let activo = true;
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATOS]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });

    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current, (resultado) => {
        if (!resultado || !activo) return;
        const codigo = resultado.getText();
        const ahora = Date.now();
        if (codigo === ultimoRef.current.codigo && ahora - ultimoRef.current.cuando < COOLDOWN_MS) return;
        if (procesandoRef.current) return;
        ultimoRef.current = { codigo, cuando: ahora };
        procesarCodigo(codigo);
      })
      .then((controls) => {
        controlsRef.current = controls;
        if (!activo) controls.stop();
      })
      .catch((e) => {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado — actívalo en los ajustes del navegador para escanear.'
            : 'No se pudo abrir la cámara: ' + e.message
        );
      });

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
    setCapturados((prev) => prev.filter((c) => c.articulo !== articulo));
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
          <button className="danger-outline" onClick={onCerrar}>
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
            capturados.map((c) => (
              <div key={c.articulo} className="product-row">
                <div className="product-thumb">{c.imagen ? <img src={c.imagen} alt="" /> : '—'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.nombre}
                  </p>
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    {formatoEuro(c.precioFinal) || '—'}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <div className="qty-stepper">
                    <button onClick={() => cambiarCantidad(c.articulo, -1)}>-</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13 }}>{c.cantidad}</span>
                    <button onClick={() => cambiarCantidad(c.articulo, 1)}>+</button>
                  </div>
                  <button className="danger-text" onClick={() => quitarCapturado(c.articulo)} aria-label="Quitar">
                    ✕
                  </button>
                </div>
              </div>
            ))
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
        <p style={{ color: '#fff', margin: 0, fontSize: 14 }}>
          Apunta a un código de barras{capturados.length > 0 ? ` · ${totalUnidades} capturado${totalUnidades === 1 ? '' : 's'}` : ''}
        </p>
        <button className="danger-outline" onClick={salirDeCamara}>
          Salir
        </button>
      </div>

      {error ? (
        <div style={{ padding: 16 }}>
          <div className="error-banner">{error}</div>
        </div>
      ) : (
        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* Solo un marco visual para apuntar — el área real que escanea
              zxing es el fotograma entero, no solo dentro de este recuadro. */}
          <div
            style={{
              position: 'absolute',
              inset: '26% 10%',
              border: '2px solid var(--accent)',
              borderRadius: 8,
              boxShadow: '0 0 0 2000px rgba(0,0,0,0.4)',
            }}
          />
          {mensaje && (
            <div
              style={{
                position: 'absolute',
                top: '10%',
                left: 16,
                right: 16,
                textAlign: 'center',
                background: 'rgba(0,0,0,0.75)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 'var(--radius)',
                fontSize: 13,
              }}
            >
              {mensaje}
            </div>
          )}
        </div>
      )}

      {/* Tira de lo capturado hasta ahora, visible mientras se sigue
          escaneando — así se ve "en directo" lo que ya se ha metido en la
          lista sin tener que salir de la cámara para comprobarlo. */}
      {capturados.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: 12,
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          {capturados.map((c) => (
            <div
              key={c.articulo}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#fff',
                borderRadius: 'var(--radius)',
                padding: '4px 8px 4px 4px',
              }}
            >
              <div className="product-thumb" style={{ width: 30, height: 30 }}>
                {c.imagen ? <img src={c.imagen} alt="" /> : '—'}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>×{c.cantidad}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
