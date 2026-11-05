import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* sin soporte: la app funciona igual */ }); });
}
