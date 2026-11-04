import { SYSTEMS, SYSTEM_LABEL } from "@transmi/domain";
import type { MapTheme } from "../map/theme";
import { Close } from "./icons";
import { useUi } from "./store";

const Switch = ({ label, on, set }: { label: string; on: boolean; set(v: boolean): void }) =>
  <button className="srow" role="switch" aria-checked={on} onClick={() => set(!on)}>{label}<span className="sw" aria-checked={on} /></button>;
const Seg = <T extends string>({ value, set, opts }: { value: T; set(v: T): void; opts: [T, string][] }) =>
  <div className="seg" style={{ margin: 0 }}>{opts.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}</div>;

export function Settings({ th }: { th: MapTheme }) {
  const u = useUi();
  return (
    <>
      <div className={`scrim${u.settingsOpen ? " on" : ""}`} onClick={() => u.setSettingsOpen(false)} />
      <section className={`settings glass${u.settingsOpen ? " on" : ""}`} role="dialog" aria-modal="true" aria-label="Ajustes del mapa">
        <div className="sh"><h2>Ajustes del mapa</h2><button className="fab" aria-label="Cerrar" onClick={() => u.setSettingsOpen(false)}><Close /></button></div>
        <div className="grp"><h3>Capas</h3><div className="box">
          <Switch label="Buses" on={u.layers.buses} set={(v) => u.setLayer("buses", v)} />
          <Switch label="Nombres de calles" on={u.layers.streets} set={(v) => u.setLayer("streets", v)} />
          <Switch label="Paradas" on={u.layers.stops} set={(v) => u.setLayer("stops", v)} />
          <Switch label="Líneas de rutas" on={u.layers.network} set={(v) => u.setLayer("network", v)} />
        </div></div>
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
        <p className="credits">Datos en tiempo real de TransMilenio (GTFS-realtime). Mapa: © OpenStreetMap contributors.</p>
      </section>
    </>
  );
}
