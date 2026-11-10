import * as Notifications from "expo-notifications";

/** Avisos del viaje («prepárate», «bájate aquí»). Son notificaciones locales del teléfono: no pasan por ningún servidor ni se envía nada. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const IDS = ["ride-3", "ride-1", "ride-0"] as const;
export type RideAlert = (typeof IDS)[number];

/** Lo que cada aviso lleva consigo para que, al tocarlo, la app abra ese viaje (y lo recupere si la app se había cerrado). */
export interface RideData { busId: string; alightId: string; total: number }

/** Llama a `open` cuando la persona toca un aviso del viaje, también si con ese toque se abrió la app. Devuelve cómo dejar de escuchar. */
export function onAlertTap(open: (d: RideData) => void): () => void {
  let last = "";
  const handle = (r: Notifications.NotificationResponse | null) => {
    const req = r?.notification.request, d = req?.content.data as Partial<RideData> | undefined;
    if (!req || !d || typeof d.busId !== "string" || typeof d.alightId !== "string") return;
    const key = req.identifier + r!.notification.date;
    if (key === last) return;
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
export async function schedule(id: RideAlert, at: number, title: string, body: string, data: RideData): Promise<void> {
  try {
    const when = at * 1000;
    if (when < Date.now() + 2000) { await Notifications.cancelScheduledNotificationAsync(id); return; }
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { ...data }, sound: true, interruptionLevel: "timeSensitive" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when) },
    });
  } catch { /* sin permiso o sin soporte: la vibración y la pantalla siguen avisando */ }
}

export async function cancelAlerts(): Promise<void> {
  try { await Promise.all(IDS.map((i) => Notifications.cancelScheduledNotificationAsync(i))); } catch { /* nada que cancelar */ }
}
