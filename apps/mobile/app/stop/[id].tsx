import { useMemo, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "@/ui/Symbol";
import { alertView, alertsFor, cableInfo, frequencyText, routeAlertViews, routeHasAlert, routesAtStop, siblingStops, upcomingAtStop, type UpcomingBus, type UpcomingRoute } from "@transmi/application";
import { ALERT_EFFECT_LABEL, SYSTEM_LABEL,  routeTitle, stopLabelText, type Route } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs, nowSec } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText, stopsAwayText } from "@/format";
import { clockOfDay, liveDown, downText } from "@/lastService";
import { stopCode, stopKind, stopTag, stopText } from "@/stopname";
import { useSaved } from "@/favorites";
import { useMapFocus } from "@/map/focus";
import { usePlanner } from "@/planner/store";
import { reportProblem } from "@/report";
import { virtualRideId } from "@/virtualRide";
import { useRide } from "@/ride";
import { Card, Chip, PrimaryButton, RoundButton, Tap } from "@/ui/kit";
import { useBusWatch } from "@/busWatch";
import { allowAlerts, cancelComing } from "@/notify";
import * as Haptics from "expo-haptics";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteAlerts } from "@/ui/RouteAlerts";
import { Eta } from "@/ui/Eta";
import { RouteBadge } from "@/ui/RouteBadge";
import { SceneHeader, laneColorOf } from "@/ui/Illustrations";
import { tipOnce } from "@/tips";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

