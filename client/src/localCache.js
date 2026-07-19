// Caché local en el propio navegador (IndexedDB) para que la app muestre
// datos al instante en visitas repetidas — categorías, productos, búsquedas,
// histórico — mientras se refrescan en segundo plano. Sobre todo útil justo
// después de que el servidor gratuito se reinicie (pierde toda su caché en
// memoria y tarda en reconstruirla): el navegador ya tiene la última foto
// buena guardada y no hace esperar al cliente para verla.
const DB_NAME = 'cofiba-cache';
const STORE = 'respuestas';
const VERSION = 1;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCache(clave) {
  try {
    const db = await abrirDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(clave);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Si IndexedDB no está disponible (modo privado estricto, navegador
    // viejo, etc.) la app sigue funcionando igual, solo sin este atajo.
    return null;
  }
}

export async function setCache(clave, valor) {
  try {
    const db = await abrirDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(valor, clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Un fallo guardando la caché no debe romper la app.
  }
}
