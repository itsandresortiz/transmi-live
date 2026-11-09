import * as Location from "expo-location";

/** Pide permiso (solo con la app abierta) y devuelve dónde estás, o null si no hay permiso o no se pudo. */
export async function locateMe(): Promise<{ lat: number; lon: number } | null> {
  try {
    const cur = await Location.getForegroundPermissionsAsync();
    const perm = cur.granted ? cur : await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
  } catch { return null; }
}
