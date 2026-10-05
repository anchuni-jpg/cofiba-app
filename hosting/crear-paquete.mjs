// Crea el paquete para subir la app a cualquier hosting con Node.js:
//   node hosting/crear-paquete.mjs
// Resultado: hosting/salida/cofiba-hosting.zip (y la carpeta sin comprimir).
// No incluye NUNCA la carpeta de datos (server/.data): tiene las
// credenciales cifradas y su clave.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.join(raiz, 'hosting', 'salida');
const destino = path.join(salida, 'cofiba-hosting');
const zip = path.join(salida, 'cofiba-hosting.zip');

const ejecutar = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', shell: true });
const copiar = (de, a) => fs.cpSync(path.join(raiz, de), path.join(destino, a ?? de), { recursive: true });

console.log('1/4 Compilando la app del móvil…');
ejecutar('npm run build', path.join(raiz, 'client'));

console.log('2/4 Copiando archivos…');
fs.rmSync(salida, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
copiar('client/dist');
copiar('server/src');
copiar('server/catalog-seed');
copiar('server/package.json');
for (const f of fs.readdirSync(path.join(raiz, 'hosting', 'plantillas'))) copiar(path.join('hosting', 'plantillas', f), f);

const servidor = JSON.parse(fs.readFileSync(path.join(raiz, 'server', 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(destino, 'package.json'),
  JSON.stringify(
    {
      name: 'cofiba-visor',
      version: servidor.version,
      private: true,
      description: 'App Cofiba (visor de pedidos) lista para hosting con Node.js',
      main: 'app.cjs',
      engines: { node: '>=20' },
      scripts: { start: 'node server/src/index.js' },
      dependencies: servidor.dependencies,
    },
    null,
    2
  ) + '\n'
);

console.log('3/4 Fijando versiones exactas de las dependencias…');
ejecutar('npm install --package-lock-only --omit=dev --no-audit --no-fund', destino);

console.log('4/4 Comprimiendo…');
if (process.platform === 'win32') {
  ejecutar(`powershell -NoProfile -Command "Compress-Archive -Path '${destino}\\*' -DestinationPath '${zip}' -Force"`);
} else {
  ejecutar(`cd "${destino}" && zip -qr "${zip}" .`);
}
const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`\nListo: ${zip} (${mb} MB)`);
