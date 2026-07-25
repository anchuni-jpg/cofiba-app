const INTERVALO_MS = 45 * 1000; // dentro de la horquilla de 30-60s pedida
// Valores ya rellenados en el formulario de la primera vez — así, si son
// correctos, basta con pulsar "Conectar" sin tener que escribir ni pegar
// nada. Cambia esto si generas un ADMIN_TOKEN distinto en Render.
const URL_SUGERIDA = 'https://cofiba-visor.onrender.com';
const TOKEN_SUGERIDO = 'fc26dfbf20e90d8addd47b17703fe77cb59ab37b8bf47459';

let config = null;
let temporizador = null;
// Lo acumulado localmente (ver main.js#DATOS_PATH) — sobrevive a que el
// servidor gratuito se reinicie y olvide lo que tenía en memoria, y deja
// que el panel arranque ya con datos sin esperar a la primera respuesta.
// Cada respuesta nueva del servidor se FUSIONA aquí encima, nunca lo
// sustituye entero.
let acumulado = null;

const el = (id) => document.getElementById(id);

function acumuladoVacio() {
  return { pedidos: [], cuentasVistas: {}, masComprados: {}, ultimaActualizacion: null };
}

function formatoEuro(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatoFecha(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function mostrarPantalla(nombre) {
  el('setup').hidden = nombre !== 'setup';
  el('panel').hidden = nombre !== 'panel';
}

async function cargarConfigInicial() {
  config = await window.cofibaPanel.getConfig();
  acumulado = (await window.cofibaPanel.getDatos()) || acumuladoVacio();

  if (config?.url && config?.token) {
    mostrarPantalla('panel');
    // Pinta ya con lo que hubiera guardado de antes, sin esperar a que
    // responda el servidor — si nunca se guardó nada, sale todo en "—"
    // hasta el primer sondeo, que llega enseguida (iniciarPolling llama a
    // actualizar() de inmediato).
    if (acumulado.ultimaActualizacion) render(null);
    iniciarPolling();
  } else {
    el('campo-url').value = config?.url || URL_SUGERIDA;
    el('campo-token').value = config?.token || TOKEN_SUGERIDO;
    mostrarPantalla('setup');
  }
}

async function probarConexion(url, token) {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/admin/estado`, {
    headers: { 'x-admin-token': token },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `El servidor respondió ${res.status}`);
  }
  return res.json();
}

el('btn-guardar').addEventListener('click', async () => {
  const url = el('campo-url').value.trim();
  const token = el('campo-token').value.trim();
  const errorEl = el('setup-error');
  errorEl.hidden = true;
  if (!url || !token) {
    errorEl.textContent = 'Rellena la URL del servidor y el token.';
    errorEl.hidden = false;
    return;
  }
  el('btn-guardar').disabled = true;
  el('btn-guardar').textContent = 'Conectando…';
  try {
    await probarConexion(url, token);
    config = { url, token };
    await window.cofibaPanel.saveConfig(config);
    mostrarPantalla('panel');
    iniciarPolling();
  } catch (e) {
    errorEl.textContent = `No se pudo conectar: ${e.message}`;
    errorEl.hidden = false;
  } finally {
    el('btn-guardar').disabled = false;
    el('btn-guardar').textContent = 'Conectar';
  }
});

el('btn-ajustes').addEventListener('click', () => {
  clearInterval(temporizador);
  el('campo-url').value = config?.url || '';
  el('campo-token').value = config?.token || '';
  mostrarPantalla('setup');
});

el('btn-refrescar').addEventListener('click', () => actualizar());

function iniciarPolling() {
  actualizar();
  clearInterval(temporizador);
  temporizador = setInterval(actualizar, INTERVALO_MS);
}

async function actualizar() {
  if (!config) return;
  try {
    const datos = await probarConexion(config.url, config.token);
    el('aviso-error').hidden = true;
    fusionar(datos);
    render(datos);
    el('ultima-actualizacion').textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
  } catch (e) {
    el('aviso-error').textContent = `Fallo actualizando: ${e.message}`;
    el('aviso-error').hidden = false;
  }
}

// Añade lo que traiga esta respuesta del servidor a lo ya acumulado en
// local (nunca lo sustituye) y lo guarda en el fichero de la carpeta del
// programa — así, aunque el servidor gratuito se reinicie y pierda su
// memoria, lo que ya se vio aquí no desaparece.
function fusionar(d) {
  if (!acumulado) acumulado = acumuladoVacio();

  const clavePedido = (p) => `${p.usuario}|${p.fecha}`;
  const yaVistos = new Set(acumulado.pedidos.map(clavePedido));
  const pedidosNuevos = (d.facturacion?.total?.pedidos || []).filter((p) => !yaVistos.has(clavePedido(p)));
  acumulado.pedidos = [...acumulado.pedidos, ...pedidosNuevos].sort((a, b) => b.fecha - a.fecha).slice(0, 5000);

  for (const s of d.sesiones || []) {
    const actual = acumulado.cuentasVistas[s.usuario];
    acumulado.cuentasVistas[s.usuario] = {
      primeraVez: actual ? Math.min(actual.primeraVez, s.desde) : s.desde,
      ultimaVez: actual ? Math.max(actual.ultimaVez, s.ultimaActividad) : s.ultimaActividad,
    };
  }

  for (const p of d.masCompradosGlobal || []) {
    const actual = acumulado.masComprados[p.articulo];
    if (!actual || p.veces >= actual.veces) acumulado.masComprados[p.articulo] = p;
  }

  acumulado.ultimaActualizacion = Date.now();
  window.cofibaPanel.guardarDatos(acumulado);
}

function calcularFacturacion(pedidos, desde) {
  const lista = desde ? pedidos.filter((p) => p.fecha >= desde) : pedidos;
  const totalImporte = lista.reduce((acc, p) => acc + (Number.isFinite(p.total) ? p.total : 0), 0);
  return { totalPedidos: lista.length, totalImporte: Math.round(totalImporte * 100) / 100 };
}

// `d` es la última respuesta EN VIVO del servidor, o null si todavía no ha
// llegado ninguna (arranque con solo lo acumulado en local). Lo que es
// inherentemente "ahora mismo" (quién está conectado, estado del índice)
// solo sale cuando hay `d`; lo demás (pedidos, facturación, más comprados)
// sale siempre de `acumulado`, que ya está disponible desde el arranque.
function render(d) {
  const ahora = Date.now();
  const pedidos = acumulado.pedidos;
  const factTotal = calcularFacturacion(pedidos, 0);
  const fact30 = calcularFacturacion(pedidos, ahora - 30 * 24 * 60 * 60 * 1000);
  const fact7 = calcularFacturacion(pedidos, ahora - 7 * 24 * 60 * 60 * 1000);

  el('n-conectadas').textContent = d ? d.cuentasConectadasAhora : '—';
  el('n-cuentas').textContent = d ? d.cuentasTotales : Object.keys(acumulado.cuentasVistas).length;
  el('n-fact-total').textContent = formatoEuro(factTotal.totalImporte);
  el('n-fact-30').textContent = formatoEuro(fact30.totalImporte);
  el('n-fact-7').textContent = formatoEuro(fact7.totalImporte);

  el('tabla-sesiones').innerHTML = d
    ? (d.sesiones || [])
        .map(
          (s) => `
      <tr>
        <td><span class="punto ${s.conectadoAhora ? 'on' : 'off'}"></span></td>
        <td>${escapeHtml(s.usuario)}</td>
        <td>${formatoFecha(s.desde)}</td>
        <td>${formatoFecha(s.ultimaActividad)}</td>
      </tr>`
        )
        .join('') || '<tr><td colspan="4" class="muted">Sin sesiones activas todavía.</td></tr>'
    : '<tr><td colspan="4" class="muted">Conectando con el servidor…</td></tr>';

  el('tabla-pedidos').innerHTML = pedidos.length
    ? pedidos
        .slice(0, 30)
        .map(
          (p) => `
      <tr>
        <td>${formatoFecha(p.fecha)}</td>
        <td>${escapeHtml(p.usuario)}</td>
        <td>${formatoEuro(p.total)}</td>
        <td>${p.numProductos ?? '—'}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="muted">Sin pedidos registrados todavía.</td></tr>';

  const masComprados = Object.values(acumulado.masComprados).sort((a, b) => b.veces - a.veces);
  el('lista-mas-comprados').innerHTML = masComprados.length
    ? masComprados
        .slice(0, 15)
        .map(
          (p) => `
      <div class="fila-producto">
        <span class="nombre">${escapeHtml(p.nombre || p.referencia || p.articulo)}</span>
        <span class="veces">${p.veces}×</span>
      </div>`
        )
        .join('')
    : '<p class="muted">Todavía no hay datos suficientes.</p>';

  el('tabla-cuentas').innerHTML = d
    ? (d.porCuenta || [])
        .map(
          (c) => `
      <tr>
        <td>${escapeHtml(c.usuario)}</td>
        <td>${c.articulosDistintos}</td>
        <td>${c.completo ? 'Completo' : 'En curso…'}</td>
      </tr>`
        )
        .join('') || '<tr><td colspan="3" class="muted">Sin datos todavía.</td></tr>'
    : '<tr><td colspan="3" class="muted">Conectando con el servidor…</td></tr>';

  if (d) {
    const idx = d.indiceCatalogo || {};
    el('estado-indice').textContent =
      `Estado: ${idx.estado || '—'} · ${idx.total || 0} artículos indexados` +
      (idx.actualizado ? ` · actualizado ${formatoFecha(idx.actualizado)}` : '');
  } else {
    el('estado-indice').textContent = 'Conectando con el servidor…';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

cargarConfigInicial();
