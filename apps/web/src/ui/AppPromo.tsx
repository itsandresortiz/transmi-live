import { useEffect, useState } from "react";
import { safeStorage } from "../storage";
import { Close } from "./icons";

/** La app de iPhone ya está en el App Store: se anuncia una sola vez con una tarjeta, y queda siempre a la mano en Ajustes. */
export const APP_STORE_URL = "https://apps.apple.com/app/transmi-live/id6832722895";
const KEY = "tm.iosapp.v1";

/** A quién se le muestra: a quien entra desde un iPhone o desde un computador (para que lo abra luego en su iPhone). En Android todavía no hay app en la tienda. */
export function showsIosApp(): boolean {
  return !/android/i.test(navigator.userAgent);
}

export function AppPromo() {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!showsIosApp() || safeStorage.get(KEY)) return;
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
  const phone = /iphone|ipod/i.test(navigator.userAgent);
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
        <h2 id="promo-t">Ya estamos en el App Store</h2>
        <p className="promo-sub">TransMi LIVE ahora es una app para iPhone. Gratis y sin anuncios.</p>
        <ul className="promo-list">
          <li><b>Saldo de tu TuLlave</b><span>Acerca la tarjeta al iPhone y míralo al instante.</span></li>
          <li><b>Avisos de tu viaje</b><span>Te avisa cuándo subir y cuándo prepararte para bajar.</span></li>
          <li><b>Tu parada en la pantalla de inicio</b><span>Los próximos buses, sin abrir la app.</span></li>
        </ul>
        <a className="promo-cta" href={APP_STORE_URL} target="_blank" rel="noopener" onClick={close}>
          <small>{phone ? "Descárgala en el" : "Ábrela en tu iPhone desde el"}</small><b>App Store</b>
        </a>
        <button className="promo-later" onClick={close}>Ahora no</button>
      </section>
    </>
  );
}
