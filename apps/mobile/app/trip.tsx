import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "@/ui/Symbol";
import { guideNow, guideSteps, tripGeometry } from "@transmi/application";
import { TransitMap, type TransitMapHandle } from "@/map/TransitMap";
import { transit } from "@/composition-root";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { hm } from "@/planner/format";
import { placeText, useTrip } from "@/trip";
import { useMapFocus } from "@/map/focus";
import { usePlanner } from "@/planner/store";
import { Card, PrimaryButton, RoundButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

/** El viaje que estás siguiendo, paso a paso: qué hacer ahora, qué sigue y a qué hora llegas. Los avisos salen aunque cierres esta ventana. */
export default function Trip() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow() / 1000;
  const it = useTrip((s) => s.it), dest = useTrip((s) => s.dest), guide = useTrip((s) => s.guide), shift = useTrip((s) => s.shift), busId = useTrip((s) => s.busId), place = useTrip((s) => s.place);

  const map = useRef<TransitMapHandle>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());      // tramos en bus con la lista de paradas desplegada
  const { height } = useWindowDimensions();
  // el dibujo del viaje solo cambia si cambia el viaje (o cuando terminan de cargar las rutas, para seguir las calles)
  const version = transit.network.shapes.size;
  const geo = useMemo(() => (it ? tripGeometry(transit, it, placeText) : null), [it, version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const routeIds = useMemo(() => (it ? it.legs.flatMap((l) => (l.kind === "ride" ? [l.routeId] : [])) : []), [it]);
  const fitAll = () => { if (geo) map.current?.fit(geo.legs.flatMap((l) => l.line), 46, 0); };
  useEffect(() => { const id = setTimeout(fitAll, 500); return () => clearTimeout(id); }, [geo]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!it) return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screen}>
        <Card>
          <Text style={[type.headline, { color: c.text }]}>No estás siguiendo ningún viaje</Text>
          <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>En «Cómo llegar», elige una opción y toca «Seguir este viaje» para que te avisemos en cada paso.</Text>
        </Card>
        <PrimaryButton label="Ir a Cómo llegar" onPress={() => { router.back(); router.navigate("/viaje"); }} />
      </ScrollView>
    </View>
  );

  const steps = guideSteps(it, placeText), nowDo = guideNow(it, guide, placeText);
  const mapH = Math.round(Math.min(380, height * 0.36));
  const leg = it.legs[guide.leg];
  // hora que más importa en este momento: cuándo llega el bus (esperando) o cuándo te bajas (a bordo)
  const key = leg?.kind === "ride" ? (guide.phase === "wait" ? leg.departAt : leg.arriveAt) + shift : null;
  const end = () => Alert.alert("¿Terminar el viaje?", "Dejaremos de avisarte los pasos de este viaje.", [
    { text: "Seguir", style: "cancel" },
    { text: "Terminar", style: "destructive", onPress: () => { useTrip.getState().stop(); router.back(); } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      {/* todo el viaje en el mapa: caminatas punteadas, cada bus con su recorrido, dónde te subes y te bajas, tu ubicación y los buses de esas rutas en vivo */}
      <View style={{ height: mapH, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, overflow: "hidden" }}>
        <TransitMap ref={map} compact trip={geo} onlyRoutes={routeIds} highlightIds={busId ? [busId] : []} showSignals={false} attributionPosition={{ bottom: 6, left: 8 }}
          onBus={(bid) => router.push({ pathname: "/bus/[id]", params: { id: bid } })} onStop={(sid) => router.push({ pathname: "/stop/[id]", params: { id: sid } })} />
        <View style={styles.mapBtn}><RoundButton symbol="viewfinder" label="Encuadrar todo el viaje en el mapa" onPress={fitAll} size={40} light /></View>
      </View>
      <ScrollView contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={[type.eyebrow, { color: c.muted }]}>VAS HACIA</Text>
          <Text style={[type.title, { color: c.text }]} numberOfLines={2} accessibilityRole="header">{dest || "tu destino"}</Text>
          <Text style={[type.caption, { color: c.muted, marginTop: 2 }]}>Llegas a las {hm(it.arriveAt + shift)}{Math.abs(shift) >= 60 ? ` · ${shift > 0 ? "vas" : "vas"} ${Math.round(Math.abs(shift) / 60)} min ${shift > 0 ? "más tarde" : "antes"} de lo previsto` : ""}</Text>
        </View>

        <Card dark style={{ gap: space[2] }}>
          <Text style={[type.eyebrow, { color: c.onInk, opacity: 0.7 }]}>AHORA</Text>
          <Text style={[type.title, { color: c.onInk }]}>{nowDo.title}</Text>
          <Text style={[type.body, { color: c.onInk, opacity: 0.85 }]}>{nowDo.body}</Text>
          {key && key > now ? <Text style={[type.headline, { color: c.onInk, fontVariant: ["tabular-nums"] }]}>{guide.phase === "wait" ? "El bus llega en " : "Te bajas en "}{etaText(key, now)}{busId ? " (en vivo)" : " (aprox.)"}</Text> : null}
          {busId ? <Tap onPress={() => { useMapFocus.getState().set({ followBusId: busId }); router.back(); router.navigate("/mapa"); }} accessibilityRole="button" accessibilityLabel="Ver este bus en el mapa"><Text style={[type.caption, { color: c.onInk, fontSize: 14, textDecorationLine: "underline" }]}>Ver el bus en el mapa ›</Text></Tap> : null}
        </Card>

        <Card style={{ gap: space[4] }}>
          {steps.map((s) => {
            const done = s.leg < guide.leg, current = s.leg === guide.leg;
            const l = it.legs[s.leg]!, route = l.kind === "ride" ? transit.routeById(l.routeId) : undefined;
            const row = (
              <View style={[styles.step, { opacity: done ? 0.45 : 1 }]}>
                <View style={styles.icon}>
                  {done ? <SymbolView name="checkmark.circle.fill" tintColor="#22c55e" size={20} />
                    : route ? <RouteBadge route={route} />
                    : <SymbolView name="figure.walk" tintColor={current ? c.accent : c.muted} size={20} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]}>{s.title}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{s.detail}</Text>
                  <Text style={[type.caption, { color: current ? c.accent : c.muted, marginTop: 2 }]}>{current ? "Vas aquí" : `${hm(s.start + shift)} – ${hm(s.end + shift)}`}</Text>
                </View>
              </View>
            );
            if (l.kind !== "ride") return <View key={s.leg} accessible accessibilityLabel={`${s.title}. ${s.detail}`}>{row}</View>;
            // todas las paradas que hace ese bus entre donde te subes y donde te bajas: para ir contando y saber cuánto falta
            const all = [l.board, ...(l.between ?? []), l.alight], shown = open.has(s.leg);
            return (
              <View key={s.leg} style={{ gap: space[2] }}>
                <Tap onPress={() => router.push({ pathname: "/stop/[id]", params: { id: l.board.id, route: l.routeId } })} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.detail}. Ver el bus en vivo`}>{row}</Tap>
                <Tap haptic={false} onPress={() => setOpen((o) => { const n = new Set(o); if (n.has(s.leg)) n.delete(s.leg); else n.add(s.leg); return n; })} accessibilityRole="button" accessibilityState={{ expanded: shown }}
                  accessibilityLabel={shown ? "Ocultar las paradas de este bus" : `Ver las ${all.length} paradas de este bus`} style={styles.toggle}>
                  <Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>{shown ? "Ocultar paradas" : `Ver las ${all.length} paradas`}</Text>
                  <SymbolView name={shown ? "chevron.up" : "chevron.down"} tintColor={c.accent} size={11} />
                </Tap>
                {shown ? (
                  <View style={styles.stops}>
                    {all.map((st, k) => {
                      const edge = k === 0 || k === all.length - 1, color = route ? SYSTEM_COLOR[route.system] : c.muted;
                      return (
                        <View key={`${st.id}-${k}`} style={styles.stopRow}>
                          <View style={styles.rail}>
                            {k > 0 ? <View style={[styles.railLine, { top: 0, bottom: "50%", backgroundColor: color }]} /> : null}
                            {k < all.length - 1 ? <View style={[styles.railLine, { top: "50%", bottom: 0, backgroundColor: color }]} /> : null}
                            <View style={[edge ? styles.dotBig : styles.dot, { borderColor: color, backgroundColor: edge ? color : c.card }]} />
                          </View>
                          <Text style={[edge ? type.headline : type.body, { color: edge ? c.text : c.muted, flex: 1, fontSize: edge ? 15 : 14 }]} numberOfLines={1}>{placeText(st)}</Text>
                          {edge ? <Text style={[type.caption, { color: c.muted }]}>{k === 0 ? "Subes" : "Bajas"}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
          <View style={styles.step}>
            <View style={styles.icon}><SymbolView name="mappin.circle.fill" tintColor={c.accent} size={20} /></View>
            <Text style={[type.headline, { color: c.text, flex: 1 }]}>Llegas a las {hm(it.arriveAt + shift)}</Text>
          </View>
        </Card>

        <Text style={[type.caption, { color: c.muted }]}>Te avisamos cuando tu bus esté por llegar, cuando te toque bajar y qué sigue. Con la app abierta usamos tu ubicación y el bus en vivo; con la app cerrada los avisos salen a la hora estimada y pueden variar.</Text>
        {place ? <PrimaryButton label="Buscar otra opción desde aquí" symbol="arrow.triangle.2.circlepath" onPress={() => { usePlanner.getState().setOrigin(null); usePlanner.getState().setDest(place); router.back(); router.navigate("/viaje"); }} a11y="Buscar otra forma de llegar desde donde estás" /> : null}
        <PrimaryButton label="Terminar viaje" tone="ink" onPress={end} a11y="Terminar el viaje y quitar los avisos" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], paddingTop: space[4], gap: space[4] },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  icon: { minWidth: 34, alignItems: "center", paddingTop: 2 },
  mapBtn: { position: "absolute", right: 12, bottom: 12 },
  toggle: { flexDirection: "row", alignItems: "center", gap: space[1], marginLeft: 34 + space[3], alignSelf: "flex-start", minHeight: 32 },
  stops: { marginLeft: 34 + space[3] },
  stopRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 30 },
  rail: { width: 14, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  railLine: { position: "absolute", width: 3, borderRadius: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  dotBig: { width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
});
