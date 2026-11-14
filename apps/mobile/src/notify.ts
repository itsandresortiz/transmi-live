import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/** Avisos del viaje («prepárate», «bájate aquí»). Son notificaciones locales del teléfono: no pasan por ningún servidor ni se envía nada. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** En Android los avisos van por un «canal» (el usuario puede ajustarlo en los ajustes del teléfono). Este es de importancia alta: suena y aparece encima de lo que se esté haciendo. */
const CHANNEL = "viaje";
if (Platform.OS === "android") {
  void Notifications.setNotificationChannelAsync(CHANNEL, { name: "Avisos del viaje", description: "Cuándo subir, cuándo prepararte para bajar y dónde bajarte.", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC }).catch(() => undefined);
}

const IDS = ["ride-3", "ride-1", "ride-0"] as const;
export type RideAlert = (typeof IDS)[number];

/** Lo que cada aviso lleva consigo para que, al tocarlo, la app abra ese viaje (y lo recupere si la app se había cerrado). */
export interface RideData { busId: string; alightId: string; total: number }

/** Llama a `open` cuando la persona toca un aviso del viaje, también si con ese toque se abrió la app. Devuelve cómo dejar de escuchar. */
export function onAlertTap(open: (d: RideData) => void, openTrip?: () => void): () => void {
  let last = "";
  const handle = (r: Notifications.NotificationResponse | null) => {
    const req = r?.notification.request, d = req?.content.data as (Partial<RideData> & { trip?: boolean }) | undefined;
    if (!req || !d) return;
    const key = req.identifier + r!.notification.date;
    if (key === last) return;
    if (d.trip === true) { last = key; openTrip?.(); return; }
    if (typeof d.busId !== "string" || typeof d.alightId !== "string") return;
    last = key;
    open({ busId: d.busId, alightId: d.alightId, total: typeof d.total === "number" ? d.total : 0 });
  };
  try {
    void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  } catch { return () => undefined; }
}

/** Pide el permiso de notificaciones (solo la primera vez pregunta). Devuelve si se puede avisar. */
export async function allowAlerts(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (!cur.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch { return false; }
}

/** Programa (o reprograma) un aviso para la hora `at` (segundos desde 1970). Si esa hora ya pasó no hace nada. */
/** Hora (ms) para la que quedó programado cada aviso. Si esa hora ya llegó, el aviso ya sonó: no se vuelve a programar en este viaje.
 *  Sin esto, «Bájate aquí» sonaba varias veces: cada dato nuevo del bus corre la hora estimada un poco más tarde y el aviso se reprogramaba
 *  después de haber sonado. Se borra al empezar o terminar un viaje. */
const programmed = new Map<string, number>();
const alreadyRang = (id: string) => { const t = programmed.get(id); return t != null && t <= Date.now(); };

export async function schedule(id: RideAlert, at: number, title: string, body: string, data: RideData): Promise<void> {
  try {
    const when = at * 1000;
    if (alreadyRang(id)) return;
    if (when < Date.now() + 2000) { await Notifications.cancelScheduledNotificationAsync(id); return; }
    programmed.set(id, when);
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { ...data }, sound: true, interruptionLevel: "timeSensitive" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when), channelId: CHANNEL },
    });
  } catch { /* sin permiso o sin soporte: la vibración y la pantalla siguen avisando */ }
}

export async function cancelAlerts(): Promise<void> {
  for (const i of IDS) programmed.delete(i);
  try { await Promise.all(IDS.map((i) => Notifications.cancelScheduledNotificationAsync(i))); } catch { /* nada que cancelar */ }
}

/* ---------- avisos de un viaje de «Cómo llegar» (varios buses y caminatas) ---------- */
const TRIP = "trip-";
/** Deja programados exactamente estos avisos del viaje (los que ya pasaron o sobran se quitan). `at` en segundos. */
export async function scheduleTrip(alerts: readonly { id: string; at: number; title: string; body: string }[]): Promise<void> {
  try {
    const keep = new Set<string>();
    if (!alerts.length) for (const k of [...programmed.keys()]) if (k.startsWith(TRIP)) programmed.delete(k);      // el viaje terminó
    for (const a of alerts) {
      if (alreadyRang(TRIP + a.id)) continue;            // ya sonó: no se repite aunque la hora estimada se haya corrido
      if (a.at * 1000 < Date.now() + 2000) continue;
      keep.add(TRIP + a.id);
      programmed.set(TRIP + a.id, a.at * 1000);
      await Notifications.scheduleNotificationAsync({
        identifier: TRIP + a.id,
        content: { title: a.title, body: a.body, data: { trip: true }, sound: true, interruptionLevel: "timeSensitive" },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(a.at * 1000), channelId: CHANNEL },
      });
    }
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(all.filter((n) => n.identifier.startsWith(TRIP) && !keep.has(n.identifier)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch { /* sin permiso: la pantalla del viaje sigue guiando */ }
}
export const cancelTrip = (): Promise<void> => scheduleTrip([]);
