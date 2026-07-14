// Todas las peticiones relacionadas con /consumo.html para una misma cuenta
// (tanto las de "Histórico" en index.js como las del rastreo en segundo
// plano de compradosStore.js) tienen que ir de una en una: probado que si
// cofiba.es recibe dos peticiones concurrentes a esa página para la misma
// cuenta, entra en una carrera interna y una de las dos vuelve con menos
// productos de los que hay en realidad (o ninguno). Esta cola por usuario
// asegura que nunca se solapen, aunque vengan de partes distintas del código.
const colas = new Map(); // usuario -> Promise (cola encadenada)

export function encolarConsumo(usuario, tarea) {
  const anterior = colas.get(usuario) || Promise.resolve();
  const actual = anterior.then(tarea, tarea);
  // Lo que se guarda como cola es una versión que nunca rechaza — si no, un
  // fallo puntual dejaría la cola rota para siempre y todo lo que viniera
  // detrás para ese usuario se quedaría esperando una promesa ya rechazada.
  colas.set(usuario, actual.catch(() => {}));
  return actual;
}
