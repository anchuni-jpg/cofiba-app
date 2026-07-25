const INTERVALO_MS = 45 * 1000; // dentro de la horquilla de 30-60s pedida
// Valores ya rellenados en el formulario de la primera vez — así, si son
// correctos, basta con pulsar "Conectar" sin tener que escribir ni pegar
// nada. Cambia esto si generas un ADMIN_TOKEN distinto en Render.
const URL_SUGERIDA = 'https://cofiba-visor.onrender.com';
const TOKEN_SUGERIDO = 'fc26dfbf20e90d8addd47b17703fe77cb59ab37b8bf47459';

let config = null;
let temporizador = null;

const el = (id) => document.getElementById(id);

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
  if (config?.url && config?.token) {
    mostrarPantalla('panel');
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
    render(datos);
    el('ultima-actualizacion').textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES')}`;
  } catch (e) {
    el('aviso-error').textContent = `Fallo actualizando: ${e.message}`;
    el('aviso-error').hidden = false;
  }
}

function render(d) {
  el('n-conectadas').textContent = d.cuentasConectadasAhora;
  el('n-cuentas').textContent = d.cuentasTotales;
  el('n-fact-total').textContent = formatoEuro(d.facturacion?.total?.totalImporte);
  el('n-fact-30').textContent = formatoEuro(d.facturacion?.ultimos30Dias?.totalImporte);
  el('n-fact-7').textContent = formatoEuro(d.facturacion?.ultimos7Dias?.totalImporte);

  el('tabla-sesiones').innerHTML = (d.sesiones || [])
    .map(
      (s) => `
      <tr>
        <td><span class="punto ${s.conectadoAhora ? 'on' : 'off'}"></span></td>
        <td>${escapeHtml(s.usuario)}</td>
        <td>${formatoFecha(s.desde)}</td>
        <td>${formatoFecha(s.ultimaActividad)}</td>
      </tr>`
    )
    .join('') || '<tr><td colspan="4" class="muted">Sin sesiones activas todavía.</td></tr>';

  const pedidos = d.facturacion?.ultimos30Dias?.pedidos || [];
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
    : '<tr><td colspan="4" class="muted">Sin pedidos registrados en los últimos 30 días.</td></tr>';

  el('lista-mas-comprados').innerHTML = (d.masCompradosGlobal || []).length
    ? d.masCompradosGlobal
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

  el('tabla-cuentas').innerHTML = (d.porCuenta || []).length
    ? d.porCuenta
        .map(
          (c) => `
      <tr>
        <td>${escapeHtml(c.usuario)}</td>
        <td>${c.articulosDistintos}</td>
        <td>${c.completo ? 'Completo' : 'En curso…'}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="muted">Sin datos todavía.</td></tr>';

  const idx = d.indiceCatalogo || {};
  el('estado-indice').textContent =
    `Estado: ${idx.estado || '—'} · ${idx.total || 0} artículos indexados` +
    (idx.actualizado ? ` · actualizado ${formatoFecha(idx.actualizado)}` : '');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

cargarConfigInicial();
