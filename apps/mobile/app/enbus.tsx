import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type BusGuess, type PhoneFix, type RouteGuess, guessMyBus } from "@transmi/application";
import { routeTitle } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useRide } from "@/ride";
import { virtualRideId } from "@/virtualRide";
import { SymbolView } from "@/ui/Symbol";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { space, type, useColors } from "@/ui/theme";

/** «¿En qué bus vas?»: con tu ubicación y hacia dónde te mueves, propone los buses de los datos que podrían ser el tuyo y, si el tuyo no
 *  aparece (su GPS no está reportando a TransMilenio), las rutas que pasan por ahí para seguirte con el GPS del teléfono.
 *  La ubicación se usa solo en el teléfono y no se guarda. `?route=ID` deja solo esa ruta (desde la ficha de una ruta). */
export default function EnBus() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { route: onlyRoute } = useLocalSearchParams<{ route?: string }>();
  const [state, setState] = useState<"buscando" | "sin-permiso" | "listo">("buscando");
  const [result, setResult] = useState<{ buses: BusGuess[]; routes: RouteGuess[]; moving: boolean } | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let gone = false, sub: Location.LocationSubscription | undefined, prev: PhoneFix | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    setState("buscando");
    void (async () => {
      const cur = await Location.getForegroundPermissionsAsync().catch(() => null);
      const perm = cur?.granted ? cur : await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (gone) return;
      if (!perm?.granted) { setState("sin-permiso"); return; }
      // unos segundos de lecturas para saber hacia dónde te mueves (en un bus en marcha, eso descarta los que van al revés)
      const decide = (fix: PhoneFix) => {
        if (!transit.network.shapes.size) return;
        const g = guessMyBus(transit, fix, prev, nowMs());
        const keep = (r: { route?: { id: string } }) => !onlyRoute || transit.routeFamily(onlyRoute).includes(r.route?.id ?? "");
        setResult({ buses: g.buses.filter(keep), routes: g.routes.filter(keep), moving: g.moving });
        setState("listo");
      };
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 }, (p) => {
        const fix: PhoneFix = { lat: p.coords.latitude, lon: p.coords.longitude, at: nowMs(), accuracy: p.coords.accuracy, speed: p.coords.speed };
        if (!prev) { prev = fix; timer = setTimeout(() => decide(prev!), 7000); return; }      // si no llega otra lectura (quieto), se decide con esta
        if (fix.at - prev.at >= 4000) { clearTimeout(timer); decide(fix); prev = fix; }
      }).catch(() => undefined);
      if (gone) sub?.remove();
    })();
    return () => { gone = true; sub?.remove(); clearTimeout(timer); };
  }, [round, onlyRoute]);

  const pickBus = (id: string) => { void Haptics.selectionAsync(); useRide.getState().set(id, null); router.replace({ pathname: "/ride/[id]", params: { id } }); };
  const pickRoute = (r: RouteGuess) => pickBus(virtualRideId(r.route.id, r.shapeIndex, r.fromIndex));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <CloseToolbar />
      <Text style={[type.body, { color: c.muted }]}>Con tu ubicación buscamos el bus en el que vas. Funciona mejor con el bus en marcha. Tu ubicación no sale del teléfono.</Text>

      {state === "buscando" ? <Card><Text style={[type.headline, { color: c.text }]}>Buscando tu bus…</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Unos segundos para saber hacia dónde vas.</Text></Card> : null}
      {state === "sin-permiso" ? (
        <Card style={{ gap: space[2] }}>
          <Text style={[type.headline, { color: c.text }]}>Necesitamos tu ubicación</Text>
          <Text style={[type.body, { color: c.muted }]}>Para saber en qué bus vas, la app usa tu ubicación mientras está abierta. No se guarda ni se envía a ningún lado.</Text>
          <Tap onPress={() => void Linking.openSettings()} accessibilityRole="button" accessibilityLabel="Abrir los ajustes del teléfono"><Text style={[type.headline, { color: c.accent }]}>Abrir Ajustes</Text></Tap>
        </Card>
      ) : null}

      {state === "listo" && result ? (
        <>
          <Text style={[type.eyebrow, { color: c.muted }]}>PUEDE SER UNO DE ESTOS</Text>
          {result.buses.length ? result.buses.map((b) => (
            <Tap key={b.vehicle.id} onPress={() => pickBus(b.vehicle.id)} accessibilityRole="button" accessibilityLabel={`Voy en el ${b.route?.shortName ?? "bus"} ${b.vehicle.plate ?? b.vehicle.label ?? ""}`}>
              <Card style={styles.row}>
                {b.route ? <RouteBadge route={b.route} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{b.headsign ? `Hacia ${b.headsign}` : b.route ? routeTitle(b.route) : "Bus"}</Text>
                  <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{[b.vehicle.label, b.vehicle.plate].filter(Boolean).join(" · ")}</Text>
                </View>
                <SymbolView name="chevron.right" tintColor={c.muted} size={13} />
              </Card>
            </Tap>
          )) : <Card><Text style={[type.body, { color: c.muted }]}>{result.moving ? "Ningún bus de los datos de TransMilenio va por aquí ahora. Puede que el tuyo no esté enviando su ubicación." : "No encontramos un bus que vaya contigo. Si ya vas en el bus, prueba de nuevo con el bus en marcha."}</Text></Card>}

          {result.routes.length ? (
            <>
              <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>¿NO ESTÁ? ELIGE LA RUTA Y TE SEGUIMOS CON TU UBICACIÓN</Text>
              {result.routes.map((r) => (
                <Tap key={`${r.route.id}-${r.shapeIndex}`} onPress={() => pickRoute(r)} accessibilityRole="button" accessibilityLabel={`Voy en un ${r.route.shortName}${r.headsign ? ` hacia ${r.headsign}` : ""}`}>
                  <Card style={styles.row}>
                    <RouteBadge route={r.route} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{r.headsign ? `Hacia ${r.headsign}` : routeTitle(r.route)}</Text>
                      <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>Sin señal del bus: te seguimos con tu GPS</Text>
                    </View>
                    <SymbolView name="location.fill" tintColor={c.muted} size={13} />
                  </Card>
                </Tap>
              ))}
            </>
          ) : <Card><Text style={[type.body, { color: c.muted }]}>Ninguna ruta pasa justo por donde estás. Si vas en un bus, espera a que esté sobre la vía y prueba de nuevo.</Text></Card>}
          <PrimaryButton tone="ink" symbol="arrow.triangle.2.circlepath" label="Buscar de nuevo" onPress={() => { setResult(null); setRound((n) => n + 1); }} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
});
