import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLoggedIn, expiredNotice }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(usuario, password);
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="content" style={{ paddingTop: 40 }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <img src="/logo/cofiba-logo.jpg" alt="Cofiba" style={{ height: 64 }} />
      </div>
      <p style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>Acceso clientes</p>
      <p className="muted" style={{ marginBottom: 8 }}>
        Usa el mismo usuario y contraseña que en cofiba.es.
      </p>
      <p className="muted" style={{ marginBottom: 20 }}>
        Al principio puede ir un poco más lenta mientras carga tu catálogo — es normal,
        va mejorando sola cuanto más la usas.
      </p>
      {expiredNotice && !error && (
        <div className="install-banner">Tu sesión caducó (el servidor se reinició) — vuelve a entrar.</div>
      )}
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <label className="muted">Usuario / correo</label>
        <input
          type="text"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          style={{ margin: '4px 0 12px' }}
          autoComplete="username"
        />
        <label className="muted">Contraseña</label>
        <div style={{ position: 'relative', margin: '4px 0 20px' }}>
          <input
            type={verPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setVerPassword((v) => !v)}
            aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
            style={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              border: 'none',
              background: 'none',
              padding: '4px 8px',
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            {verPassword ? 'Ocultar' : 'Ver'}
          </button>
        </div>
        <button className="primary" type="submit" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Accediendo…' : 'Acceder'}
        </button>
      </form>
    </div>
  );
}
