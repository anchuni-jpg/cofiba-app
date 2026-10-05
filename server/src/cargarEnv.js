// Lee la configuración de un archivo `.env` (en la carpeta raíz del
// proyecto o en server/) si existe, sin depender de ningún paquete. Así
// sirve igual en un hosting con panel (donde las variables se ponen en el
// propio panel y este archivo no hace falta) que en un VPS (donde se
// rellena el .env y listo). Lo que ya venga del sistema/panel manda.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const archivo of [path.join(__dirname, '..', '..', '.env'), path.join(__dirname, '..', '.env')]) {
  if (!fs.existsSync(archivo)) continue;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || linea.trim().startsWith('#')) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}
