import { useEffect } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { upcomingAtStop } from "@transmi/application";
import { transit } from "./composition-root";
import { nowSec } from "./clock";
import { useBusWatch } from "./busWatch";
import { cancelComing, comingRang, onComingTap, scheduleComing } from "./notify";
import { stopText } from "./stopname";

/** Lleva al día el aviso de «Avísame cuando venga»: con cada dato nuevo del bus recalcula su llegada y corre el aviso.
 *  Con la app cerrada suena a la última hora calculada (aproximada). Se quita solo cuando el bus pasa o cuando ya sonó. */
export function BusWatcher() {
  useEffect(() => onComingTap((stopId, routeId) => { useBusWatch.getState().clear(); router.push({ pathname: "/stop/[id]", params: { id: stopId, route: routeId } }); }), []);
  useEffect(() => {
    const tick = () => {
      const w = useBusWatch.getState().w;
      if (!w || AppState.currentState !== "active") return;
      const now = nowSec();
      const family = new Set(transit.routeFamily(w.routeId));
      const rows = upcomingAtStop(transit, w.stopId, now, 6).filter((r) => family.has(r.route.id));
      const bus = rows.flatMap((r) => r.buses.map((b) => ({ ...b, row: r }))).find((b) => b.vehicle.id === w.busId);
      if (!bus) {
        // el bus sigue en la calle pero ya no viene hacia la parada: ya pasó (el dato llega ~1 min tarde); se quita el aviso para que no
        // suene después. Si dejó de reportar, queda la última hora calculada. Si ya sonó, o pasó mucho rato, se termina.
        if (comingRang() || transit.fleet.get(w.busId) || now - w.since > 3 * 3600) { useBusWatch.getState().clear(); void cancelComing(); }
        return;
      }
      const name = bus.row.route.shortName, stop = stopText(transit.stopById(w.stopId), "tu parada");
      const at = bus.etaAt - w.minutes * 60;
      void scheduleComing(at, `Ya viene el ${name}`, `Llega en unos ${w.minutes} min a ${stop}${bus.row.headsign ? `. Va hacia ${bus.row.headsign}` : ""}.`, w.stopId, w.routeId);
    };
    tick();
    const id = setInterval(tick, 10_000);
    const unsub = transit.subscribe(tick);
    return () => { clearInterval(id); unsub(); };
  }, []);
  return null;
}
