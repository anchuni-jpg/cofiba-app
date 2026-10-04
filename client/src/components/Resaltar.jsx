// Colorea dentro de `texto` las letras que coinciden con lo buscado, sin
// tener en cuenta acentos, mayúsculas ni signos (igual que el buscador):
// buscar "imán" resalta "IMAN", y "bic azul" resalta las dos palabras
// estén donde estén.
function normalizarLetra(c) {
  const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()[0] || '';
  return /[a-z0-9]/.test(n) ? n : ' ';
}

export default function Resaltar({ texto, termino }) {
  const original = String(texto ?? '');
  const palabras = String(termino || '')
    .split('')
    .map(normalizarLetra)
    .join('')
    .split(' ')
    .filter(Boolean);
  if (!original || !palabras.length) return original;

  const normal = original.split('').map(normalizarLetra).join('');
  const marcado = new Array(original.length).fill(false);
  for (const palabra of palabras) {
    let desde = 0;
    for (;;) {
      const i = normal.indexOf(palabra, desde);
      if (i < 0) break;
      for (let k = i; k < i + palabra.length; k++) marcado[k] = true;
      desde = i + palabra.length;
    }
  }
  if (!marcado.some(Boolean)) return original;

  const trozos = [];
  let inicio = 0;
  for (let i = 1; i <= original.length; i++) {
    if (i === original.length || marcado[i] !== marcado[inicio]) {
      const t = original.slice(inicio, i);
      trozos.push(
        marcado[inicio] ? (
          <mark key={inicio} className="resaltado">
            {t}
          </mark>
        ) : (
          t
        )
      );
      inicio = i;
    }
  }
  return <>{trozos}</>;
}