/** Hoja de una parada: lo mismo que la web. Rutas que vienen, hora de cada una, de dónde viene el bus y los horarios si no hay datos en vivo. */
export default function StopSheet() {
  const { id, route: routeParam } = useLocalSearchParams<{ id: string; route?: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow() / 1000;
  const [sel, setSel] = useState<{ routeId: string; direction: string } | null>(routeParam ? { routeId: routeParam, direction: "" } : null);   // desde «Cómo llegar» se abre directo el detalle de esa ruta
  const stop = transit.stopById(id);

  const fav = useSaved((f) => f.stops.includes(id)), toggle = useSaved((f) => f.toggleStop);
  const nick = useSaved((f) => f.nicknames[id]), setNick = useSaved((f) => f.setNickname);
  const siblings = useMemo(() => (stop ? siblingStops(transit, stop).map((x) => ({ x, names: [...new Set(routesAtStop(transit, x.id).map((r) => r.shortName))].slice(0, 2).join(" ") })) : []), [stop, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  // al abrir la app directo en una parada (desde el widget, por ejemplo) las rutas aún se están cargando: eso no es «no existe»
  if (!stop) return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <View style={[styles.screen, { paddingTop: space[10] * 2 }]}>
        <Text style={[type.headline, { color: c.text }]}>{transit.network.stops.size ? "No encontramos esa parada" : "Cargando la parada…"}</Text>
        <Text style={[type.body, { color: c.muted }]}>{transit.network.stops.size ? "Puede que ya no exista o que haya cambiado de código." : "Estamos trayendo las rutas y paradas. Un momento."}</Text>
      </View>
    </View>
  );

  const rows = upcomingAtStop(transit, id, nowSec(), 6);
  const down = liveDown();
  const label = transit.labelOf(stop), tag = stopTag(stop);
  const here = routesAtStop(transit, id);
  const hereCount = new Set(here.map((r) => r.shortName)).size;
  // estación de TransMiCable: sus cabinas no envían ubicación, así que se dice lo del horario oficial (nunca «en vivo»)
  const cable = here.length && here.every((r) => r.system === "cable") ? cableInfo(transit, here[0]!.id, nowMs()) : null;
  // los dos sentidos del cable desde esta estación: el recorrido sube hasta el Mirador y vuelve; se empieza en su paso de ida o de vuelta
  const cableTrips = (() => {      // sin `useMemo`: va después de un `return` temprano de esta pantalla (las reglas de React no lo permiten) y es barato
    if (!cable?.open) return [];
    const out: { id: string; to: string }[] = [];
    for (const r of here) (transit.network.shapes.get(r.id) ?? []).forEach((sh, si) => {
      const last = sh.stopIds.length - 1;
      // donde se devuelve el cable (arriba, en el Mirador): la parada cuya anterior y siguiente son la misma
      const apex = sh.stopIds.findIndex((_, k) => k > 0 && k < last && sh.stopIds[k - 1] === sh.stopIds[k + 1]);
      for (const i of [sh.stopIds.indexOf(id), sh.stopIds.lastIndexOf(id)]) {
        if (i < 0 || i >= last) continue;
        const end = apex > 0 && i < apex ? apex : last, to = transit.stopById(sh.stopIds[end])?.name ?? "";
        if (to && !out.some((o) => o.to === to)) out.push({ id: virtualRideId(r.id, si, i), to });
      }
    });
    return out;
  })();
  // la ilustración de arriba: estación (con el color de su línea más común), paradero del SITP o estación del cable
  const scene = (() => {
    const trunk = here.find((r) => r.system === "troncal" || r.system === "dual");
    const counts = new Map<string, number>();
    for (const r of here) { const l = laneColorOf(r.shortName, r.system, c.dark); if (l !== SYSTEM_COLOR[r.system]) counts.set(l, (counts.get(l) ?? 0) + 1); }
    const lane = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
    const sys = trunk?.system ?? here[0]?.system ?? "zonal", kind = cable ? "cable" as const : stopKind(stop) === "Parada" ? "stop" as const : "station" as const;
    return { kind, bus: SYSTEM_COLOR[sys], lane: lane ?? SYSTEM_COLOR[sys], long: sys === "troncal" };
  })();
  const alerts = alertsFor(transit, new Set(here.map((r) => r.id)), new Set([id])).slice(0, 2);

  const showOnMap = (focus: { routeId?: string | null; busIds?: string[]; followBusId?: string | null }) => {
    useMapFocus.getState().set({ stopId: id, routeId: focus.routeId ?? null, busIds: focus.busIds ?? [], followBusId: focus.followBusId ?? null });
    router.dismissAll();
    router.navigate("/mapa");
  };
  const goHere = () => { usePlanner.getState().setDest({ name: stopLabelText(label), position: stop.position }); router.dismissAll(); router.navigate("/viaje"); };
  const share = () => void Share.share({ message: `${stopLabelText(label)} en TransMi LIVE`, url: `https://transmilive.com/#/parada/${encodeURIComponent(id)}` });

  // la hoja pasa de la lista de rutas al detalle de una ruta (como en la web)
  const row = sel ? rows.find((r) => r.route.id === sel.routeId && (!sel.direction || r.direction === sel.direction)) : undefined;
  if (sel) return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        <RouteAtStop stopId={id} sel={sel} row={row} now={now} onBack={() => setSel(null)} onMap={(buses, follow) => showOnMap({ routeId: sel.routeId, busIds: buses, followBusId: follow })} />
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        {/* cabecera ilustrada: la estación con la franja de su línea, o el paradero del SITP; el bus que viene entra y se detiene */}
        <SceneHeader kind={scene.kind} busColor={scene.bus} laneColor={scene.lane} long={scene.long} sign={rows[0]?.route.shortName} arrive height={140} />
        <Text style={[type.eyebrow, { color: c.accent }]}>{stopKind(stop).toUpperCase()}</Text>
        <Text style={[type.largeTitle, { color: c.text }]}>{nick || label.title}</Text>
        {nick ? <Text style={[type.caption, { color: c.muted }]}>{label.title}</Text> : null}
        {cable ? (
          <Card style={{ gap: space[1] }}>
            <Text style={[type.caption, { color: c.muted }]}>TRANSMICABLE · SEGÚN HORARIO</Text>
            <Text style={[type.headline, { color: c.text }]}>{cable.text.replace(" (según horario)", "")}</Text>
            <Text style={[type.caption, { color: c.muted }]}>Portal Tunal · Juan Pablo II · Manitas · Mirador del Paraíso. Las cabinas no envían su ubicación: esto sale del horario oficial de TransMilenio.</Text>
            {/* «Voy en el cable»: como «Voy en este bus», con tu ubicación (las cabinas no envían la suya). Un botón por sentido */}
            {cableTrips.map((t) => <PrimaryButton key={t.id} symbol="cablecar.fill" label={`Voy en el cable hacia ${t.to.replace(" · TransMiCable", "")}`} onPress={() => { useRide.getState().set(t.id, null); router.push({ pathname: "/ride/[id]", params: { id: t.id } }); }} />)}
          </Card>
        ) : null}
        <Text style={[type.body, { color: c.muted }]}>
          {tag ? `${tag} · ` : ""}{cable ? "Estación de TransMiCable" : rows.length ? `${rows.length} ${rows.length === 1 ? "ruta con bus en camino" : "rutas con bus en camino"}${hereCount > rows.length ? ` · ${hereCount} paran aquí` : ""}` : down ? downText().short : "Sin buses acercándose"}
        </Text>

        <View style={styles.actions}>
          <RoundButton symbol="arrow.triangle.turn.up.right.diamond.fill" label="Cómo llegar a esta parada" onPress={goHere} />
          <RoundButton symbol="map.fill" label="Ver en el mapa" onPress={() => showOnMap({ busIds: rows.flatMap((r) => r.buses.map((b) => b.vehicle.id)) })} />
          <RoundButton symbol="square.and.arrow.up" label="Compartir" onPress={share} />
          <RoundButton symbol={fav ? "star.fill" : "star"} label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} onPress={() => toggle(id)} />
        </View>
        <Tap onPress={() => router.push({ pathname: "/personalizar/[id]", params: { id } })} accessibilityRole="button" accessibilityLabel={nick ? `Personalizar parada. Nombre actual: ${nick}` : "Personalizar parada"}>
          <Card style={styles.custom}>
            <View style={[styles.customIcon, { backgroundColor: c.dark ? "#2a1114" : "#fde8ea" }]}><SymbolView name="pencil" tintColor={c.accent} size={16} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: c.text }]}>{nick ? "Personalizar parada" : "Personalizar parada"}</Text>
              <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{nick ? `Se muestra como «${nick}»` : "Ponle un nombre, como «La del colegio»"}</Text>
            </View>
            <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
          </Card>
        </Tap>

        {siblings.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[5] }} contentContainerStyle={{ gap: space[2], paddingVertical: space[1], paddingHorizontal: space[5] }}>
            {siblings.map(({ x, names }) => {
              const t = stopTag(x) || stopCode(x) || "Parada";
              const dup = siblings.filter((y) => (stopTag(y.x) || stopCode(y.x)) === t).length > 1;      // varias paradas del mismo vagón (una por sentido): se distinguen por sus rutas
              return <Chip key={x.id} label={dup && names ? `${t} · ${names}` : t} selected={x.id === id} onPress={() => router.setParams({ id: x.id })} />;
            })}
          </ScrollView>
        ) : null}
        {/* en una estación: en qué vagón para cada ruta, para no quedarse esperando en el vagón equivocado */}
        {siblings.length > 1 ? (
          <Card style={{ gap: space[2], paddingVertical: space[3] }}>
            <Text style={[type.eyebrow, { color: c.muted }]}>¿EN QUÉ VAGÓN PARA CADA RUTA?</Text>
            {siblings.filter(({ x }) => x.id !== id).map(({ x }) => {
              const rs = routesAtStop(transit, x.id), t = stopTag(x) || stopCode(x) || "Parada";
              if (!rs.length) return null;
              return (
                <Tap key={x.id} still onPress={() => router.setParams({ id: x.id })} accessibilityRole="button" accessibilityLabel={`${t}: rutas ${rs.map((r) => r.shortName).join(", ")}. Ver este vagón`} style={styles.wagonRow}>
                  <Text style={[type.headline, { color: c.text, minWidth: 74 }]}>{t}</Text>
                  <View style={[styles.routeWrap, { flex: 1 }]}>{rs.slice(0, 8).map((r) => <RouteBadge key={r.id} route={r} />)}{rs.length > 8 ? <Text style={[type.caption, { color: c.muted, alignSelf: "center" }]}>+{rs.length - 8}</Text> : null}</View>
                  <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
                </Tap>
              );
            })}
          </Card>
        ) : null}

        {alerts.map(({ alert, index }) => (
          <Tap key={index} onPress={() => router.push("/avisos")} accessibilityRole="button" accessibilityLabel={`Aviso: ${alertView(transit, alert).title}`}>
            <Card style={{ gap: space[1] }}>
              <Text style={[type.caption, { color: alert.effect === "noService" ? "#dc2626" : "#d97706" }]}>{alertView(transit, alert).tag}</Text>
              <Text style={[type.headline, { color: c.text }]} numberOfLines={2}>{alertView(transit, alert).title}</Text>
              <Text style={[type.body, { color: c.muted }]} numberOfLines={4}>{alertView(transit, alert).body}</Text>
            </Card>
          </Tap>
        ))}

        {rows.length ? (
          <>
            <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>TOCA UNA RUTA PARA VER DE DÓNDE VIENE</Text>
            {rows.map((r) => <ArrivalRow key={r.route.id + r.direction} r={r} now={now} onPress={() => setSel({ routeId: r.route.id, direction: r.direction })} />)}
            <OtherRoutes stopId={id} skipKeys={rows.map((r) => `${r.route.id}|${r.direction}`).join(",")} />
          </>
        ) : <NoBuses stopId={id} here={here} down={down} now={now} />}

        <Tap onPress={() => reportProblem({ what: `parada ${stopLabelText(label)}`, lines: [`ID de la parada: ${id}`, down ? "Estado: sin datos en vivo" : "Estado: en vivo"] })} accessibilityRole="button" accessibilityLabel="Reportar un problema con esta parada" style={{ marginTop: space[4] }}>
          <Text style={[type.caption, { color: c.muted, fontSize: 14 }]}>¿Algo no cuadra? Reportar un problema con esta parada</Text>
        </Tap>
      </ScrollView>
    </View>
  );
}

