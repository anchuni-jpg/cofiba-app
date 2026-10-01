import { useRef, useState } from 'react';

// Capturas reales de la app (no dibujadas), solo con recuadros que señalan
// dónde tocar — ver client/public/tutorial/. El texto va aparte, como texto
// de verdad y en letra grande (antes iba pegado dentro de la foto y en el
// móvil se leía muy pequeño). El nombre del cliente de la cuenta usada para
// capturarlas está tapado.
const DIAPOSITIVAS = [
  {
    archivo: '/tutorial/slide-01-catalogo.jpg',
    titulo: 'Explora el catálogo',
    texto: 'Toca una categoría para ver sus productos. Arriba tienes el buscador 🔍, el escáner 📷 y estas instrucciones ❓.',
  },
  {
    archivo: '/tutorial/slide-02-busqueda.jpg',
    titulo: 'Busca cualquier producto',
    texto: 'Escribe el nombre o la referencia. El botón «Comprados» deja solo lo que ya has comprado.',
  },
  {
    archivo: '/tutorial/slide-03-categoria.jpg',
    titulo: 'Dentro de una categoría',
    texto: 'Elige la subcategoría en la fila de arriba. Con + y − añades o quitas cajas del carrito.',
  },
  {
    archivo: '/tutorial/slide-04-ficha-producto.jpg',
    titulo: 'Ficha ampliada',
    texto: 'Toca un producto para verlo en grande. Desliza el dedo o toca ‹ › para pasar al siguiente. Para salir: botón rojo Cerrar o «atrás».',
  },
  {
    archivo: '/tutorial/slide-05-escaner.jpg',
    titulo: 'Escanea códigos de barras',
    texto: 'Pon el código dentro del recuadro de arriba, sobre la línea roja. Puedes escanear varios seguidos. Al terminar, toca Salir.',
  },
  {
    archivo: '/tutorial/slide-06-escaner-revision.jpg',
    titulo: 'Revisa lo escaneado',
    texto: 'Cambia cantidades o quita lo que sobre. Nada entra en el carrito hasta que tocas Confirmar.',
  },
  {
    archivo: '/tutorial/slide-07-carrito.jpg',
    titulo: 'Envía el pedido',
    texto: 'Revisa el carrito y toca «Finalizar pedido». Te pedirá confirmación antes de enviarlo.',
  },
  {
    archivo: '/tutorial/slide-08-envio.jpg',
    titulo: 'Pedido enviado',
    texto: 'Cuando sale este aviso verde, el pedido ya está en Cofiba.',
  },
  {
    archivo: '/tutorial/slide-09-historico.jpg',
    titulo: 'Tu histórico de compras',
    texto: 'Todo lo que has comprado, por categorías. Repite con +, o toca «Ver más» para ver productos parecidos.',
  },
];

export default function TutorialViewer({ onCerrar }) {
  const [indice, setIndice] = useState(0);
  const ultima = indice === DIAPOSITIVAS.length - 1;
  const primera = indice === 0;
  const d = DIAPOSITIVAS[indice];

  // También se pasa de una a otra deslizando el dedo.
  const toque = useRef(null);
  function onTouchEnd(e) {
    if (toque.current == null) return;
    const dx = e.changedTouches[0].clientX - toque.current;
    toque.current = null;
    if (dx < -60 && !ultima) setIndice((i) => i + 1);
    if (dx > 60 && !primera) setIndice((i) => i - 1);
  }

  return (
    <div
      className="tutorial"
      onTouchStart={(e) => (toque.current = e.touches[0].clientX)}
      onTouchEnd={onTouchEnd}
    >
      <div className="tutorial-cabecera">
        <p style={{ margin: 0, fontWeight: 600, fontSize: 18 }}>
          Cómo funciona · {indice + 1} de {DIAPOSITIVAS.length}
        </p>
        <button className="danger" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <div className="tutorial-foto">
        <img key={d.archivo} src={d.archivo} alt={d.titulo} />
      </div>

      <div className="tutorial-texto" key={'t' + indice}>
        <p className="tutorial-titulo">
          {indice + 1}. {d.titulo}
        </p>
        <p className="tutorial-explicacion">{d.texto}</p>
      </div>

      <div className="tutorial-botones">
        <button onClick={() => setIndice((i) => i - 1)} disabled={primera}>
          ← Anterior
        </button>
        {ultima ? (
          <button className="primary" onClick={onCerrar}>
            Entendido
          </button>
        ) : (
          <button className="primary" onClick={() => setIndice((i) => i + 1)}>
            Siguiente →
          </button>
        )}
      </div>
    </div>
  );
}
