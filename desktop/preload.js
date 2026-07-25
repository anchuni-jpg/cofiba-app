const { contextBridge, ipcRenderer } = require('electron');

// El renderer corre con contextIsolation activado (más seguro) — no tiene
// acceso directo a Node/fs. Esto le abre un puente estrecho y concreto solo
// para leer/guardar la configuración local (URL del servidor + token), que
// vive en main.js. Las llamadas a la API del panel las hace el renderer
// directo por fetch(), sin pasar por aquí — el servidor ya admite CORS.
contextBridge.exposeInMainWorld('cofibaPanel', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getDatos: () => ipcRenderer.invoke('datos:get'),
  guardarDatos: (datos) => ipcRenderer.invoke('datos:guardar', datos),
});