/** Una ruta que viene hacia la parada: su hora, cuántas paradas faltan y cuándo llega el siguiente. */
function ArrivalRow({ r, now, onPress }: { r: UpcomingRoute; now: number; onPress(): void }) {
  const c = useColors();
  const first = r.buses[0]!, next = r.buses[1];
  const soon = first.etaAt - now <= 60, old = !!first.vehicle && now - first.vehicle.reportedAt > 90;
  const mark = first.vehicle ? transit.serviceOf(first.vehicle) : undefined;
  // si la ruta tiene un aviso vigente (desvío, vagón cerrado), una etiqueta corta; el detalle sale al tocar la ruta
  const warn = routeHasAlert(transit, r.route.id) ? routeAlertViews(transit, r.route.id)[0]?.view.short ?? null : null;
  const sub = `${first.official || first.stopsAway === 0 ? "" : "aprox. "}${stopsAwayText(first.stopsAway)}${next ? ` · luego ${etaText(next.etaAt, now)}` : ""}`;
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={`Ruta ${r.route.shortName}${r.headsign ? ` hacia ${r.headsign}` : ""}, ${first.stopsAway === 0 ? "en la plataforma, por salir" : `llega en ${etaText(first.etaAt, now)}`}, ${sub}`}>
      <Card style={styles.row}>
        <RouteBadge route={r.route} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{r.headsign ? `Hacia ${r.headsign}` : routeTitle(r.route)}</Text>
          <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{sub}</Text>
          {mark?.isLast ? <ServicePill text="Último servicio" tone="#dc2626" /> : mark?.isFirst ? <ServicePill text="Primer servicio" tone="#16a34a" /> : null}
          {warn ? <ServicePill text={warn} tone="#d97706" /> : null}
        </View>
        {first.stopsAway === 0 ? <Text style={[type.title, { color: c.text }]}>Por salir</Text>
          : <Eta at={first.etaAt} prefix={old ? "≈ " : ""} style={[type.title, { color: soon ? c.accent : c.text }]} containerStyle={{ opacity: old ? 0.6 : 1 }} />}
        <SymbolView name="chevron.right" tintColor={c.muted} size={13} />
      </Card>
    </Tap>
  );
}

