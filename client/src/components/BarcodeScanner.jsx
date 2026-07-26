import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

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

// Pantalla completa con la cámara en vivo — se cierra sola en cuanto lee
// algo. Pide la cámara trasera explícitamente (facingMode: environment):
// dejarlo sin especificar en un móvil normal abre la frontal, inútil para
// leer un código de barras de un producto físico.
export default function BarcodeScanner({ onDetectado, onCerrar }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATOS]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (resultado) => {
          if (resultado && activo) {
            activo = false;
            controlsRef.current?.stop();
            onDetectado(resultado.getText());
          }
        }
      )
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
  }, []);

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
        <p style={{ color: '#fff', margin: 0, fontSize: 14 }}>Apunta al código de barras</p>
        <button onClick={onCerrar}>Cerrar</button>
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
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {/* Solo un marco visual para apuntar — el área real que escanea
              zxing es el fotograma entero, no solo dentro de este recuadro. */}
          <div
            style={{
              position: 'absolute',
              inset: '30% 10%',
              border: '2px solid var(--accent)',
              borderRadius: 8,
              boxShadow: '0 0 0 2000px rgba(0,0,0,0.4)',
            }}
          />
        </div>
      )}
    </div>
  );
}
