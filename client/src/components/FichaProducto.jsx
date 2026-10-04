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
export default function FichaProducto({
  lista,
  inicial,
  onCerrar,
  onVer,
  pending,
  añadir,
  noDisponibles,
  error,
  // Catálogo: subcategorías vecinas ({ slug, nombre } o null). Al pasar del
  // último artículo (o antes del primero) se salta a la vecina, con aviso.
  grupoAnterior = null,
  grupoSiguiente = null,
  onCambiarGrupo,
  avisoGrupo = null,
  // Histórico: grupo (categoría/subcategoría) de cada artículo. Al pasar a
  // un artículo de otro grupo se avisa primero (ver `pausa`).
  grupoDe = null,
  // Nombre de la subcategoría cuando los artículos no lo traen (catálogo).
  etiquetaGrupo = null,
}) {
  const [indice, setIndice] = useState(() => {
    const i = lista.indexOf(inicial);
    return i >= 0 ? i : lista.findIndex((p) => p.articulo === inicial.articulo);
  });
  // Un "También te puede interesar" pulsado se enseña encima sin perder la
  // posición en la lista: las flechas siguen desde donde se estaba.
  const [extra, setExtra] = useState(indice < 0 ? inicial : null);
  const producto = extra || lista[indice] || inicial;
  const subcategoriaActual =
    (grupoDe && !extra ? grupoDe(producto)?.subcategoria : null) ||
    producto.subcategoriaNombre ||
    (extra ? null : etiquetaGrupo) ||
    null;
  const hayAnterior = indice > 0 || (indice === 0 && !!grupoAnterior);
  const haySiguiente = (indice >= 0 && indice < lista.length - 1) || (indice === lista.length - 1 && !!grupoSiguiente);

  // Transición: la foto actual sale hacia un lado y la nueva entra por el
  // otro (clase .ficha-entra-*, ver styles.css). `entrada` recuerda por qué
  // lado debe entrar la siguiente.
  const fotoRef = useRef(null);
  const [entrada, setEntrada] = useState(null);
  const animandoRef = useRef(false);
  const SALIDA_MS = 170;

  // Aviso de cambio de categoría/subcategoría: NO pasa solo. Se queda hasta
  // que se desliza (o se toca la flecha, o el propio aviso) otra vez en la
  // misma dirección; hacia el otro lado se cancela y se sigue donde se estaba.
  const [pausa, setPausa] = useState(null); // { dir, tipo: 'grupo'|'salto', etiqueta, nombre, sub }

  function aSuSitio() {
    if (!fotoRef.current) return;
    fotoRef.current.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    fotoRef.current.style.transform = '';
    fotoRef.current.style.opacity = '';
  }
  function salirFoto(delta) {
    const el = fotoRef.current;
    if (!el) return;
    el.style.transition = `transform ${SALIDA_MS}ms ease-in, opacity ${SALIDA_MS}ms ease-in`;
    el.style.transform = `translateX(${delta > 0 ? -45 : 45}%)`;
    el.style.opacity = '0';
  }
  function moverA(nuevo, delta) {
    animandoRef.current = true;
    salirFoto(delta);
    setTimeout(() => {
      setEntrada(delta > 0 ? 'der' : 'izq');
      setExtra(null);
      setIndice(nuevo);
      animandoRef.current = false;
    }, SALIDA_MS);
  }

  function irA(delta) {
    if (animandoRef.current || avisoGrupo) return aSuSitio();
    if (pausa) {
      const p = pausa;
      setPausa(null);
      if (p.dir !== delta) return aSuSitio(); // hacia el otro lado: se cancela
      if (p.tipo === 'salto') {
        salirFoto(delta);
        onCambiarGrupo?.(delta);
      } else {
        moverA(indice + delta, delta);
      }
      return;
    }
    const nuevo = indice + delta;
    // Fin de la subcategoría (catálogo): aviso con la vecina.
    const vecina = delta > 0 ? grupoSiguiente : grupoAnterior;
    if (!extra && vecina && (nuevo >= lista.length || nuevo < 0)) {
      aSuSitio();
      setPausa({ dir: delta, tipo: 'salto', etiqueta: delta > 0 ? 'Siguiente subcategoría' : 'Subcategoría anterior', nombre: vecina.nombre });
      return;
    }
    if (nuevo < 0 || nuevo >= lista.length) return aSuSitio();
    // Histórico: el siguiente artículo es de otro grupo → aviso primero.
    if (grupoDe && !extra) {
      const g1 = grupoDe(lista[indice]);
      const g2 = grupoDe(lista[nuevo]);
      if (g1.clave !== g2.clave) {
        aSuSitio();
        setPausa({
          dir: delta,
          tipo: 'grupo',
          etiqueta: g1.categoria !== g2.categoria ? 'Cambio de categoría' : 'Cambio de subcategoría',
          nombre: g1.categoria !== g2.categoria ? g2.categoria : g2.subcategoria,
          sub: g1.categoria !== g2.categoria ? g2.subcategoria : g2.categoria,
        });
        return;
      }
    }
    moverA(nuevo, delta);
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

  // Deslizar: se puede hacer en toda la ficha (foto y datos) MENOS en "También
  // te puede interesar", que se desliza por su cuenta. La foto sigue al dedo;
  // al soltar, si se ha movido lo bastante (horizontal claro) pasa UNO al
  // siguiente/anterior y si no, vuelve a su sitio.
  const toque = useRef(null);
  // Tras un deslizamiento, el navegador a veces "toca" además la flecha que
  // queda bajo el dedo: eso sumaba un segundo paso (se saltaba artículos).
  const ultimoDeslizarRef = useRef(0);
  const pulsarFlecha = (delta) => {
    if (Date.now() - ultimoDeslizarRef.current < 500) return;
    irA(delta);
  };
  function onTouchStart(e) {
    if (e.touches.length > 1 || e.target.closest('.ficha-rel')) {
      toque.current = null;
      return;
    }
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
    if (horizontal) {
      ultimoDeslizarRef.current = Date.now();
      if (e.cancelable) e.preventDefault(); // sin "toque" extra al soltar
    }
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
    <div
      className="ficha-overlay"
      onTouchStart={(e) => {
        e.stopPropagation(); // los gestos de la ficha no llegan a la pantalla de debajo
        onTouchStart(e);
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
        onTouchMove(e);
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        onTouchEnd(e);
      }}
    >
      <div className="ficha-foto">
        <div
          key={producto.articulo + '|' + indice}
          ref={fotoRef}
          className={`ficha-foto-marco${entrada ? ` ficha-entra-${entrada}` : ''}${pausa ? ' ficha-foto-en-pausa' : ''}`}
        >
          {producto.imagen ? <img src={producto.imagen} alt="" draggable={false} /> : <span className="muted">Sin foto</span>}
        </div>
        {pausa && !avisoGrupo && (
          <button
            className={`ficha-aviso-grupo ficha-aviso-manual ficha-aviso-${pausa.dir > 0 ? 'der' : 'izq'}`}
            onClick={() => irA(pausa.dir)}
          >
            <span className="ficha-aviso-etiqueta">{pausa.etiqueta}</span>
            <span className="ficha-aviso-nombre">
              {pausa.dir < 0 && '← '}
              {pausa.nombre}
              {pausa.dir > 0 && ' →'}
            </span>
            {pausa.sub && <span className="ficha-aviso-sub">{pausa.sub}</span>}
            <span className="ficha-aviso-pista">Desliza otra vez o toca aquí para continuar</span>
          </button>
        )}
        {avisoGrupo && (
          <div className={`ficha-aviso-grupo ficha-aviso-${avisoGrupo.dir > 0 ? 'der' : 'izq'}`}>
            <span className="ficha-aviso-etiqueta">{avisoGrupo.dir > 0 ? 'Siguiente subcategoría' : 'Subcategoría anterior'}</span>
            <span className="ficha-aviso-nombre">
              {avisoGrupo.dir < 0 && '← '}
              {avisoGrupo.nombre}
              {avisoGrupo.dir > 0 && ' →'}
            </span>
            <span className="ficha-aviso-cargando" />
          </div>
        )}
        {hayAnterior && (
          <button className="ficha-flecha ficha-flecha-izq" onClick={() => pulsarFlecha(-1)} aria-label="Producto anterior">
            <span className="ficha-flecha-visual">‹</span>
          </button>
        )}
        {haySiguiente && (
          <button className="ficha-flecha ficha-flecha-der" onClick={() => pulsarFlecha(1)} aria-label="Producto siguiente">
            <span className="ficha-flecha-visual">›</span>
          </button>
        )}
        {/* Contador y, debajo, la subcategoría en la que se está. */}
        {((indice >= 0 && lista.length > 1 && !extra) || subcategoriaActual) && (
          <div className="ficha-cabeza">
            {indice >= 0 && lista.length > 1 && !extra && (
              <span className="ficha-contador">
                {indice + 1} / {lista.length}
              </span>
            )}
            {subcategoriaActual && (
              <span className="ficha-subcategoria" key={subcategoriaActual}>
                {subcategoriaActual}
              </span>
            )}
          </div>
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
