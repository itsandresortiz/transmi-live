import type { RouteShape } from "@transmi/domain";
import { shapeStops } from "./eta";
import type { TransitState } from "./transit-state";

/**
 * Deja listo, de a poco, lo que el primer lote de buses necesita de cada recorrido (dónde queda cada parada sobre su trazado).
 *
 * Sin esto, ese cálculo para los ~1.300 recorridos se hacía todo junto al llegar el primer lote (~100 ms en un computador, bastante más en
 * un teléfono modesto) y la app se quedaba congelada un momento justo al abrir. Aquí se reparte en trozos de `sliceMs` milisegundos que
 * `schedule` pone uno detrás de otro (p. ej. con `setTimeout`), dejando pintar y responder entre trozos. El resultado es el mismo (se guarda
 * en la misma memoria que usa `shapeStops`); si el primer lote llega antes de terminar, lo que falte se calcula en ese momento, como antes.
 * Si cambia la red mientras tanto, se deja de trabajar en la vieja. Devuelve una función para detenerlo.
 */
export function prepareNetworkInSlices(state: TransitState, schedule: (next: () => void) => void, sliceMs = 6, clock: () => number = () => Date.now()): () => void {
  const net = state.network;
  const list: RouteShape[] = [];
  for (const shapes of net.shapes.values()) list.push(...shapes);
  let i = 0, stopped = false;
  const step = (): void => {
    if (stopped || state.network !== net) return;
    const end = clock() + sliceMs;
    do shapeStops(state, list[i++]!); while (i < list.length && clock() < end);
    if (i < list.length) schedule(step);
  };
  if (list.length) schedule(step);
  return () => { stopped = true; };
}
