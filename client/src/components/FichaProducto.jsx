import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// "Und. de venta" llega como texto con formato español ("12,00").
function formatoCaja(undVenta) {
  const n = parseFloat(String(undVenta).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undVenta;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// Ficha ampliada de un producto, común a Catálogo, Búsqueda e Histórico.
//
// - Se pasa de un producto al siguiente/anterior en el MISMO orden de la
//   lista de la que se abrió: deslizando el dedo sobre la foto o con las
//   flechas grandes pegadas a los bordes de la pantalla.
// - Solo se sale con el botón rojo "Cerrar" (tocar fuera ya no cierra) — o
//   con el botón/gesto "atrás" del móvil, que hace exactamente lo mismo:
//   al abrir se añade una entrada al historial del navegador y "atrás" la
//   consume cerrando la ficha en vez de salir de la pantalla.
export default function FichaProducto({ lista, inicial, onCerrar, pending, añadir, noDisponibles, error }) {
  const [indice, setIndice] = useState(() => {
    const i = lista.indexOf(inicial);
    return i >= 0 ? i : lista.findIndex((p) => p.articulo === inicial.articulo);
  });
  // Un "También te puede interesar" pulsado se enseña encima sin perder la
  // posición en la lista: las flechas siguen desde donde se estaba.
  const [extra, setExtra] = useState(indice < 0 ? inicial : null);
  const producto = extra || lista[indice] || inicial;
  const hayAnterior = indice > 0;
  const haySiguiente = indice >= 0 && indice < lista.length - 1;

  function irA(delta) {
    const nuevo = indice + delta;
    if (nuevo < 0 || nuevo >= lista.length) return;
    setExtra(null);
    setIndice(nuevo);
  }

  // Botón "atrás" del sistema = botón rojo.
  const onCerrarRef = useRef(onCerrar);
  onCerrarRef.current = onCerrar;
  useEffect(() => {
    window.__cofibaFichaAbierta = true; // App.jsx ignora este "atrás"
    // (el "if" evita duplicar la entrada si React monta el efecto dos veces)
    if (!window.history.state?.ficha) window.history.pushState({ ...(window.history.state || {}), ficha: true }, '');
    function onPop() {
      window.__cofibaFichaAbierta = false;
      onCerrarRef.current();
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.__cofibaFichaAbierta = false;
    };
  }, []);
  function cerrar() {
    // Consume la entrada añadida al abrir; el popstate resultante cierra.
    if (window.history.state?.ficha) window.history.back();
    else onCerrar();
  }

  // Teclado (ordenador): flechas para moverse, Escape = Cerrar.
  const irARef = useRef(irA);
  irARef.current = irA;
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft') irARef.current(-1);
      else if (e.key === 'ArrowRight') irARef.current(1);
      else if (e.key === 'Escape') cerrar();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deslizar: horizontal claro (más que vertical) y de al menos 50px.
  const toque = useRef(null);
  function onTouchStart(e) {
    const t = e.touches[0];
    toque.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e) {
    if (!toque.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - toque.current.x;
    const dy = t.clientY - toque.current.y;
    toque.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) irA(dx < 0 ? 1 : -1);
  }

  const [relacionados, setRelacionados] = useState(null);
  useEffect(() => {
    let cancelado = false;
    setRelacionados(null);
    api
      .relacionados(producto.articulo)
      .then((data) => !cancelado && setRelacionados(data.productos || []))
      .catch(() => !cancelado && setRelacionados([]));
    return () => {
      cancelado = true;
    };
  }, [producto.articulo]);

  return (
    <div className="ficha-overlay">
      <div className="ficha-foto" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {producto.imagen ? <img src={producto.imagen} alt="" draggable={false} /> : <span className="muted">Sin foto</span>}
        {hayAnterior && (
          <button className="ficha-flecha ficha-flecha-izq" onClick={() => irA(-1)} aria-label="Producto anterior">
            ‹
          </button>
        )}
        {haySiguiente && (
          <button className="ficha-flecha ficha-flecha-der" onClick={() => irA(1)} aria-label="Producto siguiente">
            ›
          </button>
        )}
        {indice >= 0 && lista.length > 1 && !extra && (
          <span className="ficha-contador">
            {indice + 1} / {lista.length}
          </span>
        )}
      </div>

      <div className="ficha-panel">
        <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 2px' }}>
          {producto.nombre || producto.referencia || producto.articulo}
        </p>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Ref. {producto.referencia || producto.articulo}
          {producto.precioFinal ? ` · ${producto.precioFinal}€` : ''}
          {producto.undVenta ? ` · caja de ${formatoCaja(producto.undVenta)} uds` : ''}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {noDisponibles?.has(producto.articulo) ? (
            <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Ya no está disponible</span>
          ) : (
            <div className="qty-stepper qty-stepper-lg">
              <button onClick={() => añadir(producto, -1)}>-</button>
              <span style={{ minWidth: 24, textAlign: 'center', fontSize: 16 }}>{pending[producto.articulo] ?? 0}</span>
              <button onClick={() => añadir(producto, 1)}>+</button>
            </div>
          )}
          <button className="danger ficha-cerrar" onClick={cerrar}>
            Cerrar
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 11, margin: '8px 0 0' }}>{error}</p>}

        {relacionados && relacionados.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <p className="muted" style={{ margin: '0 0 6px' }}>También te puede interesar</p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {relacionados.map((r) => (
                <div
                  key={r.articulo}
                  style={{ flexShrink: 0, width: 84, textAlign: 'center', cursor: 'pointer' }}
                  onClick={() => setExtra(r)}
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
  );
}
