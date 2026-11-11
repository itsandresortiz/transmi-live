import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SymbolView } from "@/ui/Symbol";
import * as Haptics from "expo-haptics";
import { TRAVEL_MODES, type Itinerary, type PlanPlace, type PlanSort, searchPlanPlaces } from "@transmi/application";
import { SYSTEM_LABEL } from "@transmi/domain";
import { transit } from "@/composition-root";
import { geocode } from "@/geocode";
import { locateMe } from "@/location";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { durText, hm, isRide, isWalk, meters, mins, transfersText } from "@/planner/format";
import { nowMode, sorted, usePlanner, type When } from "@/planner/store";
import { useSaved } from "@/favorites";
import { Card, Chip, PrimaryButton, Tap, PAGE } from "@/ui/kit";
import { TripBanner } from "@/ui/TripBanner";
import { allowAlerts } from "@/notify";
import { useTrip } from "@/trip";
import { RouteBadge } from "@/ui/RouteBadge";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

type Field = "origin" | "dest";
const SORTS: [PlanSort, string][] = [["mejor", "Mejor"], ["rapida", "Más rápida"], ["trasbordos", "Menos trasbordos"], ["caminata", "Menos caminata"]];

export default function Viaje() {
  const c = useColors();
  const p = usePlanner();
  useTransitVersion();
  const [editing, setEditing] = useState<Field | null>(null);
  const [text, setText] = useState("");
  const [remote, setRemote] = useState<PlanPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const local = useMemo(() => (text.trim().length >= 2 ? searchPlanPlaces(transit, text.trim(), 6) : []), [text]);   // eslint-disable-line react-hooks/exhaustive-deps

  // direcciones y lugares (Photon / OpenStreetMap): cuando la persona deja de escribir un momento
  useEffect(() => {
    setRemote([]);
    const q = text.trim();
    if (q.length < 3) { setBusy(false); return; }
    const id = ++seq.current, ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => { void locateMe().then((me) => geocode(q, me, ctl.signal)).then((r) => { if (id === seq.current) setRemote(r); }).catch(() => undefined).finally(() => { if (id === seq.current) setBusy(false); }); }, 380);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text]);

  const saveAs = usePlanner((st) => st.saveAs);
  const saved = useSaved();
  // desde «Guardar casa / trabajo» de Inicio: se abre el buscador del destino y lo que se elija se guarda
  useEffect(() => { if (saveAs) { setEditing("dest"); setText(""); } }, [saveAs]);
  const choose = (place: PlanPlace) => {
    if (editing === "origin") p.setOrigin(place);
    else {
      p.setDest(place);
      if (saveAs) { saved.setPlace(saveAs, place); usePlanner.getState().setSaveAs(null); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    }
    setEditing(null); setText("");
  };
  const useMe = () => { p.setOrigin(null); setEditing(null); setText(""); };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[PAGE, { paddingBottom: space[10] * 3 }]}>
        <Text style={[type.largeTitle, styles.title, { color: c.text }]} accessibilityRole="header">¿Cómo llegar?</Text>
        <View style={{ paddingHorizontal: space[5] }}><TripBanner /></View>
        {saveAs ? (
          <View style={styles.pad}>
            <Card style={{ gap: space[1], borderWidth: 1.5, borderColor: c.accent }} >
              <Text style={[type.headline, { color: c.text }]}>{saveAs === "home" ? "¿Dónde queda tu casa?" : "¿Dónde queda tu trabajo?"}</Text>
              <Text style={[type.body, { color: c.muted }]}>Busca la dirección, una estación o una parada y la guardamos para llegar con un toque.</Text>
              <Tap onPress={() => { usePlanner.getState().setSaveAs(null); setEditing(null); }} accessibilityRole="button" accessibilityLabel="Cancelar"><Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>Cancelar</Text></Tap>
            </Card>
          </View>
        ) : null}

        <View style={styles.pad}>
          <Card style={styles.fields}>
            <FieldRow dot="#3b82f6" label="Desde" value={p.origin?.name ?? "Mi ubicación"} active={editing === "origin"} text={text} onFocus={() => { setEditing("origin"); setText(""); }} onChange={setText} />
            <View style={[styles.sep, { backgroundColor: c.line }]} />
            <FieldRow dot={c.accent} label="Hasta" value={p.dest?.name ?? ""} placeholder="¿A dónde vas?" active={editing === "dest"} text={text} onFocus={() => { setEditing("dest"); setText(""); }} onChange={setText} />
            <Tap onPress={() => void p.swap()} accessibilityRole="button" accessibilityLabel="Intercambiar origen y destino" style={[styles.swap, { backgroundColor: c.ink }]}>
              <SymbolView name="arrow.up.arrow.down" tintColor={c.onInk} size={16} />
            </Tap>
          </Card>
        </View>

        {editing ? (
          <View style={styles.pad}>
            {editing === "origin" ? <Row symbol="location.fill" title="Mi ubicación" sub="Usar donde estoy ahora" onPress={useMe} /> : null}
            {local.map((r) => <Row key={`l${r.name}${r.position.lat}`} symbol={r.kind === "Portal" ? "building.2.fill" : r.kind === "Estación" ? "tram.fill" : "signpost.right.fill"} tint={r.kind === "Paradero" ? SYSTEM_COLOR.zonal : SYSTEM_COLOR.troncal} title={r.name} sub={r.detail} onPress={() => choose(r)} />)}
            {remote.map((r) => <Row key={`r${r.name}${r.position.lat}`} symbol="mappin.circle.fill" title={r.name.split(" · ")[0]!} sub={`Dirección o lugar · ${r.name.split(" · ").slice(1).join(" · ") || "Bogotá"}`} onPress={() => choose(r)} />)}
            {busy ? <ActivityIndicator style={{ marginTop: space[3] }} /> : null}
            {text.trim().length >= 3 && !busy && !local.length && !remote.length ? <Text style={[type.body, { color: c.muted, padding: space[3] }]}>No encontramos «{text.trim()}». Prueba con una estación, una calle con número o un lugar conocido.</Text> : null}
          </View>
        ) : p.dest ? (
          <>
            <SavePlace dest={p.dest} />
            <WhenRow when={p.when} onChange={p.setWhen} />
            <View style={[styles.pad, { marginBottom: space[4] }]}>
              <Text style={[type.caption, { color: c.muted, marginBottom: space[2] }]}>Viajar en</Text>
              <View style={styles.chips}>
                {TRAVEL_MODES.map((m) => <Chip key={m.key} label={m.label} selected={p.modes[m.key]} dot={SYSTEM_COLOR[m.systems[0]!]} onPress={() => p.toggleMode(m.key)} />)}
              </View>
            </View>
            <Results />
          </>
        ) : (
          <View style={styles.pad}>
            <Card><Text style={[type.headline, { color: c.text }]}>Elige un destino</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Te mostramos las mejores opciones con los buses que van en vivo, los trasbordos y cuánto caminas.</Text></Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FieldRow({ dot, label, value, placeholder, active, text, onFocus, onChange }: { dot: string; label: string; value: string; placeholder?: string; active: boolean; text: string; onFocus(): void; onChange(t: string): void }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <View style={[styles.fdot, { backgroundColor: dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: c.muted }]}>{label}</Text>
        <TextInput accessibilityLabel={label} value={active ? text : value} placeholder={placeholder} placeholderTextColor={c.muted} onFocus={onFocus} onChangeText={onChange}
          autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" style={[type.headline, { color: c.text, paddingVertical: 2, marginRight: 44 }]} />
      </View>
    </View>
  );
}

function Row({ symbol, title, sub, tint, onPress }: { symbol: React.ComponentProps<typeof SymbolView>["name"]; title: string; sub?: string; /** Color del círculo del icono (rojo: TransMilenio; azul: paradero). */ tint?: string; onPress(): void }) {
  const c = useColors();
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} style={styles.sugg}>
      <View style={[styles.sico, { backgroundColor: tint ?? c.cardAlt }]}><SymbolView name={symbol} tintColor={tint ? "#ffffff" : c.text} size={16} /></View>
      <View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{title}</Text>{sub ? <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{sub}</Text> : null}</View>
    </Tap>
  );
}

