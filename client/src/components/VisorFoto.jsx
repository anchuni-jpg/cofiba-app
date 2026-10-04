import { useEffect, useRef } from 'react';

// Modo "solo foto" de la ficha ampliada: la foto a pantalla completa, y con
// los dedos se amplía/reduce (pellizcar) y se mueve por ella (arrastrar).
// Doble toque: amplía donde se toca / vuelve al tamaño normal. En el
// ordenador, rueda del ratón para ampliar y arrastrar para moverse.
// Se sale con el botón ✕ o con "atrás" (lo gestiona FichaProducto).
const MAX = 6;

export default function VisorFoto({ src, onCerrar }) {
  const marcoRef = useRef(null);
  const imgRef = useRef(null);
  const vista = useRef({ escala: 1, x: 0, y: 0 });
  const dedos = useRef(new Map()); // pointerId -> { x, y }
  const gesto = useRef(null);
  const ultimoToque = useRef({ t: 0, x: 0, y: 0 });

  function aplicar(animar) {
    const img = imgRef.current;
    if (!img) return;
    const { escala, x, y } = vista.current;
    img.style.transition = animar ? 'transform 0.25s ease' : 'none';
    img.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
  }

  // Que la foto no se pueda sacar de la pantalla: como mucho hasta su borde.
  function limitar() {
    const v = vista.current;
    const img = imgRef.current;
    const marco = marcoRef.current;
    if (!img || !marco) return;
    if (v.escala <= 1.01) {
      v.escala = 1;
      v.x = 0;
      v.y = 0;
      return;
    }
    const maxX = Math.max(0, (img.offsetWidth * v.escala - marco.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * v.escala - marco.clientHeight) / 2);
    v.x = Math.min(maxX, Math.max(-maxX, v.x));
    v.y = Math.min(maxY, Math.max(-maxY, v.y));
  }

  // Ampliar manteniendo quieto el punto (px, py) de la pantalla.
  function zoomEn(nueva, px, py) {
    const v = vista.current;
    const marco = marcoRef.current.getBoundingClientRect();
    const cx = px - (marco.left + marco.width / 2);
    const cy = py - (marco.top + marco.height / 2);
    const e = Math.min(MAX, Math.max(1, nueva));
    v.x = cx - ((cx - v.x) * e) / v.escala;
    v.y = cy - ((cy - v.y) * e) / v.escala;
    v.escala = e;
  }

  function onPointerDown(e) {
    e.stopPropagation();
    try {
      marcoRef.current.setPointerCapture?.(e.pointerId);
    } catch {
      // (sin captura también funciona; solo es para no perder el dedo al salirse)
    }
    dedos.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    const ps = [...dedos.current.values()];
    if (ps.length === 2) {
      gesto.current = {
        tipo: 'pellizco',
        dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
        escala: vista.current.escala,
        mx: (ps[0].x + ps[1].x) / 2,
        my: (ps[0].y + ps[1].y) / 2,
      };
    } else if (ps.length === 1) {
      gesto.current = { tipo: 'mover', x: e.clientX, y: e.clientY };
    }
  }
  function onPointerMove(e) {
    const d = dedos.current.get(e.pointerId);
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const g = gesto.current;
    const v = vista.current;
    if (!g) return;
    if (g.tipo === 'pellizco' && dedos.current.size >= 2) {
      const ps = [...dedos.current.values()];
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const mx = (ps[0].x + ps[1].x) / 2;
      const my = (ps[0].y + ps[1].y) / 2;
      // Mover con los dos dedos a la vez que se amplía.
      v.x += mx - g.mx;
      v.y += my - g.my;
      g.mx = mx;
      g.my = my;
      zoomEn((g.escala * dist) / g.dist, mx, my);
      aplicar(false);
    } else if (g.tipo === 'mover' && v.escala > 1) {
      v.x += e.clientX - g.x;
      v.y += e.clientY - g.y;
      g.x = e.clientX;
      g.y = e.clientY;
      limitar();
      aplicar(false);
    }
  }
  function onPointerUp(e) {
    const d = dedos.current.get(e.pointerId);
    dedos.current.delete(e.pointerId);
    if (dedos.current.size === 1) {
      // Queda un dedo tras pellizcar: sigue moviendo desde ahí.
      const [otro] = dedos.current.values();
      gesto.current = { tipo: 'mover', x: otro.x, y: otro.y };
    } else if (dedos.current.size === 0) {
      gesto.current = null;
      limitar();
      aplicar(true);
      // ¿Doble toque? (dos toques cortos y quietos seguidos)
      if (d && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) {
        const ahora = Date.now();
        const u = ultimoToque.current;
        if (ahora - u.t < 320 && Math.hypot(e.clientX - u.x, e.clientY - u.y) < 40) {
          if (vista.current.escala > 1.05) vista.current = { escala: 1, x: 0, y: 0 };
          else {
            zoomEn(2.5, e.clientX, e.clientY);
            limitar();
          }
          aplicar(true);
          ultimoToque.current = { t: 0, x: 0, y: 0 };
        } else {
          ultimoToque.current = { t: ahora, x: e.clientX, y: e.clientY };
        }
      }
    }
  }

  // Rueda del ratón (ordenador). Va con addEventListener para poder usar
  // preventDefault (React registra la rueda como pasiva).
  useEffect(() => {
    const marco = marcoRef.current;
    function onWheel(e) {
      e.preventDefault();
      zoomEn(vista.current.escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
      limitar();
      aplicar(false);
    }
    marco.addEventListener('wheel', onWheel, { passive: false });
    return () => marco.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Los toques no deben llegar a la ficha de debajo (que pasaría de producto).
  const parar = (e) => e.stopPropagation();

  return (
    <div className="visor-foto" onTouchStart={parar} onTouchMove={parar} onTouchEnd={parar} onClick={parar}>
      <div
        ref={marcoRef}
        className="visor-foto-marco"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img ref={imgRef} src={src} alt="" draggable={false} />
      </div>
      <button className="visor-foto-cerrar" onClick={onCerrar} aria-label="Cerrar foto">
        ✕
      </button>
      <p className="visor-foto-pista">Pellizca para ampliar · arrastra para moverte · doble toque</p>
    </div>
  );
}
