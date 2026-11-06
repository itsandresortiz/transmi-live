import { useEffect, useState } from "react";
import { SYSTEMS, SYSTEM_LABEL } from "@transmi/domain";
import type { MapTheme } from "../map/theme";
import { Close } from "./icons";
import { useUi } from "./store";
import { ServiceStats } from "./views";

const Switch = ({ label, on, set }: { label: string; on: boolean; set(v: boolean): void }) =>
  <button className="srow" role="switch" aria-checked={on} onClick={() => set(!on)}>{label}<span className="sw" aria-checked={on} /></button>;
const Seg = <T extends string>({ value, set, opts }: { value: T; set(v: T): void; opts: [T, string][] }) =>
  <div className="seg" style={{ margin: 0 }}>{opts.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}</div>;

interface InstallEvent extends Event { prompt(): Promise<void> }
export function Settings({ th }: { th: MapTheme }) {
  const u = useUi();
  const [ev, setEv] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const f = (e: Event) => { e.preventDefault(); setEv(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", f);
    return () => window.removeEventListener("beforeinstallprompt", f);
  }, []);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <>
      <div className={`scrim${u.settingsOpen ? " on" : ""}`} onClick={() => u.setSettingsOpen(false)} />
      <section className={`settings glass${u.settingsOpen ? " on" : ""}`} role="dialog" aria-modal="true" aria-label="Ajustes del mapa">
        <div className="sh"><h2>Ajustes del mapa</h2><button className="fab" aria-label="Cerrar" onClick={() => u.setSettingsOpen(false)}><Close /></button></div>
        <div className="grp"><h3>Estado del servicio</h3><ServiceStats /></div>
        <div className="grp"><h3>Capas</h3><div className="box">
          <Switch label="Buses" on={u.layers.buses} set={(v) => u.setLayer("buses", v)} />
          <Switch label="Nombres de calles" on={u.layers.streets} set={(v) => u.setLayer("streets", v)} />
          <Switch label="Paradas" on={u.layers.stops} set={(v) => u.setLayer("stops", v)} />
          <Switch label="Líneas de rutas" on={u.layers.network} set={(v) => u.setLayer("network", v)} />
          <Switch label="Tráfico (velocidad de los buses)" on={u.layers.traffic} set={(v) => u.setLayer("traffic", v)} />
          <Switch label="Semáforos" on={u.layers.signals} set={(v) => u.setLayer("signals", v)} />
        </div></div>
        {u.layers.traffic && (
          <div className="grp"><h3>Tráfico</h3>
            <div className="legend">
              {([["#e5484d", "Casi detenido"], ["#f08a24", "Lento"], ["#f5c518", "Normal"], ["#2fbf71", "Fluido"]] as const).map(([c, l]) => <span key={l} style={{ ["--c" as string]: c }}><i />{l}</span>)}
            </div>
            <p className="hint">Se calcula con la velocidad real de los buses del SITP (no incluye los carriles exclusivos de la troncal) y se actualiza con cada dato nuevo. Es una referencia aproximada.</p>
          </div>
        )}
        <div className="grp"><h3>Color de los buses</h3>
          <Seg value={u.colorMode} set={u.setColorMode} opts={[["system", "Por sistema"], ["delay", "Por puntualidad"]]} />
          <div className="legend">
            {u.colorMode === "system"
              ? SYSTEMS.map((s) => <span key={s} style={{ ["--c" as string]: th.system[s] }}><i />{SYSTEM_LABEL[s]}</span>)
              : ([["ok", "A tiempo"], ["warn", "Algo tarde"], ["bad", "Muy tarde"], ["early", "Adelantado"], ["none", "Sin dato"]] as const).map(([k, l]) => <span key={k} style={{ ["--c" as string]: th.delay[k] }}><i />{l}</span>)}
          </div>
        </div>
        <div className="grp"><h3>Movimiento</h3>
          <Seg value={u.motion} set={u.setMotion} opts={[["predict", "Suave (estimado)"], ["reported", "Solo reportado"]]} />
          <p className="hint">{u.motion === "predict" ? "Entre un reporte y otro, el bus sigue avanzando con la velocidad que traía, y se corrige en cuanto llega la posición real." : "El bus se mueve solo cuando TransMilenio informa una posición nueva."}</p>
        </div>
        <div className="grp"><h3>Tamaño del texto</h3>
          <div className="seg" style={{ margin: 0 }} role="group" aria-label="Tamaño del texto">
            {([[1, "Normal"], [1.15, "Grande"], [1.3, "Muy grande"]] as const).map(([v, l]) => <button key={v} aria-pressed={u.textScale === v} onClick={() => u.setTextScale(v)}>{l}</button>)}
          </div>
        </div>
        <div className="grp"><h3>Contraste</h3>
          <Seg value={u.highContrast ? "alto" : "normal"} set={(v: string) => u.setHighContrast(v === "alto")} opts={[["normal", "Normal"], ["alto", "Alto"]]} />
          <p className="hint">Bordes y textos más marcados para leer mejor al sol.</p>
        </div>
        {!standalone && (ev || ios) && (
          <div className="grp"><h3>Instalar</h3>
            {ev ? <button className="btn primary" onClick={() => void ev.prompt()}>Instalar TransMi LIVE en tu celular</button>
              : <p className="hint">En iPhone: toca el botón Compartir y luego «Añadir a pantalla de inicio».</p>}
          </div>
        )}
        <p className="credits">Datos en tiempo real de TransMilenio (GTFS-realtime). Mapa: © OpenStreetMap contributors. Semáforos: Secretaría Distrital de Movilidad (CC BY 4.0).</p>
      </section>
    </>
  );
}