/** «Guardar como casa / trabajo» para el destino que se está viendo. */
function SavePlace({ dest }: { dest: PlanPlace }) {
  const c = useColors();
  const saved = useSaved();
  const same = (p: PlanPlace | null) => !!p && Math.abs(p.position.lat - dest.position.lat) < 1e-5 && Math.abs(p.position.lon - dest.position.lon) < 1e-5;
  const slots = (["home", "work"] as const).filter((s) => !same(saved[s]));
  if (!slots.length) return null;
  return (
    <View style={[styles.pad, { flexDirection: "row", gap: space[4] }]}>
      {slots.map((s) => <Tap key={s} onPress={() => saved.setPlace(s, dest)} accessibilityRole="button" accessibilityLabel={`Guardar como ${s === "home" ? "casa" : "trabajo"}`}><Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>Guardar como {s === "home" ? "casa" : "trabajo"}</Text></Tap>)}
    </View>
  );
}

function WhenRow({ when, onChange }: { when: When; onChange(w: When): void }) {
  const c = useColors();
  const [time, setTime] = useState(() => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); return d; });
  const apply = (mode: "depart" | "arrive", t: Date) => { const at = t.getTime() < Date.now() - 60_000 ? t.getTime() + 86_400_000 : t.getTime(); onChange({ mode, at }); };
  return (
    <View style={styles.pad}>
      <View style={styles.chips}>
        <Chip label="Salir ahora" selected={when.mode === "now"} onPress={() => onChange({ mode: "now" })} />
        <Chip label="Salir a las…" selected={when.mode === "depart"} onPress={() => apply("depart", time)} />
        <Chip label="Llegar a las…" selected={when.mode === "arrive"} onPress={() => apply("arrive", time)} />
      </View>
      {when.mode !== "now" ? (
        <View style={styles.pickerRow}>
          <Text style={[type.body, { color: c.muted }]}>{when.mode === "depart" ? "Hora de salida" : "Hora de llegada"}</Text>
          <DateTimePicker value={time} mode="time" display="compact" locale="es-CO" onChange={(_, d) => { if (d) { setTime(d); apply(when.mode as "depart" | "arrive", d); } }} />
        </View>
      ) : null}
    </View>
  );
}