function ServicePill({ text, tone }: { text: string; tone: string }) {
  return <View style={[styles.pill, { borderColor: tone }]}><Text style={[type.caption, { color: tone, fontSize: 11 }]}>{text}</Text></View>;
}

const LEADS = [3, 5, 10] as const;
/** «Avísame cuando venga»: elige cuántos minutos antes y te llega un aviso cuando el bus esté por llegar (se corrige con cada dato nuevo).
 *  Se elige el primer bus que todavía está más lejos que eso: si el próximo llega en 2 min, el aviso es para el siguiente. */
function ComingAlert({ stopId, row, now }: { stopId: string; row: UpcomingRoute; now: number }) {
  const c = useColors();
  const w = useBusWatch((s) => s.w);
  const [lead, setLead] = useState<number>(5);
  const mine = w && w.stopId === stopId && transit.routeFamily(row.route.id).includes(w.routeId) ? w : null;
  const target = row.buses.find((b) => b.stopsAway > 0 && b.etaAt - now > lead * 60 + 30);
  const watched = mine ? row.buses.find((b) => b.vehicle.id === mine.busId) : undefined;
  const start = async () => {
    if (!target) return;
    if (!(await allowAlerts())) { Alert.alert("Activa las notificaciones", "Para avisarte cuando venga el bus, permite las notificaciones de TransMi LIVE en los ajustes del teléfono."); return; }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await cancelComing();
    useBusWatch.getState().set({ stopId, routeId: row.route.id, busId: target.vehicle.id, minutes: lead, since: now });
    void tipOnce("coming", 400);      // la primera vez se explica cómo funciona el aviso
  };
  const stop = () => { void cancelComing(); useBusWatch.getState().clear(); };
  if (mine) return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
        <SymbolView name="bell.fill" tintColor={c.accent} size={16} />
        <Text style={[type.headline, { color: c.text, flex: 1 }]}>Te avisamos {mine.minutes} min antes</Text>
      </View>
      <Text style={[type.body, { color: c.muted }]}>{watched ? `Cuando el ${row.route.shortName} que llega en ${etaText(watched.etaAt, now)} esté a ${mine.minutes} min de aquí.` : `El bus que esperabas ya no aparece en los datos; el aviso queda a la última hora calculada.`} Con la app cerrada la hora es aproximada.</Text>
      <Tap onPress={stop} accessibilityRole="button" accessibilityLabel="Cancelar el aviso"><Text style={[type.headline, { color: c.accent }]}>Cancelar el aviso</Text></Tap>
    </Card>
  );
  return (
    <Card style={{ gap: space[2] }}>
      <Text style={[type.headline, { color: c.text }]}>Avísame cuando venga</Text>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        {LEADS.map((m) => <Chip key={m} label={`${m} min antes`} selected={lead === m} onPress={() => setLead(m)} />)}
      </View>
      {target ? <PrimaryButton symbol="bell.fill" label={`Avisarme ${lead} min antes`} onPress={() => void start()} />
        : <Text style={[type.caption, { color: c.muted }]}>El próximo bus llega en menos de {lead} min: mejor ve saliendo ya.</Text>}
    </Card>
  );
}

