# Cofiba Panel

Programa de escritorio (Windows) para seguir el uso de "Cofiba · Visor de
pedidos": cuentas conectadas, qué se compra más entre todas ellas, lo
facturado a través de la app y el estado del índice del catálogo. Se
conecta al mismo servidor ya desplegado en Render — no necesita nada más
instalado.

## Primer uso

1. En Render, añade una variable de entorno `ADMIN_TOKEN` al servicio
   `cofiba-visor` con un valor secreto (cualquier cadena larga aleatoria).
2. Abre el panel (`npm start` en desarrollo, o el instalador una vez
   generado) y, la primera vez, escribe:
   - **URL del servidor**: `https://cofiba-visor.onrender.com`
   - **Token de administrador**: el mismo valor que pusiste en `ADMIN_TOKEN`
3. El panel se actualiza solo cada 45 segundos; el botón ⟳ fuerza una
   actualización inmediata, y el botón ⚙ permite cambiar la URL/token.

## Desarrollo

```bash
npm install
npm start
```

## Generar el instalador de Windows

```bash
npm run dist
```

El `.exe` instalable queda en `dist/`.
