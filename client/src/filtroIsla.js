// Filtro global de isla: se activa desde Categorías y afecta por igual a
// Productos, Búsqueda e Histórico. cofiba.es no separa su catálogo por isla
// (es un único catálogo balear) — se detecta mirando el propio nombre del
// producto, que casi siempre ya incluye "MALLORCA"/"MCA" (abreviatura vista
// en muchos artículos), "IBIZA" o "FORMENTERA".
// El icono de cada una es una silueta propia (ver components/IslaIcon.jsx),
// no un emoji — no existe un emoji distinto por isla balear.
export const ISLAS = [
  { valor: 'mallorca', nombre: 'Mallorca' },
  { valor: 'ibiza', nombre: 'Ibiza' },
  { valor: 'formentera', nombre: 'Formentera' },
];

const PATRONES = {
  mallorca: /\bMALLORCA\b|\bMCA\b/i,
  ibiza: /\bIBIZA\b|\bEIVISSA\b/i,
  formentera: /\bFORMENTERA\b/i,
};

// Un producto se oculta SOLO si su nombre menciona claramente OTRA isla
// distinta de la activa. Los productos sin ninguna isla en el nombre
// (la mayoría del catálogo: cremas solares, menaje, papelería...) siguen
// apareciendo siempre — no hay base para asignarlos a ninguna isla en
// concreto, así que esconderlos perdería catálogo real sin motivo.
export function filtrarPorIsla(productos, isla) {
  if (!isla) return productos;
  return productos.filter((p) => {
    const nombre = p.nombre || '';
    return !Object.entries(PATRONES).some(([otraIsla, patron]) => otraIsla !== isla && patron.test(nombre));
  });
}
