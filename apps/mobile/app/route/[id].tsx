import { useEffect, useMemo, useRef, useState } from "react";
import { liveDown, downText } from "@/lastService";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "@/ui/Symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { arrivalAtIndex, displayNextIndex, routeDetail } from "@transmi/application";
import { ALERT_EFFECT_LABEL, SYSTEM_LABEL, alertTitle, describeAlert, routeOfficialName, routeTitle, type Vehicle } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { delayClass, delayText, etaText } from "@/format";
import { clockOfDay } from "@/lastService";
import { stopText } from "@/stopname";
import { useSaved } from "@/favorites";
import { useMapFocus } from "@/map/focus";
import { TransitMap, type TransitMapHandle } from "@/map/TransitMap";
import { Card, Chip, RoundButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

const DAY_LABEL = { wk: "Lunes a viernes", sa: "Sábados", su: "Domingos y festivos" } as const;
const MAX_BUSES = 12;

/** Una ruta como en la web: su recorrido y los buses en vivo en un mapa, y debajo los buses con su próxima parada, las paradas con los buses que van hacia ellas y el horario. */
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const map = useRef<TransitMapHandle>(null);
  useTransitVersion();
  const now = useNow() / 1000;
  const [dir, setDir] = useState<string | null>(null);
  const fav = useSaved((f) => f.routes.includes(id)), toggle = useSaved((f) => f.toggleRoute);
  const d = routeDetail(transit, id);
  // TransMilenio publica cada sentido como una ruta aparte: si existe el contrario, se ofrece el salto
  const otherId = transit.routeFamily(id).find((x) => x !== id), other = otherId ? transit.routeById(otherId) : undefined;
  const shapes = transit.network.shapes.get(id) ?? [];
  const cur = shapes.find((s) => s.direction === dir) ?? shapes[0];

  // el mapa se encuadra en el recorrido que se está viendo
  useEffect(() => {
    if (!cur || cur.points.length < 2) return;
    const step = Math.max(1, Math.floor(cur.points.length / 80));
    const t = setTimeout(() => map.current?.fit(cur.points.filter((_, i) => i % step === 0), 36, 20), 350);
    return () => clearTimeout(t);
  }, [id, cur?.direction]);   // eslint-disable-line react-hooks/exhaustive-deps

  // los buses de esta ruta que van en el sentido que se ve, con su próxima parada y la hora a la que llegan a ella
  const buses = useMemo(() => {
    if (!d || !cur) return [];
    const out: { v: Vehicle; k: number; nextId: string; at: number }[] = [];
    for (const v of d.vehicles) {
      const seq = transit.sequenceForDisplay(v);
      if (!seq || seq.shape !== cur) continue;
      const j = displayNextIndex(transit, v, cur, seq.index, nowMs()), nextId = cur.stopIds[j];
      if (!nextId) continue;
      out.push({ v, k: j - 1, nextId, at: arrivalAtIndex(transit, v, cur, seq.index, j, nowMs()) });
    }
    return out.sort((a, b) => b.k - a.k);
  }, [d, cur, Math.floor(now / 5)]);   // eslint-disable-line react-hooks/exhaustive-deps
  // próximas salidas programadas de este sentido desde su primera parada (para cuando aún no hay ningún bus en la calle)
  const nextStarts = useMemo(() => {
    if (!cur?.stopIds[0] || !transit.departures.size) return [];
    const dd = transit.serviceEnds.dayAt(nowMs());
    return transit.departures.nextAt(cur.stopIds[0], dd.type, dd.secs, 2).find((p) => p.routeId === id && p.direction === cur.direction)?.times ?? [];
  }, [id, cur, Math.floor(now / 30)]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <View style={[styles.empty, { backgroundColor: c.bg }]}><CloseToolbar />{transit.network.routes.size ? <><Text style={[type.headline, { color: c.text }]}>Ruta no encontrada</Text><Text style={[type.body, { color: c.muted }]}>Ya no aparece en el servicio.</Text></> : <Text style={[type.headline, { color: c.text }]}>Cargando la ruta…</Text>}</View>;
  const route = d.route, color = SYSTEM_COLOR[route.system];
  const status = transit.routeStatus(id, nowMs());
  const sched = transit.serviceEnds.scheduleOf(id, nowMs());
  const day = transit.serviceEnds.dayAt(nowMs());
  const gap = transit.departures.size ? transit.departures.headwayAt(id, day.type, day.secs) : null;
  const avg = d.averageDelaySeconds;
  const mapH = Math.min(320, Math.round(height * 0.36));
  const heading = (i: number) => buses.filter((b) => cur?.stopIds[b.k + 1] === cur?.stopIds[i]);
  const showAll = () => { useMapFocus.getState().set({ stopId: null, routeId: id, busIds: [], followBusId: null }); router.dismissAll(); router.navigate("/mapa"); };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: route.shortName }} />
      <CloseToolbar />
      <View style={{ height: mapH, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, overflow: "hidden" }}>
        <TransitMap ref={map} routeId={id} compact attributionPosition={{ bottom: 6, left: 8 }}
          onBus={(bid) => router.push({ pathname: "/bus/[id]", params: { id: bid } })} onStop={(sid) => router.push({ pathname: "/stop/[id]", params: { id: sid, route: id } })} />
        <View style={styles.mapBtn}><RoundButton symbol="arrow.up.left.and.arrow.down.right" label="Ver la ruta en el mapa grande" onPress={showAll} size={40} light /></View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <RouteBadge route={route} />
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: c.text }]} numberOfLines={2}>{cur?.headsign ? `Hacia ${cur.headsign}` : route.longName ? routeTitle(route) : SYSTEM_LABEL[route.system]}</Text>
            {route.longName ? <Text style={[type.caption, { color: c.muted }]}>Nombre oficial: {routeOfficialName(route)}</Text> : null}
            {other ? <Tap haptic={false} onPress={() => router.replace({ pathname: "/route/[id]", params: { id: other.id } })} accessibilityRole="button" accessibilityLabel={`Ver el ${route.shortName} en el sentido contrario${other.longName ? `, ${other.longName}` : ""}`} style={{ marginTop: 4, alignSelf: "flex-start" }}>
              <Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>Ver el sentido contrario{other.longName ? ` (${other.longName})` : ""} ›</Text></Tap> : null}
          </View>
          <RoundButton symbol={fav ? "star.fill" : "star"} label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} onPress={() => toggle(id)} />
        </View>
        <Text style={[type.body, { color: c.muted }]}>
          {SYSTEM_LABEL[route.system]} · {d.vehicles.length} {d.vehicles.length === 1 ? "bus" : "buses"} en la calle{avg != null && Math.abs(avg) < 7200 ? ` · ${avg > 120 ? Math.round(avg / 60) + " min tarde" : avg < -120 ? Math.round(-avg / 60) + " min antes" : "a tiempo"} en promedio` : ""}
        </Text>

        {shapes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[5] }} contentContainerStyle={{ gap: space[2], paddingHorizontal: space[5] }}>
            {shapes.map((s) => <Chip key={s.direction} label={s.headsign ? `Hacia ${s.headsign}` : `Sentido ${Number(s.direction) + 1}`} selected={cur?.direction === s.direction} onPress={() => setDir(s.direction)} />)}
          </ScrollView>
        ) : null}

        {status && status.state !== "running" ? (
          <Card><Text style={[type.headline, { color: c.text }]}>{status.state === "ended" ? "Ya no hay más buses hoy" : "Aún no empieza el servicio"}</Text>
            <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{status.state === "ended" ? `El último salió a las ${clockOfDay(status.lastStart)} y ya no queda ninguno en la calle.${status.nextFirstStart != null ? ` El próximo sale a las ${clockOfDay(status.nextFirstStart)}.` : ""}` : `El primer bus sale a las ${clockOfDay(status.firstStart)}.`}</Text></Card>
        ) : null}

        {d.alerts.map(({ alert, index }) => (
          <Tap key={index} onPress={() => router.push("/avisos")} accessibilityRole="button" accessibilityLabel={`Aviso: ${alertTitle(alert)}`}>
            <Card style={{ gap: space[1] }}>
              <Text style={[type.caption, { color: alert.effect === "noService" ? "#dc2626" : "#d97706" }]}>{ALERT_EFFECT_LABEL[alert.effect]}</Text>
              <Text style={[type.headline, { color: c.text }]} numberOfLines={2}>{alertTitle(alert)}</Text>
              <Text style={[type.body, { color: c.muted }]} numberOfLines={3}>{describeAlert(alert, (id) => transit.routeById(id)?.shortName)}</Text>
            </Card>
          </Tap>
        ))}

        <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>BUSES EN VIVO</Text>
        {buses.length ? <Text style={[type.caption, { color: c.muted, marginTop: -space[1] }]}>Cada bus con su próxima parada y en cuánto llega a ella.</Text> : null}
        {buses.length ? (
          <Card style={{ gap: 0, paddingVertical: space[1] }}>
            {buses.slice(0, MAX_BUSES).map((b, i) => {
              const dl = transit.delayOf(b.v), tone = delayClass(dl) === "bad" ? "#dc2626" : delayClass(dl) === "warn" ? "#d97706" : delayClass(dl) === "ok" ? "#16a34a" : c.muted;
              return (
                <Tap key={b.v.id} onPress={() => router.push({ pathname: "/bus/[id]", params: { id: b.v.id } })} accessibilityRole="button" accessibilityLabel={`Bus ${b.v.plate || b.v.id}, próxima parada ${stopText(transit.stopById(b.nextId), b.nextId)}, ${etaText(b.at, now)}`}
                  style={[styles.busRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}>
                  <SymbolView name="bus.fill" tintColor={color} size={20} />
                  <View style={{ flex: 1 }}>
                    {/* se dice a dónde es ese tiempo: sin el rótulo, «37 s» junto a un nombre no se sabe si es la parada donde está, a la que va o el destino */}
                    <Text style={[type.caption, { color: c.muted }]}>Bus {b.v.plate || b.v.label || b.v.id} · próxima parada{dl.kind !== "unknown" ? <Text style={{ color: tone }}> · {delayText(dl)}</Text> : null}</Text>
                    <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{stopText(transit.stopById(b.nextId), b.nextId)}</Text>
                  </View>
                  <Text style={[type.headline, { color: i === 0 ? c.accent : c.text, fontVariant: ["tabular-nums"] }]}>{etaText(b.at, now) === "llegando" ? "llegando" : `en ${etaText(b.at, now)}`}</Text>
                  <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
                </Tap>
              );
            })}
            {buses.length > MAX_BUSES ? <Text style={[type.caption, { color: c.muted, padding: space[3] }]}>y {buses.length - MAX_BUSES} buses más, en el mapa.</Text> : null}
          </Card>
        ) : <Card><Text style={[type.headline, { color: c.text }]}>{liveDown() ? downText().title : "Sin buses en este sentido ahora"}</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{liveDown() ? downText().detail : "Ningún bus de esta ruta va en este sentido en este momento."}</Text>
          {/* un bus solo aparece en los datos cuando ya salió: antes de eso, lo único que se sabe es a qué hora debería salir */}
          {nextStarts.length ? <Text style={[type.body, { color: c.text, marginTop: space[2] }]}>Según el horario, {nextStarts.length > 1 ? "los próximos salen" : "el próximo sale"} de {stopText(transit.stopById(cur!.stopIds[0]), "su primera parada")} a las {nextStarts.map(clockOfDay).join(" y ")}.</Text> : null}
          </Card>}

        {cur && cur.stopIds.length ? (
          <>
            <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>PARADAS · TOCA UNA PARA VER SUS BUSES</Text>
            <View>
              {cur.stopIds.map((sid, i) => {
                const here = heading(i), first = i === 0, last = i === cur.stopIds.length - 1;
                const soon = here[0]?.at;
                return (
                  <Tap key={sid + i} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: sid, route: id } })} accessibilityRole="button" accessibilityLabel={`${stopText(transit.stopById(sid), sid)}${here.length ? `, ${here.length} ${here.length === 1 ? "bus va" : "buses van"} hacia aquí` : ""}`} style={styles.tl}>
                    <View style={styles.tlRail}>
                      <View style={[styles.tlLine, { backgroundColor: color, top: first ? "50%" : 0, bottom: last ? "50%" : 0 }]} />
                      <View style={[styles.tlDot, { backgroundColor: here.length ? color : c.card, borderColor: color }]} />
                    </View>
                    <View style={{ flex: 1, paddingVertical: space[2] }}>
                      <Text style={[type.body, { color: c.text, fontWeight: here.length ? "700" : "400" }]} numberOfLines={2}>{stopText(transit.stopById(sid), sid)}</Text>
                      {here.length ? <Text style={[type.caption, { color }]}>{here.length === 1 ? "1 bus va hacia aquí" : `${here.length} buses van hacia aquí`}{soon ? ` · ${etaText(soon, now)}` : ""}</Text> : null}
                    </View>
                    <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
                  </Tap>
                );
              })}
            </View>
          </>
        ) : null}

        {sched ? (
          <>
            <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>HORARIO DE LA RUTA</Text>
            <Card style={{ gap: space[2] }}>
              {gap != null ? <Text style={[type.body, { color: c.text }]}>A esta hora, según el horario, sale un bus cada ~{Math.max(1, Math.round(gap / 60))} min.</Text> : null}
              {sched.days.map((x) => (
                <View key={x.type} style={styles.sched}>
                  <Text style={[type.body, { color: c.muted }]}>{DAY_LABEL[x.type]}{x.type === sched.today ? " · hoy" : ""}</Text>
                  <Text style={[type.headline, { color: c.text }]}>{clockOfDay(x.first)} – {clockOfDay(x.last)}</Text>
                </View>
              ))}
              <Text style={[type.caption, { color: c.muted }]}>Hora en que sale el primer y el último bus desde el inicio de la ruta, según el horario programado.</Text>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, padding: space[5], gap: space[2] },
  mapBtn: { position: "absolute", right: space[3], bottom: space[3] },      // abajo: arriba a la derecha está la X de cerrar de la ventana
  scroll: { padding: space[5], gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  busRow: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], minHeight: 56 },
  tl: { flexDirection: "row", gap: space[3], minHeight: 48 },
  tlRail: { width: 18, alignItems: "center" },
  tlLine: { position: "absolute", width: 3, left: 7.5 },
  tlDot: { position: "absolute", top: "50%", marginTop: -7, width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  sched: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
});