function Results() {
  const c = useColors();
  const p = usePlanner();
  const now = useNow() / 1000;
  const list = sorted(p.results, p.sortBy);
  const noService = p.when.mode === "now" && nowMode() === "none";

  if (p.busy && !p.results) return <View style={styles.pad}><Card><Text style={[type.headline, { color: c.text }]}>Buscando cómo llegar…</Text><Text style={[type.body, { color: c.muted }]}>Combinando rutas y buses que van en vivo.</Text></Card></View>;
  if (!p.results) return null;
  if (!list.length) return (
    <View style={styles.pad}>
      <Card>
        <Text style={[type.headline, { color: c.text }]}>{noService ? "Ahora no hay buses en servicio" : "No encontramos una forma de llegar"}</Text>
        <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{noService
          ? "TransMilenio no está reportando buses en este momento. Elige «Salir a las…» o «Llegar a las…» y una hora (por ejemplo, mañana 5:00 a. m.) para ver las rutas que funcionan a esa hora."
          : "Prueba moviendo el origen o el destino unos metros, o cambiando la hora."}</Text>
      </Card>
    </View>
  );
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingHorizontal: space[5] }]}>
        {SORTS.map(([k, l]) => <Chip key={k} label={l} selected={p.sortBy === k} onPress={() => p.setSort(k)} />)}
      </ScrollView>
      <View style={[styles.pad, { gap: space[3], marginTop: space[3] }]}>
        {nowMode() === "schedule" && p.when.mode === "now" ? <Text style={[type.caption, { color: c.muted }]}>Sin buses en vivo: tiempos según horarios.</Text> : null}
        {list.map((it, i) => <TripCard key={i} it={it} open={i === p.sel} onPress={() => p.select(i)} now={now} />)}
        <Text style={[type.caption, { color: c.muted }]}>Tiempos estimados con los buses en vivo o el horario; pueden cambiar. Caminatas en línea recta con un margen por las calles.</Text>
      </View>
    </>
  );
}

