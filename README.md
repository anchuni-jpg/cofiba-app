# Cofiba · Visor de pedidos

App instalable (PWA) que hace de visor ágil sobre el catálogo B2B de
`cofiba.es`: categorías, productos con alta rápida, y carrito. No sustituye la
web (facturas, catálogos PDF, promociones siguen ahí), solo agiliza el
"mirar y pedir" desde el móvil.

## Cómo está montado

- `server/`: API en Node/Express que hace de puente. Cuando un cliente inicia
  sesión en la app, el backend inicia sesión *con esas mismas credenciales*
  en cofiba.es (guardando su cookie de sesión en memoria) y traduce el HTML
  de la web a JSON para el frontend.
- `client/`: PWA en React + Vite, instalable en Android e iOS vía
  "Añadir a pantalla de inicio" — sin tienda de apps, sin cuentas de
  desarrollador.

No existe una API JSON oficial en cofiba.es, así que el backend funciona
leyendo y "entendiendo" las páginas reales (categorías, fichas de producto,
carrito) en vez de llamar a endpoints fijos. Es más robusto que adivinar
nombres de campos porque descubre formularios reales en cada petición, pero
significa que si cofiba.es cambia su plantilla, el parser puede necesitar un
ajuste.

## Arrancar en local

```bash
cd server && npm install && npm run dev   # http://localhost:4000
cd client && npm install && npm run dev   # http://localhost:5173
```

El cliente ya tiene el proxy `/api` apuntando al backend en desarrollo.

## Cómo lo prueba el cliente en su móvil

Para que el propio cliente pueda instalarlo como app necesita abrir una URL
servida por **HTTPS** desde su navegador (localhost no sirve desde fuera de
este ordenador).

En producción el propio `server/` sirve también los estáticos de
`client/dist` (mismo origen, sin CORS ni rewrites que configurar). Hay un
`render.yaml` listo para desplegar los dos como un único servicio en
[Render](https://render.com): conecta el repo desde su dashboard ("New +" →
"Blueprint") y detecta el `render.yaml` solo. Build: `client` compila con
`vite build` y `server` sirve `client/dist` cuando `NODE_ENV=production`.

Una vez esté esa URL:
- **Android/Chrome**: menú ⋮ → "Instalar app" (o aparece un banner solo).
- **iOS/Safari**: botón compartir → "Añadir a pantalla de inicio".

## Verificado hasta ahora

- ✅ El certificado de cofiba.es no incluye el intermedio (`Don Dominio RSA DV
  SSL CA 2`); el backend lo añade explícitamente a su lista de CAs de
  confianza (`server/src/cofiba-intermediate.pem`) en vez de desactivar la
  verificación TLS.
- ✅ Circuito completo probado de extremo a extremo (app → backend → login
  real en cofiba.es) con credenciales de prueba: el formulario de login se
  localiza dinámicamente, se envía, y la web responde correctamente
  (usuario/contraseña incorrectos, como se esperaba con datos falsos).

## Pendiente de calibrar con una sesión real

No he usado credenciales reales del cliente (por diseño: la app solo debe
manejarlas en tiempo real, nunca yo). Con datos de prueba no se puede
verificar:

1. **Parseo de categorías y productos** (`getCategorias`, `getProductos` en
   `server/src/cofibaClient.js`): la extracción de nombre/referencia/precio
   se basa en el texto visible que vimos navegando manualmente; puede que
   haga falta ajustar los selectores una vez se vea con datos reales.
2. **Añadir/editar/eliminar/vaciar carrito y finalizar pedido**
   (`anadirAlCarrito`, `actualizarCantidadCarrito`, `eliminarDelCarrito`,
   `vaciarCarrito`, `finalizarPedido`): todo implementado siguiendo el mismo
   patrón — busca dinámicamente el `<form>`/botón real de cofiba.es y, si no
   lo encuentra, devuelve `CALIBRATION_NEEDED` en vez de fallar en silencio.
   "Finalizar pedido" genera un pedido **real y vinculante** en la cuenta del
   cliente, así que el frontend pide confirmación explícita antes de
   llamarlo.

**Cómo desbloquear esto**: entra tú con tu cuenta real (en el navegador
normal, no hace falta dármela a mí) a `/acceso.html`, a una categoría y a
`/mi-compra.html`, y dime qué ves mal en la app (categoría vacía, precio mal
leído, etc.) — con eso ajusto los selectores exactos en
`server/src/cofibaClient.js`.