/** Detalle de una ruta en la parada: el próximo bus y los siguientes, y el recorrido que le falta al bus hasta aquí. */
function RouteAtStop({ stopId, sel, row, now, onBack, onMap }: { stopId: string; sel: { routeId: string; direction: string }; row?: UpcomingRoute; now: number; onBack(): void; onMap(busIds: string[], follow: string | null): void }) {
  const c = useColors();
  const stop = transit.stopById(stopId);
  const route = transit.routeById(sel.routeId);
  const color = route ? SYSTEM_COLOR[route.system] : c.accent;
  const shape = transit.network.shapes.get(sel.routeId)?.find((s) => s.direction === (row?.direction ?? sel.direction)) ?? (sel.direction ? undefined : transit.network.shapes.get(sel.routeId)?.find((s) => s.stopIds.includes(stopId)));
  const j = shape ? shape.stopIds.indexOf(stopId) : -1;
  const hero: UpcomingBus | undefined = row?.buses[0];
  const heroNext = hero ? transit.nextStopOf(hero.vehicle, nowMs())?.stop : undefined;
  const nextIdx = (b: UpcomingBus) => (shape ? shape.stopIds.indexOf(b.vehicle.lastStopId ?? "") + 1 : -1);   // la parada que sigue a la última
  const ks = row && shape ? row.buses.map(nextIdx).filter((k) => k > 0) : [];
  const kmin = ks.length ? Math.min(...ks) : j;
  const path = shape && j >= 0 ? shape.stopIds.slice(Math.max(0, kmin), j + 1) : [];
  const ids = row ? row.buses.map((b) => b.vehicle.id) : [];

  return (
    <>
      <Tap onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver a la parada" style={styles.back}>
        <SymbolView name="chevron.left" tintColor={c.accent} size={16} /><Text style={[type.headline, { color: c.accent }]}>{stopText(stop, "Parada")}</Text>
      </Tap>
      <View style={styles.head}>
        {route ? <RouteBadge route={route} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: c.text }]} numberOfLines={2}>{shape?.headsign ? `Hacia ${shape.headsign}` : route ? routeTitle(route) : ""}</Text>
          <Text style={[type.caption, { color: c.muted }]}>{route ? SYSTEM_LABEL[route.system] : ""} · llega a {stopText(stop)}</Text>
        </View>
      </View>
      {route ? <RouteAlerts routeId={route.id} max={1} /> : null}

      {!row || !hero ? <RouteEmpty route={route} /> : (
        <>
          {transit.serviceOf(hero.vehicle)?.isLast ? <Card><Text style={[type.caption, { color: "#dc2626" }]}>ÚLTIMO SERVICIO</Text><Text style={[type.body, { color: c.text }]}>Es el último viaje programado de hoy en esta ruta: después de este no hay más buses.</Text></Card>
            : transit.serviceOf(hero.vehicle)?.isFirst ? <Card><Text style={[type.caption, { color: "#16a34a" }]}>PRIMER SERVICIO</Text><Text style={[type.body, { color: c.text }]}>Es el primer viaje programado de hoy en esta ruta.</Text></Card> : null}

          <View style={[styles.hero, { backgroundColor: color }]}>
            <Text style={[type.eyebrow, { color: "#ffffff", opacity: 0.8 }]}>PRÓXIMO BUS</Text>
            {hero.stopsAway === 0 ? <Text style={[type.number, { color: "#ffffff" }]}>Por salir</Text> : (
              <View style={styles.heroTime}>
                <Eta at={hero.etaAt} style={[type.number, { color: "#ffffff" }]} />
                {!hero.official ? <Text style={[type.title, { color: "#ffffff" }]}> aprox.</Text> : null}
              </View>
            )}
            {now - hero.vehicle.reportedAt > 90 ? <Text style={[type.caption, { color: "#ffffff", opacity: 0.85 }]}>Dato de hace {Math.round((now - hero.vehicle.reportedAt) / 60)} min</Text> : null}
            <Text style={[type.body, { color: "#ffffff" }]}>{hero.stopsAway <= 0 ? "Está en la plataforma, a punto de salir." : hero.stopsAway <= 1 ? "Ya va hacia esta parada." : `Ahora va hacia ${stopText(heroNext, "su próxima parada")}, ${stopsAwayText(hero.stopsAway)} de aquí.`}</Text>
            {frequencyText(row.buses.map((b) => b.etaAt), now) ? <Text style={[type.caption, { color: "#ffffff", opacity: 0.9 }]}>{frequencyText(row.buses.map((b) => b.etaAt), now)}</Text> : null}
            <View style={styles.heroActs}>
              <Tap onPress={() => onMap(ids, hero.vehicle.id)} accessibilityRole="button" accessibilityLabel="Seguir este bus" style={[styles.heroBtn, { backgroundColor: "#ffffff" }]}><Text style={[type.headline, { color: "#111111" }]}>Seguir este bus</Text></Tap>
              <Tap onPress={() => onMap(ids, null)} accessibilityRole="button" accessibilityLabel="Ver en el mapa" style={[styles.heroBtn, { backgroundColor: "rgba(255,255,255,0.22)" }]}><Text style={[type.headline, { color: "#ffffff" }]}>Ver en el mapa</Text></Tap>
            </View>
          </View>

          <ComingAlert stopId={stopId} row={row} now={now} />

          {row.buses.length > 1 ? (
            <>
              <Text style={[type.eyebrow, { color: c.muted, marginTop: space[2] }]}>LOS SIGUIENTES</Text>
              <Card style={{ gap: space[3] }}>
                {row.buses.slice(1).map((b, i) => (
                  <View key={b.vehicle.id} style={styles.next}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.headline, { color: c.text }]}>{etaText(b.etaAt, now)}{!b.official ? <Text style={[type.caption, { color: c.muted }]}> aprox.</Text> : null}</Text>
                      <Text style={[type.caption, { color: c.muted }]}>Bus {i + 2} · {stopsAwayText(b.stopsAway)}</Text>
                    </View>
                    {transit.serviceOf(b.vehicle)?.isLast ? <ServicePill text="Último servicio" tone="#dc2626" /> : null}
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {path.length > 1 ? (
            <>
              <Text style={[type.eyebrow, { color: c.muted, marginTop: space[2] }]}>RECORRIDO HASTA TU PARADA</Text>
              <View>
                {path.map((sid, i) => {
                  const at = row.buses.filter((b) => shape?.stopIds[nextIdx(b)] === sid);
                  const last = i === path.length - 1;
                  return (
                    <View key={sid} style={styles.tl}>
                      <View style={styles.tlRail}>
                        <View style={[styles.tlLine, { backgroundColor: color, top: i === 0 ? "50%" : 0, bottom: last ? "50%" : 0 }]} />
                        <View style={[styles.tlDot, { backgroundColor: last ? color : c.card, borderColor: color }]} />
                      </View>
                      <View style={{ flex: 1, paddingVertical: space[2] }}>
                        <Text style={[type.body, { color: c.text, fontWeight: last || at.length ? "700" : "400" }]}>{stopText(transit.stopById(sid), sid)}</Text>
                        {last ? <Text style={[type.caption, { color: color }]}>tu parada</Text> : null}
                        {at.length ? (
                          <View style={[styles.busHere, { backgroundColor: color + "22" }]}>
                            <SymbolView name="bus.fill" tintColor={color} size={13} />
                            <Text style={[type.caption, { color, fontWeight: "700" }]}>{at.length === 1 ? "Un bus va hacia aquí" : `${at.length} buses van hacia aquí`}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

/** La ruta no tiene buses hacia esta parada: se dice por qué (terminó, aún no empieza o no hay datos). */
function RouteEmpty({ route }: { route?: Route }) {
  const c = useColors();
  const st = route ? transit.routeStatus(route.id, nowMs()) : undefined;
  const down = liveDown();
  const [title, text] = st?.state === "ended" ? ["Ya no hay más buses hoy", (down ? `Según el horario, el último salió a las ${clockOfDay(st.lastStart)}.` : `El último salió a las ${clockOfDay(st.lastStart)} y ya no queda ninguno en la calle.`) + (st.nextFirstStart != null ? ` El próximo sale a las ${clockOfDay(st.nextFirstStart)}.` : "")]
    : st?.state === "before" ? ["Aún no empieza el servicio", `El primer bus sale a las ${clockOfDay(st.firstStart)}.`]
    : down ? (downText().closed || downText().offline ? [downText().title, downText().detail] : ["Sin datos en vivo por ahora", "TransMilenio no está enviando la ubicación de los buses, así que no podemos decir cuándo llega el próximo. Eso no significa que no haya servicio."])
    : ["Ningún bus viene ahora", "Esta ruta no tiene buses acercándose a la parada en este momento."];
  return <Card><Text style={[type.headline, { color: c.text }]}>{title}</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{text}</Text></Card>;
}

/** Las demás rutas que paran aquí aunque ahora no tengan un bus acercándose: así siempre se sabe cuáles pasan, y cuándo según el horario. */
function OtherRoutes({ stopId, skipKeys }: { stopId: string; skipKeys: string }) {
  const c = useColors();
  const skip = useMemo(() => new Set(skipKeys.split(",")), [skipKeys]);
  const down = liveDown();
  const items = useMemo(() => {
    const day = transit.serviceEnds.dayAt(nowSec() * 1000);
    const sched = new Map<string, number>(), more = new Map<string, number[]>();
    if (transit.departures.size) for (const p of transit.departures.nextAt(stopId, day.type, day.secs, 3)) if (p.times[0] != null) { sched.set(`${p.routeId}|${p.direction}`, p.times[0]); more.set(`${p.routeId}|${p.direction}`, p.times.slice(0, 3)); }
    const seen = new Set<string>(), out: { route: Route; headsign: string; key: string; state?: string; next?: number; lastStart?: number; firstStart?: number; nextFirst?: number; times?: number[]; every?: number; inMin?: number }[] = [];
    for (const [routeId, shapes] of transit.network.shapes) {
      const route = transit.routeById(routeId);
      if (!route) continue;
      for (const sh of shapes) {
        const key = `${routeId}|${sh.direction}`;
        if (!sh.stopIds.includes(stopId) || skip.has(key)) continue;
        const dup = `${route.shortName}|${sh.headsign}`;
        if (seen.has(dup)) continue;
        seen.add(dup);
        const st = transit.routeStatus(routeId, nowMs());
        out.push({ route, headsign: sh.headsign, key, state: st?.state, next: sched.get(key), inMin: sched.has(key) ? Math.round((sched.get(key)! - day.secs) / 60) : undefined, times: more.get(key), every: transit.departures.headwayAt(routeId, day.type, day.secs), lastStart: st?.state === "ended" ? st.lastStart : undefined, nextFirst: st?.nextFirstStart, firstStart: st?.state === "before" ? st.firstStart : undefined });
      }
    }
    const rank = (x: { state?: string }) => (x.state === "ended" || x.state === "before" ? 1 : 0);
    // primero las que pasan antes según el horario; las que no tienen hora, por nombre
    return out.sort((a, b) => rank(a) - rank(b) || (a.next ?? Infinity) - (b.next ?? Infinity) || a.route.shortName.localeCompare(b.route.shortName, "es", { numeric: true })).slice(0, 40);
  }, [stopId, skip, transit.version]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <>
      <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>{down ? "HORARIO PROGRAMADO (APROXIMADO)" : "TAMBIÉN PARAN AQUÍ"}</Text>
      {down ? <Text style={[type.caption, { color: c.muted, marginTop: -space[1] }]}>No son buses en vivo: son las horas a las que deberían pasar según el horario de TransMilenio.</Text> : null}
      {items.map((x) => {
        const off = x.state === "ended" || x.state === "before";
        const sub = x.state === "ended" ? `Ya no hay más buses hoy${x.nextFirst != null ? ` · el próximo sale a las ${clockOfDay(x.nextFirst)}` : x.lastStart != null ? ` · el último salió a las ${clockOfDay(x.lastStart)}` : ""}`
          : x.state === "before" ? `Aún no empieza${x.firstStart != null ? ` · primer bus a las ${clockOfDay(x.firstStart)}` : ""}`
          // sin datos en vivo (sin internet, o TransMilenio no envía): lo que dice el horario, que sí está guardado en el teléfono
          : down && x.times?.length ? `Según el horario: ${x.times.map(clockOfDay).join(" · ")}${x.every ? ` · pasa cada ${Math.max(1, Math.round(x.every / 60))} min aprox.` : ""}`
          : x.next != null ? `Aún sin bus en camino · según el horario pasa a las ${(x.times ?? [x.next]).slice(0, 2).map(clockOfDay).join(" y ")}${x.inMin != null && x.inMin <= 90 ? ` (en unos ${Math.max(1, x.inMin)} min)` : ""}` : down ? "Sin horario publicado para esta ruta" : "Sin bus acercándose ahora";
        return (
          <Tap key={x.key} onPress={() => router.push({ pathname: "/route/[id]", params: { id: x.route.id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${x.route.shortName}${x.headsign ? ` hacia ${x.headsign}` : ""}. ${sub}`} style={{ opacity: off ? 0.55 : 1 }}>
            <Card style={styles.row}>
              <RouteBadge route={x.route} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{x.headsign ? `Hacia ${x.headsign}` : routeTitle(x.route)}</Text>
                <Text style={[type.caption, { color: c.muted }]} numberOfLines={2}>{sub}</Text>
              </View>
              <SymbolView name="chevron.right" tintColor={c.muted} size={13} />
            </Card>
          </Tap>
        );
      })}
    </>
  );
}

/** Parada sin buses acercándose: se explica, se muestra el horario programado y las rutas que pasan (las que no están en servicio, atenuadas). */
function NoBuses({ stopId, here, down, now }: { stopId: string; here: Route[]; down: boolean; now: number }) {
  const c = useColors();
  const day = transit.serviceEnds.dayAt(nowSec() * 1000);
  const scheduled = transit.departures.size ? transit.departures.nextAt(stopId, day.type, day.secs, 3).slice(0, 8) : [];
  const byName = new Map<string, Route>();
  for (const r of here) if (!byName.has(r.shortName)) byName.set(r.shortName, r);
  const state = (r: Route) => transit.routeStatus(r.id, nowMs())?.state;
  const routes = [...byName.values()].sort((a, b) => Number(state(a) === "ended") - Number(state(b) === "ended") || a.shortName.localeCompare(b.shortName, "es", { numeric: true })).slice(0, 24);
  const every = routes.length > 0 && routes.every((r) => state(r) === "ended");
  void now;
  return (
    <>
      <Card>
        <Text style={[type.headline, { color: c.text }]}>{every ? "Ya no hay más buses hoy" : down ? downText().title : "Ningún bus viene ahora"}</Text>
        <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>
          {every ? `${down ? "Según el horario, el" : "El"} servicio de las rutas de esta parada ya terminó por hoy.`
            : down ? `${downText().detail}${scheduled.length ? " Abajo ves el horario programado." : ""}`
            : "Cuando un bus se acerque a esta parada aparecerá aquí."}
        </Text>
      </Card>
      {scheduled.length ? (
        <>
          <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>PRÓXIMOS SEGÚN EL HORARIO</Text>
          {scheduled.map((s) => {
            const r = transit.routeById(s.routeId);
            const end = transit.departures.terminusOf(s.routeId, s.direction), head = end ? stopText(transit.stopById(end), end) : undefined;
            return (
              <Card key={s.routeId + s.direction} style={styles.row}>
                {r ? <RouteBadge route={r} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{head ? `Hacia ${head}` : r ? routeTitle(r) : s.routeId}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{s.times.map(clockOfDay).join(" · ")}</Text>
                </View>
              </Card>
            );
          })}
          <Text style={[type.caption, { color: c.muted }]}>Son horas programadas, no buses en vivo: la hora real puede variar.</Text>
        </>
      ) : null}
      {routes.length ? (
        <>
          <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>RUTAS QUE PASAN POR AQUÍ</Text>
          <View style={styles.routeWrap}>
            {routes.map((r) => { const st = state(r); return <Tap key={r.id} onPress={() => router.push({ pathname: "/route/[id]", params: { id: r.id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${r.shortName}${st === "ended" ? ", ya terminó hoy" : st === "before" ? ", aún no empieza" : ""}`} style={{ opacity: st === "ended" || st === "before" ? 0.4 : 0.8 }}><RouteBadge route={r} /></Tap>; })}
          </View>
          <Text style={[type.caption, { color: c.muted }]}>Más tenues: ya terminaron o aún no empiezan hoy.</Text>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  heroTime: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },
  screen: { padding: space[5], gap: space[3] },
  actions: { flexDirection: "row", gap: space[3], marginVertical: space[2] },
  busHere: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 9, height: 24, borderRadius: 12, marginTop: 4 },
  custom: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3] },
  customIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  pill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space[2], minHeight: 20, justifyContent: "center" },
  back: { flexDirection: "row", alignItems: "center", gap: space[1], alignSelf: "flex-start" },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  hero: { borderRadius: radius.xl, borderCurve: "continuous", padding: space[5], gap: space[1] },
  heroActs: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  heroBtn: { flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: space[2] },
  next: { flexDirection: "row", alignItems: "center", gap: space[3] },
  tl: { flexDirection: "row", gap: space[3], minHeight: 44 },
  tlRail: { width: 18, alignItems: "center" },
  tlLine: { position: "absolute", width: 3, left: 7.5 },
  tlDot: { position: "absolute", top: "50%", marginTop: -7, width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  routeWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  wagonRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 2 },
});