function TripCard({ it, open, onPress, now }: { it: Itinerary; open: boolean; onPress(): void; now: number }) {
  const c = useColors();
  const first = it.legs.find(isRide);
  return (
    <Tap still onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${durText(it.seconds)}, llegas ${hm(it.arriveAt)}, ${transfersText(it.transfers)}`}>
      <Card style={open ? { borderWidth: 1.5, borderColor: c.accent } : undefined}>
        <View style={styles.tripTop}>
          <View style={{ flex: 1, gap: space[1] }}>
            <View style={styles.tags}>{it.tags.map((t) => <View key={t} style={[styles.tag, { backgroundColor: t === "Más rápida" ? c.accent : c.cardAlt }]}><Text style={[type.caption, { color: t === "Más rápida" ? c.onAccent : c.text }]}>{t}</Text></View>)}</View>
            <View style={styles.chain}>
              {it.legs.map((l, i) => (
                <View key={i} style={styles.chainItem}>
                  {i > 0 ? <SymbolView name="chevron.right" tintColor={c.muted} size={10} /> : null}
                  {isRide(l) ? (transit.routeById(l.routeId) ? <RouteBadge route={transit.routeById(l.routeId)!} /> : <Text style={[type.caption, { color: c.text }]}>{l.shortName}</Text>)
                    : <View style={styles.walk}><SymbolView name="figure.walk" tintColor={c.muted} size={14} /><Text style={[type.caption, { color: c.muted }]}>{mins(l.seconds)} min</Text></View>}
                </View>
              ))}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[type.title, { color: c.text }]}>{durText(it.seconds)}</Text>
            <Text style={[type.caption, { color: c.muted }]}>llegas {hm(it.arriveAt)}</Text>
          </View>
        </View>
        <Text style={[type.caption, { color: c.muted, marginTop: space[2] }]}>
          {first ? `${transfersText(it.transfers)} · caminas ${meters(it.walkMeters)}` : `Caminando · ${meters(it.walkMeters)}`}
          {first && first.waitKind === "live" ? ` · ${first.shortName} llega en ${etaText(first.departAt, now)} (en vivo)` : ""}
        </Text>
        {open ? (
          <View style={{ marginTop: space[3], gap: space[3] }}>
            {it.legs.map((l, i) => isWalk(l) ? (
              <View key={i} style={styles.step}><SymbolView name="figure.walk" tintColor={c.muted} size={18} /><View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]}>Camina {durText(l.seconds)} ({meters(l.meters)})</Text><Text style={[type.caption, { color: c.muted }]}>hasta {l.toName}</Text></View></View>
            ) : (
              <Tap key={i} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: l.board.id, route: l.routeId } })} accessibilityRole="button" accessibilityLabel={`Ver el bus ${l.shortName} en vivo y sus paradas`} style={styles.step}>
                {transit.routeById(l.routeId) ? <RouteBadge route={transit.routeById(l.routeId)!} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]}>{l.headsign ? `Hacia ${l.headsign}` : `${SYSTEM_LABEL[l.system]} ${l.shortName}`}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>Sube en {l.board.name}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{l.waitKind === "live" ? `El bus llega en ${etaText(l.departAt, now)} (en vivo)` : `Pasa cada ~${mins(l.headwaySeconds)} min · espera aprox. ${durText(l.waitSeconds)}`}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{l.stops} {l.stops === 1 ? "parada" : "paradas"} · {durText(l.rideSeconds)}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>Baja en {l.alight.name}</Text>
                  {l.lowFrequency ? <Text style={[type.caption, { color: "#d97706" }]}>Pasa con poca frecuencia (cada ~{mins(l.headwaySeconds)} min).</Text> : null}
                  <Text style={[type.caption, { color: c.accent, marginTop: 2 }]}>Ver bus más cercano, seguirlo en vivo y sus paradas ›</Text>
                </View>
              </Tap>
            ))}
            <View style={styles.step}><SymbolView name="mappin.circle.fill" tintColor={c.accent} size={18} /><Text style={[type.headline, { color: c.text }]}>Llegas a las {hm(it.arriveAt)}</Text></View>
            {first ? <PrimaryButton label="Seguir este viaje" symbol="bell.fill" a11y="Seguir este viaje: te avisamos cuándo subir, cuándo bajar y qué sigue" onPress={() => { void allowAlerts(); useTrip.getState().start(it, usePlanner.getState().dest); router.push("/trip"); }} /> : null}
          </View>
        ) : null}
      </Card>
    </Tap>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { paddingHorizontal: space[5], paddingTop: space[2], marginBottom: space[4] },
  pad: { paddingHorizontal: space[5], marginTop: space[3] },
  fields: { padding: 0, paddingVertical: space[2] },
  field: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  fdot: { width: 12, height: 12, borderRadius: 6 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space[10] },
  swap: { position: "absolute", right: space[3], top: "50%", marginTop: -20, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sugg: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3] },
  sico: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", gap: space[2] },
  pickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[3] },
  tripTop: { flexDirection: "row", gap: space[3] },
  tags: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  tag: { paddingHorizontal: space[2], minHeight: 22, borderRadius: radius.pill, justifyContent: "center" },
  chain: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1] },
  chainItem: { flexDirection: "row", alignItems: "center", gap: space[1] },
  walk: { flexDirection: "row", alignItems: "center", gap: 2 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
});
