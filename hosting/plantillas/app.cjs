// Archivo de arranque para paneles de hosting que piden un "archivo de
// inicio" (cPanel / Plesk "Node.js App", Passenger, Hostinger...).
// Simplemente arranca el servidor de la app.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
import('./server/src/index.js').catch((e) => {
  console.error('No se pudo arrancar la app:', e);
  process.exit(1);
});
