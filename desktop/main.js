const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Electron no trae de serie ni menú contextual de clic derecho (Cortar/
// Copiar/Pegar) ni, en algunos casos, los atajos Ctrl+C/V/X si no hay
// ningún menú de aplicación registrado — a diferencia de un navegador
// normal. Sin esto, pegar el token largo en el campo era imposible y solo
// quedaba escribirlo a mano. El menú de aplicación se deja registrado
// (para que los atajos de teclado funcionen) pero oculto de la ventana.
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
  ])
);

// Config (URL del servidor + token de administrador) se guarda en el
// perfil del usuario de Windows, fuera de la carpeta del programa — así
// sobrevive a reinstalar/actualizar la app y no queda en texto plano dentro
// de Program Files.
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function leerConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function guardarConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

function crearVentana() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#f4f4f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // El menú de arriba da los atajos de teclado, pero clic derecho seguía sin
  // hacer nada — esto añade el menú contextual de toda la vida
  // (Cortar/Copiar/Pegar/Seleccionar todo) solo sobre campos editables.
  win.webContents.on('context-menu', (_evento, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'cut', label: 'Cortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleccionar todo' },
    ]).popup({ window: win });
  });
}

ipcMain.handle('config:get', () => leerConfig());
ipcMain.handle('config:save', (_evento, config) => {
  guardarConfig(config);
  return true;
});

app.whenReady().then(() => {
  crearVentana();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
