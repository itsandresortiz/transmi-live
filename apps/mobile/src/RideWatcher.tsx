import { useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { type PhoneFix, arrivalAtIndex, busForGpsRide, checkOnShape, checkRide, rideActivityState, rideArrival, rideShownArrival } from "@transmi/application";
import { isVirtualRide, linkRide, rideSequence, rideVehicle, virtualParts, virtualRideId } from "./virtualRide";
import { clearRideSnap, rideCheckOf, rideNextStop, rideSnapOf, setRideCheck } from "./rideSnap";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { cancelAlerts, holdRideAlerts, onAlertTap, schedule } from "./notify";
import { endRideServer, rideServerOwns, syncRideServer } from "./rideServer";
import { maybeShareRide } from "./shareRide";
import { stopText } from "./stopname";
import { useRide } from "./ride";
import { useTrip } from "./trip";
import { endTripActivity, showTripActivity } from "../modules/tripactivity/src";
import { SYSTEM_COLOR } from "./ui/theme";
import { router, usePathname } from "expo-router";
import { useLaunch } from "./ui/Launch";
import { useMapFocus } from "./map/focus";

const TAG = "ride";
const EVERY_MS = 5000;
/** Si el bus deja de reportar este tiempo (con otros buses sí reportando), se da el viaje por terminado. */
const GONE_MS = 10 * 60_000;
/** Vueltas seguidas (de 5 s) con el teléfono lejos del bus, y en movimiento, antes de preguntar si de verdad vas en él (~30 s). */
const DOUBT_TICKS = 6;
let lastAlight: string | null = null;

/** Vigila el viaje en curso mientras la app esté abierta: mantiene la pantalla encendida, vibra y reprograma los avisos con la hora más reciente de llegada. */
export function RideWatcher() {
  const busId = useRide((s) => s.busId), alightId = useRide((s) => s.alightId), hydrated = useRide((s) => s.hydrated);

  // vas en un bus pero aún no marcaste dónde te bajas: igual se muestra en la pantalla de bloqueo y la isla dinámica (iPhone) o como
  // notificación fija (Android), con la próxima parada y cuánto falta para llegar a ella
  useEffect(() => {
    if (!busId || alightId) return;
    let shown = "";
    const tick = () => {
      if (useTrip.getState().it) return;                // un viaje de «Cómo llegar» ya ocupa ese espacio
      const now = nowMs(), v = rideVehicle(busId, now);
      if (!v) return;
      const next = rideNextStop(v, now) ?? (() => { const n = transit.nextStopOf(v, now); return n?.arrivalAt != null ? { stopId: n.stopId, stop: n.stop, arrivalAt: n.arrivalAt } : undefined; })();
      if (!next) return;
      const route = transit.routeOf(v), name = stopText(next.stop, "la próxima parada");
      const key = `${next.stopId}|${Math.round(next.arrivalAt / 20)}`;
      if (key === shown) return;
      shown = key;
      // sin destino («Hacia …»): la próxima parada cambia a cada rato y va en el texto (como destino, iPhone se quedaba con la primera)
      void showTripActivity("", {
        title: `Vas en el ${route?.shortName ?? "bus"}`, detail: `Próxima parada: ${name}. Marca dónde te bajas para que te avisemos.`,
        badge: route?.shortName ?? "", color: SYSTEM_COLOR[v.system], until: next.arrivalAt, untilLabel: "Próxima parada",
        step: 0, steps: 0, arrive: next.arrivalAt, link: `transmilive:///ride/${busId}`,
      }).then((ok) => { if (!ok && shown === key) shown = ""; });
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { clearInterval(timer); if (!useTrip.getState().it && !useRide.getState().alightId) void endTripActivity(); };
  }, [busId, alightId]);

  useEffect(() => {
    // antes de leer el viaje guardado, «sin viaje» no quiere decir que terminó: no se le cancelan los avisos
    if (!busId || !alightId) { if (hydrated) { void cancelAlerts(); void endRideServer(); if (!busId && !useTrip.getState().it) void endTripActivity(); } return; }
    let warned = 99, shown = "", seen = false, missingSince = 0, doubt = 0, asked = false, notYet = 0;
    // si se cambió la parada de bajada, los avisos de la anterior ya no sirven
    if (lastAlight && lastAlight !== alightId) void cancelAlerts();
    lastAlight = alightId;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    const finish = () => { void cancelAlerts(); void endRideServer(); if (!useTrip.getState().it) void endTripActivity(); clearRideSnap(); useRide.getState().clear(); };

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
      // (un viaje recuperado de un aviso viejo o de lo guardado, cuyo bus ya no aparece: se termina al minuto, no a los 10)
      if (!v) { if (transit.fleet.size > 0) { missingSince ||= Date.now(); if (Date.now() - missingSince > (seen ? GONE_MS : 60_000)) finish(); } return; }
      missingSince = 0;
      if (!seq || !target) return;
      const ti = seq.shape.stopIds.indexOf(alightId, Math.max(0, seq.index));
      // ya pasó tu parada (p. ej. la app estaba cerrada cuando llegó): el viaje terminó
      // (también si nunca se vio antes de la parada: un viaje recuperado de un aviso viejo, tras 3 vueltas seguidas para no cortar por un dato raro)
      if (ti < 0) { if (seen || ++notYet >= 3) finish(); return; }
      notYet = 0;
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

      // el servidor de avisos (si está encendido; apagado por defecto) recalcula con la app cerrada: se le cuenta el viaje cada ~25 s
      const color = SYSTEM_COLOR[v.system];
      // (un viaje solo con GPS no se puede seguir desde el servidor: al recibirlo, el servidor lo suelta y responde que no avisa)
      void syncRideServer({ busId, alightId, total: useRide.getState().total, route: route?.shortName ?? "", color, stop: name });
      // avisos del teléfono (también si la app queda en segundo plano): se programan con la última hora estimada. Si el servidor se
      // encarga, se quitan los del teléfono (sonarían dos veces); si deja de responder, se vuelven a programar en la vuelta siguiente
      const data = { busId, alightId, total: useRide.getState().total };
      if (rideServerOwns()) void holdRideAlerts();
      else {
        if (left >= 3) void schedule("ride-3", at(ti - 3), "Faltan 3 paradas", `Te bajas en ${name}.`, data);
        if (left >= 2) void schedule("ride-1", at(ti - 1), "Prepárate para bajar", `La siguiente parada es ${name}.`, data);
        if (left >= 1) void schedule("ride-0", at(ti) - 20, "Bájate aquí", `Estás llegando a ${name}.`, data);
      }
      // lo mismo en la pantalla de bloqueo y la isla dinámica (si no hay ya un viaje de «Cómo llegar» ocupándola)
      if (!useTrip.getState().it && left > 0) {
        // en pantalla (bloqueo / isla / aviso fijo) la misma cuenta que en «Voy en este bus»: se detiene en vez de subir
        const eta = rideShownArrival(transit, v, seq.shape, seq.index, snap, ti, now), key = `${left}|${Math.round(eta / 20)}`;
        if (key !== shown) {
          shown = key;
          // mismo texto que manda el servidor de avisos con la app cerrada (`rideActivityState`)
          void showTripActivity(name, rideActivityState({ busId, route: route?.shortName ?? "", color, stop: name, total: useRide.getState().total }, left, eta))
            .then((ok) => { if (!ok && shown === key) shown = ""; });   // si no se pudo mostrar (permiso aún en pantalla), se reintenta
        }
      }
      if (left <= 0) finish();
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { clearInterval(timer); void deactivateKeepAwake(TAG).catch(() => undefined); };
  }, [busId, alightId, hydrated]);

  // tu ubicación mientras vas en un bus, hayas marcado o no dónde te bajas: sin esto, en un viaje con GPS («¿En qué bus vas?») sin parada
  // de bajada el bus se quedaba quieto en la parada de subida y la cuenta de la próxima parada no llegaba nunca a cero
  useEffect(() => {
    if (!busId) return;
    // tu ubicación (solo con la app abierta y si ya diste el permiso): mientras vas en el bus, el bus se dibuja donde vas tú y las paradas
    // y avisos se cuentan desde ahí. No sale del teléfono ni se guarda.
    let sub: Location.LocationSubscription | undefined, gone = false, prevFix: PhoneFix | null = null;
    // un bus de los datos que cuadra contigo: con qué reportes suyos ha cuadrado (se enlaza al cuadrar en dos reportes distintos)
    let cand: { id: string; reports: Set<number> } | null = null;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (gone || !perm?.granted) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 }, (p) => {
        const now = nowMs(), fix: PhoneFix = { lat: p.coords.latitude, lon: p.coords.longitude, at: now, accuracy: p.coords.accuracy, speed: p.coords.speed };
        if (isVirtualRide(busId)) {
          // sin bus en los datos: solo se mira que vayas sobre el recorrido (desde la parada en que vienes)
          const vp = virtualParts(busId), seq = vp ? rideSequence(rideVehicle(busId, now)!) : undefined;
          const check = vp && seq ? checkOnShape(transit, vp.shape, seq.index, fix, now, prevFix) : null;
          if (vp && seq && check) setRideCheck(busId, vp.shape, seq.index, check, now);
          // «Ayudar a mejorar el mapa» (solo con el permiso encendido en Más): por dónde va este bus, sin nada de la persona
          if (vp && check?.kind === "on") maybeShareRide(busId, vp.routeId, vp.shape, check.snap.s, fix.speed);
          // ¿apareció tu bus en los datos? Un bus de tu ruta y sentido que reporta justo donde vas tú, dos veces seguidas: se pasa el viaje
          // a ese bus (con tu parada de bajada y sus avisos), así lo ven también los demás en el mapa y sus datos se suman a los tuyos
          if (vp && check?.kind === "on" && check.moving) {
            const hit = busForGpsRide(transit, vp.shape, check.snap.s, now);
            if (!hit) cand = null;
            else {
              if (cand?.id !== hit.vehicle.id) cand = { id: hit.vehicle.id, reports: new Set() };
              cand.reports.add(hit.vehicle.reportedAt);
              if (cand.reports.size >= 2) {
                const st = useRide.getState(), to = hit.vehicle.id;
                if (st.busId === busId) {
                  linkRide(busId, to);
                  st.set(to, st.alightId, st.total);
                  const f = useMapFocus.getState();
                  if (f.followBusId === busId) f.set({ stopId: f.stopId, routeId: f.routeId, locate: false, followBusId: to, busIds: f.busIds.map((b) => (b === busId ? to : b)) });
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                return;
              }
            }
          }
        } else {
          const v = transit.fleet.get(busId), seq = v ? transit.sequenceForDisplay(v) : undefined;
          const check = v && seq ? checkRide(transit, v, seq.shape, seq.index, fix, now, prevFix) : null;
          if (v && seq && check) setRideCheck(busId, seq.shape, seq.index, check, now);
          if (v && seq && check?.kind === "on") maybeShareRide(busId, seq.shape.routeId, seq.shape, check.snap.s, fix.speed);
        }
        prevFix = fix;
      }).catch(() => undefined);
      if (gone) sub?.remove();
    })();

    // tu bus dejó de reportar (más de 90 s sin dato, o ya no aparece) pero tu ubicación confirmaba que ibas en él: el viaje pasa a seguirte
    // con tu ubicación, con la misma parada de bajada y sus avisos. Antes se quedaba con el último dato del bus («Perdimos la señal»,
    // tiempos aproximados) y a los 10 min el viaje terminaba solo. Si el bus vuelve a reportar, `busForGpsRide` lo enlaza de nuevo.
    const handover = !isVirtualRide(busId) ? setInterval(() => {
      if (AppState.currentState !== "active") return;
      const now = nowMs(), mine = rideSnapOf(busId, now), v = transit.fleet.get(busId);
      if (!mine || (v && now / 1000 - v.reportedAt <= 90)) return;
      const routeId = v?.routeId ?? mine.shape.routeId, si = transit.network.shapes.get(routeId)?.indexOf(mine.shape) ?? -1;
      if (si < 0) return;
      const st = useRide.getState();
      if (st.busId !== busId) return;
      const to = virtualRideId(routeId, si, Math.max(mine.lastIndex, mine.nextIndex - 1));
      linkRide(busId, to);
      st.set(to, st.alightId, st.total);
      const f = useMapFocus.getState();
      if (f.followBusId === busId) f.set({ stopId: f.stopId, routeId: f.routeId, locate: false, followBusId: to, busIds: f.busIds.map((b) => (b === busId ? to : b)) });
    }, EVERY_MS) : undefined;

    return () => { gone = true; sub?.remove(); clearRideSnap(); if (handover) clearInterval(handover); };
  }, [busId]);

  // tocar un aviso abre ese viaje (para ver cuánto falta o quitar el aviso); si la app se había cerrado, se recupera dónde te bajas
  const path = usePathname(), pathRef = useRef(path);
  pathRef.current = path;
  const launched = useLaunch((s) => s.done);
  useEffect(() => {
    if (!launched) return;
    const openTrip = () => { if (pathRef.current !== "/trip") setTimeout(() => router.push("/trip"), 150); };
    return onAlertTap((d) => {
      const ride = useRide.getState();
      // solo se recupera el viaje si el aviso es reciente: tocar horas después un «Bájate aquí» viejo revivía un viaje terminado
      if (!ride.busId && Date.now() - d.firedAt < 15 * 60_000) ride.set(d.busId, d.alightId, d.total);
      if (pathRef.current !== `/ride/${d.busId}`) setTimeout(() => router.push({ pathname: "/ride/[id]", params: { id: d.busId } }), 150);
    }, openTrip);
  }, [launched]);

  return null;
}
