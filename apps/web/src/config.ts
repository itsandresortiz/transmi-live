export const CONFIG = {
  /** Función de Supabase que lee TransMilenio con CORS (ver supabase/functions/tm). */
  proxyUrl: "https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder",
  /** Copia de respaldo y GTFS reducido, publicados por GitHub Actions en la rama live-data. */
  dataBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/",
  /** Mensajes del dueño (accidentes, manifestaciones…): un archivo que se edita a mano en la raíz del repositorio. */
  messagesUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/mensajes.json",
  /** Horarios resumidos (primer y último viaje de cada ruta), publicados cada día por GitHub Actions. */
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
  /** Edificios de Catastro de Bogotá para la vista 3D, por celdas (los publica el workflow «Árboles y edificios para el mapa 3D», ver
   *  tools/edificios.ts). Si la rama aún no existe, siguen los edificios del mapa base. */
  buildingsBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/edificios/",
  /** Posiciones compartidas por quienes van en un bus (archivo público que publica la función de Supabase «viajes»; ver
   *  supabase/LEEME-avisos.md). `null` = apagado (no se pide nada). */
  sharedRidesUrl: null as string | null,
} as const;
