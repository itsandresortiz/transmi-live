import * as Notifications from "expo-notifications";

/** Avisos del viaje («prepárate», «bájate aquí»). Son notificaciones locales del teléfono: no pasan por ningún servidor ni se envía nada. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const IDS = ["ride-3", "ride-1", "ride-0"] as const;
export type RideAlert = (typeof IDS)[number];

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
export async function schedule(id: RideAlert, at: number, title: string, body: string): Promise<void> {
  try {
    const when = at * 1000;
    if (when < Date.now() + 2000) { await Notifications.cancelScheduledNotificationAsync(id); return; }
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, sound: true, interruptionLevel: "timeSensitive" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when) },
    });
  } catch { /* sin permiso o sin soporte: la vibración y la pantalla siguen avisando */ }
}

export async function cancelAlerts(): Promise<void> {
  try { await Promise.all(IDS.map((i) => Notifications.cancelScheduledNotificationAsync(i))); } catch { /* nada que cancelar */ }
}
