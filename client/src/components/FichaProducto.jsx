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
export default function FichaProducto({ lista, inicial, onCerrar, onVer, pending, añadir, noDisponibles, error }) {
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

  // Transición: la foto actual sale hacia un lado y la nueva entra por el
  // otro (clase .ficha-entra-*, ver styles.css). `entrada` recuerda por qué
  // lado debe entrar la siguiente.
  const fotoRef = useRef(null);
  const [entrada, setEntrada] = useState(null);
  const animandoRef = useRef(false);
  const SALIDA_MS = 170;

  function irA(delta) {
    const nuevo = indice + delta;
    if (nuevo < 0 || nuevo >= lista.length || animandoRef.current) {
      // En un extremo de la lista: la foto vuelve a su sitio.
      if (fotoRef.current) {
        fotoRef.current.style.transition = 'transform 0.2s ease';
        fotoRef.current.style.transform = '';
      }
      return;
    }
    animandoRef.current = true;
    const el = fotoRef.current;
    if (el) {
      el.style.transition = `transform ${SALIDA_MS}ms ease-in, opacity ${SALIDA_MS}ms ease-in`;
      el.style.transform = `translateX(${delta > 0 ? -45 : 45}%)`;
      el.style.opacity = '0';
    }
    setTimeout(() => {
      setEntrada(delta > 0 ? 'der' : 'izq');
      setExtra(null);
      setIndice(nuevo);
      animandoRef.current = false;
    }, SALIDA_MS);
  }

  // Al cambiar de producto: precarga las fotos vecinas (para que la
  // siguiente aparezca sin esperar) y avisa a la pantalla de fondo para que
  // su lista se coloque en este mismo artículo — al cerrar, se sigue por
  // donde se iba.
  useEffect(() => {
    [lista[indice - 1], lista[indice + 1], lista[indice + 2]].forEach((p) => {
      if (p?.imagen) new Image().src = p.imagen;
    });
    const actual = lista[indice];
    if (!actual) return;
    onVer?.(actual);
    const t = setTimeout(() => {
      const fila = document.querySelector(`[data-articulo="${CSS.escape(actual.articulo)}"]`);
      fila?.scrollIntoView({ block: 'center' });
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice]);

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

  // Deslizar: la foto sigue al dedo mientras se arrastra; al soltar, si se
  // ha movido lo bastante (horizontal claro), pasa al siguiente/anterior y
  // si no, vuelve a su sitio.
  const toque = useRef(null);
  function onTouchStart(e) {
    const t = e.touches[0];
    toque.current = { x: t.clientX, y: t.clientY, horizontal: null };
    if (fotoRef.current) fotoRef.current.style.transition = 'none';
  }
  function onTouchMove(e) {
    if (!toque.current || animandoRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - toque.current.x;
    const dy = t.clientY - toque.current.y;
    if (toque.current.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      toque.current.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!toque.current.horizontal || !fotoRef.current) return;
    // En los extremos de la lista se mueve con "resistencia".
    const enExtremo = (dx > 0 && !hayAnterior) || (dx < 0 && !haySiguiente);
    fotoRef.current.style.transform = `translateX(${enExtremo ? dx / 4 : dx}px)`;
    fotoRef.current.style.opacity = String(1 - Math.min(Math.abs(dx) / 600, 0.4));
  }
  function onTouchEnd(e) {
    if (!toque.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - toque.current.x;
    const horizontal = toque.current.horizontal;
    toque.current = null;
    if (horizontal && Math.abs(dx) > 60) {
      irA(dx < 0 ? 1 : -1);
    } else if (fotoRef.current) {
      fotoRef.current.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      fotoRef.current.style.transform = '';
      fotoRef.current.style.opacity = '';
    }
  }

  // "También te puede interesar": al cambiar de producto NO se vacía de
  // golpe — se quedan los anteriores atenuados mientras llegan los nuevos,
  // que entran con un fundido (antes el recuadro desaparecía y reaparecía
  // de golpe, cambiando de tamaño, en cada producto).
  const [relacionados, setRelacionados] = useState(null);
  const [relDe, setRelDe] = useState(null); // artículo al que pertenecen los mostrados
  const cargandoRel = relDe !== producto.articulo;
  useEffect(() => {
    let cancelado = false;
    const articulo = producto.articulo;
    api
      .relacionados(articulo)
      .then((data) => data.productos || [])
      .catch(() => [])
      .then((lista) => {
        if (cancelado) return;
        setRelacionados(lista);
        setRelDe(articulo);
      });
    return () => {
      cancelado = true;
    };
  }, [producto.articulo]);
  const mostrarRel = relacionados === null || relacionados.length > 0;

  return (
    <div className="ficha-overlay">
      <div className="ficha-foto" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div
          key={producto.articulo + '|' + indice}
          ref={fotoRef}
          className={`ficha-foto-marco${entrada ? ` ficha-entra-${entrada}` : ''}`}
        >
          {producto.imagen ? <img src={producto.imagen} alt="" draggable={false} /> : <span className="muted">Sin foto</span>}
        </div>
        {hayAnterior && (
          <button className="ficha-flecha ficha-flecha-izq" onClick={() => irA(-1)} aria-label="Producto anterior">
            <span className="ficha-flecha-visual">‹</span>
          </button>
        )}
        {haySiguiente && (
          <button className="ficha-flecha ficha-flecha-der" onClick={() => irA(1)} aria-label="Producto siguiente">
            <span className="ficha-flecha-visual">›</span>
          </button>
        )}
        {indice >= 0 && lista.length > 1 && !extra && (
          <span className="ficha-contador">
            {indice + 1} / {lista.length}
          </span>
        )}
      </div>

      <div className="ficha-panel">
        <div className="ficha-texto" key={'texto-' + producto.articulo}>
        <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 2px' }}>
          {producto.nombre || producto.referencia || producto.articulo}
        </p>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Ref. {producto.referencia || producto.articulo}
          {producto.precioFinal ? ` · ${producto.precioFinal}€` : ''}
          {producto.undVenta ? ` · caja de ${formatoCaja(producto.undVenta)} uds` : ''}
        </p>
        </div>
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

        <div className={`ficha-rel${mostrarRel ? ' ficha-rel-visible' : ''}${cargandoRel ? ' ficha-rel-cargando' : ''}`}>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <p className="muted" style={{ margin: '0 0 6px' }}>También te puede interesar</p>
            <div className="ficha-rel-fila" key={'rel-' + relDe} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {relacionados === null &&
                [0, 1, 2, 3].map((i) => <div key={i} className="ficha-rel-hueco" />)}
              {(relacionados || []).map((r) => (
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
        </div>
      </div>
    </div>
  );
}
