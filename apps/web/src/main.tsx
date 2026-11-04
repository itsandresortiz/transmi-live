import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  /* sin service worker por ahora: los datos son en vivo y no se cachean */
}
