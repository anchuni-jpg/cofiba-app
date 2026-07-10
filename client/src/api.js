const TOKEN_KEY = 'cofiba_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The backend keeps sessions in memory and forgets them whenever it
    // restarts, so a token that looked valid can suddenly 401 mid-session —
    // that must never fail silently, so broadcast it for App.jsx to react to.
    if (res.status === 401 && auth) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('cofiba:session-expired'));
    }
    const err = new Error(data.error || `Error ${res.status}`);
    err.debugHtml = data.debugHtml;
    throw err;
  }
  return data;
}

export const api = {
  async login(usuario, password) {
    const data = await request('/login', { method: 'POST', body: { usuario, password }, auth: false });
    setToken(data.token);
    return data;
  },
  logout() {
    setToken(null);
  },
  categorias() {
    return request('/categorias');
  },
  productos({ categoria, page = 1, q, pageUrl }) {
    const params = new URLSearchParams({
      categoria,
      page: String(page),
      ...(q ? { q } : {}),
      ...(pageUrl ? { pageUrl } : {}),
    });
    return request(`/productos?${params.toString()}`);
  },
  carrito() {
    return request('/carrito');
  },
  anadirAlCarrito({ categoria, articulo, cantidad }) {
    return request('/carrito/item', { method: 'POST', body: { categoria, articulo, cantidad } });
  },
  actualizarCantidadCarrito({ articulo, cantidad }) {
    return request('/carrito/item', { method: 'PUT', body: { articulo, cantidad } });
  },
  eliminarDelCarrito(codigo) {
    return request(`/carrito/item/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
  },
  vaciarCarrito() {
    return request('/carrito/vaciar', { method: 'POST' });
  },
  finalizarPedido(observaciones = '') {
    return request('/carrito/finalizar', { method: 'POST', body: { observaciones } });
  },
  historico() {
    return request('/historico');
  },
};
