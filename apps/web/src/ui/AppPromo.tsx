import { useEffect, useState } from "react";
import { safeStorage } from "../storage";
import { Close } from "./icons";

/** La app ya está en el App Store y en Google Play: se anuncia una sola vez con una tarjeta, y queda siempre a la mano en Ajustes. */
export const APP_STORE_URL = "https://apps.apple.com/app/transmi-live/id6832722895";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.transmilive.app";
/** v1: el anuncio de cuando solo había app de iPhone; v2: ya también en Google Play. */
const KEY_IOS = "tm.iosapp.v1", KEY = "tm.apps.v2";

/** En qué teléfono se abre la web: a cada uno se le ofrece su tienda; en un computador, las dos. */
export function platform(): "android" | "ios" | "desktop" {
  const ua = navigator.userAgent;
  return /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "desktop";
}

export function AppPromo() {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // a quien ya cerró el anuncio en su iPhone no se le vuelve a mostrar (para él no cambió nada); a los de Android y computador, sí
    if (safeStorage.get(KEY) || (platform() === "ios" && safeStorage.get(KEY_IOS))) return;
    // se espera a que el mapa y los buses ya estén en pantalla: no se le atraviesa a nadie apenas abre
    const id = setTimeout(() => { setShown(true); requestAnimationFrame(() => setOn(true)); }, 3500);
    return () => clearTimeout(id);
  }, []);
  const close = () => { safeStorage.set(KEY, "1"); setOn(false); setTimeout(() => setShown(false), 320); };
  useEffect(() => {
    if (!on) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [on]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const p = platform();
  const store = p === "android" ? "Google Play" : p === "ios" ? "el App Store" : "el App Store y Google Play";
  return (
    <>
      <div className={`promo-scrim${on ? " on" : ""}`} onClick={close} />
      <section className={`promo${on ? " on" : ""}`} role="dialog" aria-modal="true" aria-labelledby="promo-t">
        <button className="promo-x" aria-label="Cerrar" onClick={close}><Close /></button>
        <div className="promo-hero" aria-hidden="true">
          <span className="promo-ring r1" /><span className="promo-ring r2" />
          <img src="apple-touch-icon.png" alt="" width="72" height="72" />
        </div>
        <span className="promo-new">Nuevo</span>
        <h2 id="promo-t">Ya estamos en {store}</h2>
        <p className="promo-sub">TransMi LIVE ahora es una app para {p === "android" ? "Android" : p === "ios" ? "iPhone" : "iPhone y Android"}. Gratis y sin anuncios.</p>
        <ul className="promo-list">
          <li><b>Saldo de tu TuLlave</b><span>Acerca la tarjeta al celular y míralo al instante.</span></li>
          <li><b>Avisos de tu viaje</b><span>Te avisa cuándo subir y cuándo prepararte para bajar.</span></li>
          <li><b>Tu parada en la pantalla de inicio</b><span>Los próximos buses, sin abrir la app.</span></li>
        </ul>
        {p !== "android" ? (
          <a className="promo-cta" href={APP_STORE_URL} target="_blank" rel="noopener" onClick={close}>
            <small>{p === "ios" ? "Descárgala en el" : "Para iPhone, en el"}</small><b>App Store</b>
          </a>
        ) : null}
        {p !== "ios" ? (
          <a className={`promo-cta${p === "desktop" ? " alt" : ""}`} href={PLAY_STORE_URL} target="_blank" rel="noopener" onClick={close}>
            <small>{p === "android" ? "Descárgala en" : "Para Android, en"}</small><b>Google Play</b>
          </a>
        ) : null}
        <button className="promo-later" onClick={close}>Ahora no</button>
      </section>
    </>
  );
}
