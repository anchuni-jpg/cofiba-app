import { useState } from 'react';

// Capturas reales de la app (no dibujadas) con los bocadillos ya pegados
// encima de la propia interfaz — ver client/public/tutorial/. El nombre del
// cliente de la cuenta usada para capturarlas se tapó a propósito antes de
// meterlas en el repo.
const DIAPOSITIVAS = [
  { archivo: '/tutorial/slide-01-catalogo.jpg', titulo: 'Explora el catálogo' },
  { archivo: '/tutorial/slide-02-busqueda.jpg', titulo: 'Busca cualquier producto' },
  { archivo: '/tutorial/slide-03-ficha-producto.jpg', titulo: 'Ficha ampliada del producto' },
  { archivo: '/tutorial/slide-04-escaner.jpg', titulo: 'Escanea códigos de barras' },
  { archivo: '/tutorial/slide-05-carrito.jpg', titulo: 'Revisa y confirma el pedido' },
  { archivo: '/tutorial/slide-06-historico.jpg', titulo: 'Recompra en un toque' },
  { archivo: '/tutorial/slide-07-estadisticas.jpg', titulo: 'Lo que más compras' },
  { archivo: '/tutorial/slide-08-novedades.jpg', titulo: 'Novedades del catálogo' },
  { archivo: '/tutorial/slide-09-cambios-stock.jpg', titulo: 'Avisos de stock' },
];

export default function TutorialViewer({ onCerrar }) {
  const [indice, setIndice] = useState(0);
  const ultima = indice === DIAPOSITIVAS.length - 1;
  const primera = indice === 0;

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
          Cómo funciona · {indice + 1}/{DIAPOSITIVAS.length}
        </p>
        <button className="danger" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src={DIAPOSITIVAS[indice].archivo}
          alt={DIAPOSITIVAS[indice].titulo}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--border)' }}>
        <button style={{ flex: 1 }} onClick={() => setIndice((i) => i - 1)} disabled={primera}>
          ← Anterior
        </button>
        {ultima ? (
          <button className="primary" style={{ flex: 1 }} onClick={onCerrar}>
            Entendido
          </button>
        ) : (
          <button className="primary" style={{ flex: 1 }} onClick={() => setIndice((i) => i + 1)}>
            Siguiente →
          </button>
        )}
      </div>
    </div>
  );
}
