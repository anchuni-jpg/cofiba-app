import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro del service worker se hace a mano en main.jsx (con
      // virtual:pwa-register), para poder recargar la página en cuanto el
      // SW nuevo toma el control — si esto se deja en 'auto', el plugin
      // además inyecta su propio script de registro por su cuenta y
      // acaban registrándose dos veces.
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      workbox: {
        runtimeCaching: [
          {
            // Fotos de producto: vienen directas de cofiba.es (BlobData/*.dat),
            // no de nuestro servidor, y no cambian una vez subidas — se
            // guardan en el propio dispositivo del usuario (Cache Storage del
            // navegador, vía el service worker de esta PWA) para que, una vez
            // vistas, se sirvan de ahí sin volver a pedirlas cada vez. No hace
            // falta "instalar" la app para esto: el service worker se activa
            // igual con solo abrir la web.
            urlPattern: /^https:\/\/www\.cofiba\.es\/BlobData\/.*\.dat$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cofiba-fotos-producto',
              expiration: {
                maxEntries: 3000,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 días
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Cofiba Visor de Pedidos',
        short_name: 'Cofiba',
        description: 'Visor ágil para consultar el catálogo y hacer pedidos a Cofiba Distribuciones.',
        theme_color: '#20944b',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // escucha en la red local (0.0.0.0), no solo localhost, para poder abrirlo desde el móvil por WiFi
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
