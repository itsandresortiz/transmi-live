import { useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { type PhoneFix, arrivalAtIndex, checkOnShape, checkRide, rideArrival } from "@transmi/application";
import { isVirtualRide, rideSequence, rideVehicle, virtualParts } from "./virtualRide";
import { clearRideSnap, rideCheckOf, rideSnapOf, setRideCheck } from "./rideSnap";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { cancelAlerts, onAlertTap, schedule } from "./notify";
import { stopText } from "./stopname";
import { useRide } from "./ride";
import { useTrip } from "./trip";
import { endTripActivity, showTripActivity } from "../modules/tripactivity/src";
import { SYSTEM_COLOR } from "./ui/theme";
import { router, usePathname } from "expo-router";
import { useLaunch } from "./ui/Launch";

const TAG = "ride";
const EVERY_MS = 5000;
/** Si el bus deja de reportar este tiempo (con otros buses sí reportando), se da el viaje por terminado. */
const GONE_MS = 10 * 60_000;
/** Vueltas seguidas (de 5 s) con el teléfono lejos del bus, y en movimiento, antes de preguntar si de verdad vas en él (~30 s). */
const DOUBT_TICKS = 6;
let lastAlight: string | null = null;

/** Vigila el viaje en curso mientras la app esté abierta: mantiene la pantalla encendida, vibra y reprograma los avisos con la hora más reciente de llegada. */
export function RideWatcher() {
  const busId = useRide((s) => s.busId), alightId = useRide((s) => s.alightId);

  useEffect(() => {
    if (!busId || !alightId) { void cancelAlerts(); if (!useTrip.getState().it) void endTripActivity(); return; }
    let warned = 99, shown = "", seen = false, missingSince = 0, doubt = 0, asked = false;
    // si se cambió la parada de bajada, los avisos de la anterior ya no sirven
    if (lastAlight && lastAlight !== alightId) void cancelAlerts();
    lastAlight = alightId;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    const finish = () => { void cancelAlerts(); if (!useTrip.getState().it) void endTripActivity(); clearRideSnap(); useRide.getState().clear(); };

    // tu ubicación (solo con la app abierta y si ya diste el permiso): mientras vas en el bus, el bus se dibuja donde vas tú y las paradas
    // y avisos se cuentan desde ahí. No sale del teléfono ni se guarda.
    let sub: Location.LocationSubscription | undefined, gone = false, prevFix: PhoneFix | null = null;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (gone || !perm?.granted) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 }, (p) => {
        const now = nowMs(), fix: PhoneFix = { lat: p.coords.latitude, lon: p.coords.longitude, at: now, accuracy: p.coords.accuracy, speed: p.coords.speed };
        if (isVirtualRide(busId)) {
          // sin bus en los datos: solo se mira que vayas sobre el recorrido (desde la parada en que vienes)
          const vp = virtualParts(busId), seq = vp ? rideSequence(rideVehicle(busId, now)!) : undefined;
          if (vp && seq) setRideCheck(busId, vp.shape, seq.index, checkOnShape(transit, vp.shape, seq.index, fix, now, prevFix), now);
        } else {
          const v = transit.fleet.get(busId), seq = v ? transit.sequenceForDisplay(v) : undefined;
          if (v && seq) setRideCheck(busId, seq.shape, seq.index, checkRide(transit, v, seq.shape, seq.index, fix, now, prevFix), now);
        }
        prevFix = fix;
      }).catch(() => undefined);
      if (gone) sub?.remove();
    })();

    /** Si el teléfono va en movimiento y lejos del bus un buen rato, se pregunta una vez: puede haber marcado otro bus, o ya se bajó. */
    const doubtCheck = (route: string, plate: string, routeId: string) => {
      const c = rideCheckOf(busId);
      if (!c || nowMs() - c.at > 20_000 || c.check.kind === "unknown") return;
      const off = (c.check.kind === "off-route" || c.check.kind === "apart") && c.check.moving;
      doubt = off ? doubt + 1 : c.check.kind === "on" ? 0 : doubt;
      if (asked || doubt < DOUBT_TICKS) return;
      asked = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (c.check.kind === "off-route") {
        Alert.alert("¿Sigues en el bus?", `Tu ubicación está lejos del recorrido del ${route}. Si ya te bajaste, quitamos el aviso.`, [
          { text: "Sigo en el bus", style: "cancel" },
          { text: "Ya me bajé", style: "destructive", onPress: finish },
        ]);
      } else {
        Alert.alert("¿Vas en este bus?", `Tu ubicación no coincide con la del ${route}${plate ? ` (placa ${plate})` : ""}. Puede que vayas en otro bus de la misma ruta.`, [
          { text: "Sí, voy en este", style: "cancel" },
          { text: "Elegir mi bus", onPress: () => { finish(); router.push({ pathname: "/route/[id]", params: { id: routeId } }); } },
        ]);
      }
    };

    const tick = () => {
      const v = rideVehicle(busId), target = transit.stopById(alightId);
      const seq = v ? rideSequence(v) : undefined;
      // el bus dejó de reportar (y otros sí): tras un rato se da por terminado, para no dejar la pantalla encendida y el aviso fijo para siempre
      if (!v) { if (transit.fleet.size > 0) { missingSince ||= Date.now(); if (seen && Date.now() - missingSince > GONE_MS) finish(); } return; }
      missingSince = 0;
      if (!seq || !target) return;
      const ti = seq.shape.stopIds.indexOf(alightId, Math.max(0, seq.index));
      // ya pasó tu parada (p. ej. la app estaba cerrada cuando llegó): el viaje terminó
      if (ti < 0) { if (seen) finish(); return; }
      seen = true;
      const now = nowMs();
      // si vas en el bus y el GPS lo confirma, lo que falta se cuenta desde donde vas tú (el reporte del bus llega ~1 min tarde)
      const mine = rideSnapOf(busId, now);
      const snap = mine && mine.shape === seq.shape ? mine : null;
      const reached = snap ? Math.max(seq.index, snap.nextIndex - 1) : seq.index;
      const left = ti - reached;
      const name = stopText(target, "tu parada");
      const at = (j: number) => (snap ? rideArrival(transit, v, seq.shape, seq.index, snap, j, now) : arrivalAtIndex(transit, v, seq.shape, seq.index, j, now));
      const route = transit.routeOf(v);
      doubtCheck(route?.shortName ? `bus ${route.shortName}` : "bus", v.plate ?? "", v.routeId);

      // vibración y avisos mientras la app está abierta
      if (left <= 0 && warned > 0) { warned = 0; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
      else if (left === 1 && warned > 1) { warned = 1; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
      else if (left === 3 && warned > 3) { warned = 3; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

      // avisos del teléfono (también si la app queda en segundo plano): se programan con la última hora estimada
      const data = { busId, alightId, total: useRide.getState().total };
      if (left >= 3) void schedule("ride-3", at(ti - 3), "Faltan 3 paradas", `Te bajas en ${name}.`, data);
      if (left >= 2) void schedule("ride-1", at(ti - 1), "Prepárate para bajar", `La siguiente parada es ${name}.`, data);
      if (left >= 1) void schedule("ride-0", at(ti) - 20, "Bájate aquí", `Estás llegando a ${name}.`, data);
      // lo mismo en la pantalla de bloqueo y la isla dinámica (si no hay ya un viaje de «Cómo llegar» ocupándola)
      if (!useTrip.getState().it && left > 0) {
        const eta = at(ti), key = `${left}|${Math.round(eta / 20)}`, total = Math.max(useRide.getState().total, left, 1);
        if (key !== shown) {
          shown = key;
          void showTripActivity(name, {
            title: `Vas en el ${route?.shortName ?? "bus"}`, detail: left === 1 ? `La siguiente parada es la tuya: ${name}.` : `Te bajas en ${name}. Faltan ${left} paradas.`,
            badge: route?.shortName ?? "", color: SYSTEM_COLOR[v.system], until: eta, untilLabel: "Te bajas en",
            step: total - left, steps: total, arrive: eta, link: `transmilive:///ride/${busId}`,
          }).then((ok) => { if (!ok && shown === key) shown = ""; });   // si no se pudo mostrar (permiso aún en pantalla), se reintenta
        }
      }
      if (left <= 0) finish();
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { gone = true; sub?.remove(); clearRideSnap(); clearInterval(timer); void deactivateKeepAwake(TAG).catch(() => undefined); };
  }, [busId, alightId]);

  // tocar un aviso abre ese viaje (para ver cuánto falta o quitar el aviso); si la app se había cerrado, se recupera dónde te bajas
  const path = usePathname(), pathRef = useRef(path);
  pathRef.current = path;
  const launched = useLaunch((s) => s.done);
  useEffect(() => {
    if (!launched) return;
    const openTrip = () => { if (pathRef.current !== "/trip") setTimeout(() => router.push("/trip"), 150); };
    return onAlertTap((d) => {
      const ride = useRide.getState();
      if (!ride.busId) ride.set(d.busId, d.alightId, d.total);
      if (pathRef.current !== `/ride/${d.busId}`) setTimeout(() => router.push({ pathname: "/ride/[id]", params: { id: d.busId } }), 150);
    }, openTrip);
  }, [launched]);

  return null;
}
