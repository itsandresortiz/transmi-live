import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* sin soporte: la app funciona igual */ }); });
  // un rato después de abrir (para no competir con lo que se está cargando), guardar el mapa base de Bogotá a zoom bajo para verlo sin señal;
  // no se hace con el ahorro de datos activado. Solo se baja de nuevo cuando cambia la versión del mapa o cada 30 días (ver `sw.js`)
  window.setTimeout(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!navigator.onLine || saveData) return;
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "tm-precargar-mapa" })).catch(() => undefined);
  }, 45_000);
}
