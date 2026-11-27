export const CONFIG = {
  /** Función de Supabase que lee TransMilenio (ver supabase/functions/tm). */
  proxyUrl: "https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder",
  /** Copia de respaldo y GTFS reducido, publicados por GitHub Actions en la rama live-data. */
  dataBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/",
  /** Horarios resumidos, publicados cada día por GitHub Actions. */
  /** Mensajes del dueño (accidentes, manifestaciones…): un archivo que se edita a mano en la raíz del repositorio. */
  messagesUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/mensajes.json",
  scheduleBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/schedule-data/",
  /** Tiempos reales entre paradas por hora del día (los aprende el workflow «hop-stats»). */
  hopBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/hop-stats/",
  /** Semáforos medidos a mano y lo que los buses dicen de ellos (para sumar su espera a las llegadas, solo si los buses la confirman). */
  signalsUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/tools/data/mediciones-semaforos.json",
  signalLearningUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/signal-stats/aprendizaje.json",
  /** Huellas de los semáforos no medidos, sacadas de los buses detenidos (se usan solo si el archivo dice `use: true`). */
  footprintsUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/signal-stats/huellas.json",
  /** Árboles de verdad para la vista 3D, por celdas (los publica el workflow «Árboles para el mapa 3D», ver tools/arboles.ts). Si la rama
   *  aún no existe, el mapa siembra árboles dentro de los parques y ya. */
  treesBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/arboles/",
  /** Función de Supabase «viajes» (avisos del viaje que se corrigen con la app cerrada y posiciones compartidas). `null` = APAGADO:
   *  los avisos son solo del teléfono, como siempre. Se enciende cuando el dueño la despliegue (ver supabase/LEEME-avisos.md); los avisos
   *  remotos además necesitan compilar con TM_PUSH=1. Ejemplo: "https://<proyecto>.supabase.co/functions/v1/viajes". */
  ridesUrl: null as string | null,
  /** Posiciones compartidas vigentes (archivo público que publica la función «viajes»). `null` = apagado (no se pide nada). */
  sharedRidesUrl: null as string | null,
} as const;
