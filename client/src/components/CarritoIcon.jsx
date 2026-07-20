// Antes era el emoji 🛒 — en varios móviles se renderiza en un gris muy
// claro (depende de la fuente de emojis del sistema) y quedaba casi
// invisible junto al precio. Un SVG propio con trazo oscuro fijo se ve igual
// de bien en cualquier dispositivo.
export default function CarritoIcon({ size = 13 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#3a3a3a"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: 'middle' }}
      aria-label="En el carrito o pedido en esta sesión"
    >
      <circle cx="9" cy="21" r="1" fill="#3a3a3a" stroke="none" />
      <circle cx="20" cy="21" r="1" fill="#3a3a3a" stroke="none" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
