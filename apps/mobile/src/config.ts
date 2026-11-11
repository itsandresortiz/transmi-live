export const CONFIG = {
  /** Función de Supabase que lee TransMilenio (ver supabase/functions/tm). */
  proxyUrl: "https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder",
  /** Copia de respaldo y GTFS reducido, publicados por GitHub Actions en la rama live-data. */
  dataBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/",
  /** Horarios resumidos, publicados cada día por GitHub Actions. */
  /** Mensajes del dueño (accidentes, manifestaciones…): un archivo que se edita a mano en la raíz del repositorio. */
  messagesUrl: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/mensajes.json",
  scheduleBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/schedule-data/",
} as const;
