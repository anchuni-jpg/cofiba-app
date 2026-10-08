import { useEffect, useState } from 'react';

// Cabecera de un listado (Catálogo, Búsqueda) que se queda pegada bajo la
// barra de arriba, se esconde al bajar y solo vuelve a aparecer tras SUBIR
// un buen trecho seguido — para que no salte con cualquier roce del dedo.
const BAJAR_PARA_ESCONDER = 40;
const SUBIR_PARA_MOSTRAR = 540;

export default function useCabeceraFlotante() {
  const [oculta, setOculta] = useState(false);
  const [altoTopbar, setAltoTopbar] = useState(0);
  useEffect(() => {
    const medir = () => setAltoTopbar(document.querySelector('.topbar')?.offsetHeight || 0);
    medir();
    window.addEventListener('resize', medir);
    let ultimoY = window.scrollY;
    let bajado = 0;
    let subido = 0;
    function alDesplazar() {
      const y = window.scrollY;
      const d = y - ultimoY;
      ultimoY = y;
      if (document.querySelector('.ficha-overlay')) return; // la ficha mueve el fondo sola
      if (y < 80) {
        bajado = subido = 0;
        setOculta(false);
      } else if (d > 0) {
        subido = 0;
        bajado += d;
        if (bajado > BAJAR_PARA_ESCONDER) setOculta(true);
      } else if (d < 0) {
        bajado = 0;
        subido -= d;
        if (subido > SUBIR_PARA_MOSTRAR) setOculta(false);
      }
    }
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', alDesplazar);
    };
  }, []);
  return { oculta, altoTopbar };
}
