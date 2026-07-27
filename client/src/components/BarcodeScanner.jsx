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

// Cooldown corto SOLO para códigos que todavía no se han capturado bien
// (fallo de red, o no encontrado) — mientras siguen delante de la cámara no
// tiene sentido reintentarlo en cada fotograma, pero si de verdad falló se
// puede volver a intentar pasado este rato. Un código YA capturado con
// éxito no usa este cooldown en absoluto: se ignora para siempre en esta
// sesión de escaneo (ver capturadosCodigosRef más abajo) — así, mantener el
// mismo producto delante de la cámara un rato no lo suma más de una vez.
const COOLDOWN_MS = 2500;
const MENSAJE_MS = 2200;

// El precio llega ya formateado del servidor como texto con coma decimal
// (p. ej. "5,28"), igual que en Productos.jsx/Busqueda.jsx — Number(n) lo
// convertiría en NaN y el precio nunca se vería, así que se interpola tal cual.
function formatoEuro(n) {
  return n ? `${n}€` : null;
}

// Duplica formatoCaja/nivelStock de Productos.jsx — una función corta, no
// vale la pena compartir el módulo por eso (mismo criterio que el resto de
// la app). Así la lista de capturados enseña justo la misma info
// (referencia, stock, caja) que si se navegara el catálogo normal.
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}
function nivelStock(stock, undVenta) {
  if (!Number.isFinite(stock)) return null;
  const unidadesPorCaja = parseFloat(String(undVenta || '').replace(/\./g, '').replace(',', '.')) || 1;
  const cajas = stock / unidadesPorCaja;
  if (cajas >= 10) return { texto: 'STOCK', bajo: false };
  return cajas <= 0 ? { texto: 'AGOTADO', bajo: true } : { texto: 'STOCK BAJO', bajo: true };
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

  function procesarCodigo(codigo) {
    procesandoRef.current = true;
    api
      .buscar(codigo)
      .then((data) => {
        const match = (data.resultados || []).find(
          (p) => p.ean === codigo || p.referencia === codigo || p.articulo === codigo
        );
        if (!match) {
          // No se marca como capturado — un código que no se encontró SÍ se
          // puede volver a intentar (puede que fuera una lectura a medias).
          avisar(`✗ No encontrado: "${codigo}"`);
          return;
        }
        capturadosCodigosRef.current.add(codigo);
        if (capturadosArticulosRef.current.has(match.articulo)) {
          // Ya estaba en la lista — no suma cantidad, pero el último código
          // leído (aunque sea de algo repetido) siempre se enseña el
          // primero, a la izquierda, sin scroll.
          setCapturados((prev) => {
            const fila = prev.find((c) => c.articulo === match.articulo);
            const resto = prev.filter((c) => c.articulo !== match.articulo);
            return [{ ...fila, codigosVistos: [...fila.codigosVistos, codigo] }, ...resto];
          });
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
            stock: match.stock,
            undVenta: match.undVenta,
            cantidad: 1,
            codigosVistos: [codigo],
          },
          ...prev,
        ]);
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
        if (capturadosCodigosRef.current.has(codigo)) return;
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
            // (Ref., precio, insignia de stock, caja de N uds) — para que
            // repasar lo capturado dé exactamente la misma confianza que
            // navegar el catálogo, no una versión reducida.
            capturados.map((c) => {
              const stock = nivelStock(c.stock, c.undVenta);
              return (
                <div key={c.articulo} className="product-row">
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
                      {stock && (
                        <span style={{ marginLeft: 5, fontSize: 11, color: stock.bajo ? 'var(--danger)' : 'var(--accent)' }}>
                          {stock.texto}
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
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
        <button className="danger" onClick={salirDeCamara}>
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
            // En medio del visor y grande a propósito — es la confirmación
            // de "esto es justo lo que se acaba de capturar" (o el aviso de
            // que no se encontró), tiene que verse clarísimo sin tener que
            // fijarse en una esquina pequeña.
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: 16,
                right: 16,
                transform: 'translateY(-50%)',
                textAlign: 'center',
                background: 'rgba(0,0,0,0.8)',
                color: '#fff',
                padding: '16px 18px',
                borderRadius: 'var(--radius)',
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.3,
              }}
            >
              {mensaje}
            </div>
          )}
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
