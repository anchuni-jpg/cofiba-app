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
    texto: 'Escribe el nombre o la referencia (da igual acentos, signos o el orden de las palabras): busca en la app y en la web de Cofiba. Salen ordenados por subcategoría, con franjas como en el Histórico. «Ver más» te lleva a su categoría; «Comprados» deja solo lo ya comprado.',
  },
  {
    archivo: '/tutorial/slide-03-categoria.jpg',
    titulo: 'Dentro de una categoría',
    texto: 'Elige la subcategoría en la fila de arriba, o desliza el dedo a los lados para pasar a la siguiente. Con + y − añades o quitas cajas.',
  },
  {
    archivo: '/tutorial/slide-04-ficha-producto.jpg',
    titulo: 'Ficha ampliada',
    texto: 'Toca un producto para verlo en grande; arriba ves el contador, la subcategoría y ✓ Comprado si ya lo compraste. Desliza o toca ‹ › para pasar al siguiente. Para salir: Cerrar o «atrás».',
  },
  {
    archivo: '/tutorial/slide-04b-modo-foto.jpg',
    titulo: 'Solo la foto',
    texto: 'En la ficha, toca la foto para verla sola a pantalla completa. Amplía o reduce con dos dedos, arrastra para moverte y toca dos veces para acercar o volver. Sal con la ✕ roja o con «atrás».',
  },
  {
    archivo: '/tutorial/slide-05-te-puede-interesar.jpg',
    titulo: 'También te puede interesar',
    texto: 'Debajo de la ficha salen artículos parecidos. Toca uno para recorrerlos igual, con su contador y subcategoría; «‹ Volver a la lista» (o «atrás») te devuelve a donde estabas.',
  },
  {
    archivo: '/tutorial/slide-05-escaner.jpg',
    titulo: 'Escanea códigos de barras',
    texto: 'Pon el código en el recuadro del centro, sobre la línea roja. Si es pequeño, toca 🔍 para acercar; con poca luz, 🔦. Al terminar, toca Salir.',
  },
  {
    archivo: '/tutorial/slide-06-escaner-revision.jpg',
    titulo: 'Revisa lo escaneado',
    texto: 'Toca uno para verlo en grande. Cambia cantidades o quita lo que sobre. Nada entra en el carrito hasta que tocas Confirmar.',
  },
  {
    archivo: '/tutorial/slide-07-historico.jpg',
    titulo: 'Tu histórico de compras',
    texto: 'Botón «Histórico» de abajo: todo lo que has comprado, ordenado por categorías y subcategorías. La primera vez se va leyendo de Cofiba (barra verde); puedes usarlo mientras, y lo que compres se añade solo.',
  },
  {
    archivo: '/tutorial/slide-08-historico-buscar.jpg',
    titulo: 'Busca y ordena tu histórico',
    texto: 'Escribe arriba para buscar solo entre lo que ya compraste. Elige cuántos artículos ver de golpe (25, 50, 100…) y cambia entre Lista y Rejilla. «Actualizar» vuelve a leerlo de Cofiba.',
  },
  {
    archivo: '/tutorial/slide-09-historico-franjas.jpg',
    titulo: 'Las franjas de categoría',
    texto: 'Cada franja verde separa una subcategoría. Tócala para ir a esa subcategoría del catálogo. El botón rojo «✕ Quitar» la despeja de la lista mientras preparas el pedido; al salir del Histórico vuelve a aparecer.',
  },
  {
    archivo: '/tutorial/slide-10-historico-repetir.jpg',
    titulo: 'Repite tus compras',
    texto: 'Con + y − añades o quitas cajas al carrito. «Ver más» abre la categoría del artículo; al volver atrás sigues justo por donde ibas.',
  },
  {
    archivo: '/tutorial/slide-11-historico-ficha.jpg',
    titulo: 'Repasa en grande',
    texto: 'Toca un artículo para verlo en grande y desliza para pasar al siguiente. Bajo el contador ves la subcategoría; al cambiar de subcategoría sale un aviso con su nombre: desliza otra vez para seguir. Al cerrar, el listado queda a la altura del último que viste. Pulsar el botón de abajo te lleva otra vez arriba, actualizado.',
  },
  {
    archivo: '/tutorial/slide-07-carrito.jpg',
    titulo: 'El carrito y el envío',
    texto: 'Botón «Carrito» de abajo: revisa cantidades, elimina lo que sobre y toca «Finalizar pedido». Te pedirá confirmación antes de enviarlo.',
  },
  {
    archivo: '/tutorial/slide-08-envio.jpg',
    titulo: 'Pedido enviado',
    texto: 'Cuando sale este aviso verde, el pedido ya está en Cofiba.',
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
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
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
