# Cómo subir la app Cofiba a tu hosting

Este paquete sirve para **cualquier hosting que pueda ejecutar Node.js 20 o superior**.
Busca tu caso abajo (A, B, C o D) y sigue solo esos pasos.

> ⚠️ **No sirve** un hosting que solo admite PHP/WordPress (el "hosting web normal"
> más barato). La app necesita un pequeño programa (Node.js) que hable con cofiba.es.
> Si en tu panel no aparece ninguna opción de "Node.js", pide a tu proveedor que te
> lo active o usa otra opción de esta guía.

## Qué hay en el paquete

| Archivo / carpeta | Para qué es |
|---|---|
| `client/dist/` | La app que se ve en el móvil (ya preparada). |
| `server/` | El programa que habla con cofiba.es. |
| `package.json` / `package-lock.json` | La lista de piezas que necesita (se instalan solas). |
| `app.cjs` | Archivo de arranque para paneles que lo piden. |
| `.env.ejemplo` | Ejemplo de configuración. |
| `Dockerfile` | Para hostings con Docker. |
| `ecosystem.config.cjs`, `nginx-ejemplo.conf` | Para un servidor propio (VPS). |

**Datos que se piden en cualquier hosting:**

- **Versión de Node.js:** 20 o superior.
- **Comando de instalación:** `npm install --omit=dev`
- **Comando de arranque:** `npm start` (o archivo de inicio `app.cjs`).
- **Variables:** ver `.env.ejemplo` (normalmente basta con `NODE_ENV=production`).

---

## A) Hosting con panel cPanel / Plesk / Hostinger ("Node.js App")

1. Entra en el panel y busca **"Setup Node.js App"**, **"Node.js"** o **"Aplicación Node.js"**.
2. Pulsa **Crear aplicación** y rellena:
   - **Versión de Node.js:** 20 (o la más alta que haya).
   - **Modo:** Production.
   - **Carpeta de la aplicación (Application root):** por ejemplo `cofiba`.
   - **Dirección (Application URL):** tu dominio o subdominio (p. ej. `pedidos.tudominio.com`).
   - **Archivo de inicio (Startup file):** `app.cjs`
3. Guarda. Ve al **Administrador de archivos**, entra en la carpeta `cofiba`, sube el
   ZIP y **descomprímelo ahí** (que `package.json` quede directamente dentro de `cofiba`).
4. Vuelve a la app Node.js en el panel y pulsa **"Run NPM Install"** (Instalar dependencias).
5. En **Variables de entorno** añade `NODE_ENV` = `production`.
6. Pulsa **Reiniciar / Restart**.
7. Activa el **certificado SSL gratuito** (Let's Encrypt / AutoSSL) para ese dominio.
   Es imprescindible: sin HTTPS no funcionan la cámara ni "añadir a la pantalla de inicio".
8. Abre `https://tu-dominio` en el móvil. ¡Listo!

## B) Plataformas en la nube (Railway, Render, Koyeb, Fly.io…)

La forma más sencilla es subir esta carpeta a un repositorio de GitHub y conectarlo,
o usar su opción de subir una carpeta.

- Si detectan el **`Dockerfile`**, lo usan solas: no hay que configurar nada más.
- Si no usan Docker:
  - **Comando de instalación:** `npm install --omit=dev`
  - **Comando de arranque:** `npm start`
  - **Variable:** `NODE_ENV=production`
- **Importante:** añade un **disco/volumen persistente** montado en `/data` y la
  variable `DATA_DIR=/data`. Si no, cada reinicio borra los datos guardados y hay que
  volver a iniciar sesión y releer el catálogo (la app sigue funcionando, solo tarda
  más esa primera vez).
- El HTTPS lo ponen ellos automáticamente.

## C) Servidor propio (VPS con Ubuntu/Debian)

```bash
# 1. Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx

# 2. Subir el ZIP (por SFTP) a /opt/cofiba y descomprimir
sudo mkdir -p /opt/cofiba && cd /opt/cofiba
sudo unzip ~/cofiba-hosting.zip -d /opt/cofiba

# 3. Instalar y configurar
sudo npm install --omit=dev
sudo cp .env.ejemplo .env      # y edítalo si quieres cambiar algo

# 4. Dejarla siempre encendida
sudo npm install -g pm2
sudo pm2 start ecosystem.config.cjs
sudo pm2 save && sudo pm2 startup

# 5. Nginx + HTTPS gratis (cambia tudominio.com dentro del archivo)
sudo cp nginx-ejemplo.conf /etc/nginx/sites-available/cofiba
sudo ln -s /etc/nginx/sites-available/cofiba /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com
```

## D) Cualquier sitio con Docker

```bash
docker build -t cofiba .
docker run -d --name cofiba --restart unless-stopped -p 4000:4000 -v cofiba-datos:/data cofiba
```

Luego pon delante tu dominio con HTTPS (Nginx + Certbot como en C, Caddy, o el
proxy de tu panel).

---

## Comprobar que funciona

- Abre `https://tu-dominio/api/health` → debe salir `{"ok":true}`.
- Abre `https://tu-dominio` → sale la pantalla de inicio de sesión de la app.

## Actualizar a una versión nueva

Sube el ZIP nuevo **encima** (sobrescribiendo), vuelve a pulsar *Instalar
dependencias* / `npm install --omit=dev` y **reinicia** la app.
Los datos guardados (carpeta `server/.data` o la de `DATA_DIR`) **no se tocan**.

## Problemas frecuentes

- **"Cannot find module…"** → falta el paso de instalar dependencias (`npm install`).
- **Página en blanco o error 503** → la app no ha arrancado: revisa que la versión de
  Node.js sea 20 o más y mira el registro (log) de errores en el panel.
- **La cámara del escáner no se abre** → la web no está en HTTPS (falta el certificado SSL).
- **Hay que iniciar sesión cada dos por tres** → el hosting borra los archivos: configura
  `DATA_DIR` hacia un disco persistente (ver B).
- **Seguridad:** la carpeta de datos guarda, cifradas, las credenciales de cofiba.es de
  quien inicia sesión. No la compartas ni la subas a sitios públicos.
