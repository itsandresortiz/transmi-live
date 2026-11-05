import { type Stop, type StopLabel, stopLabelText } from "@transmi/domain";
import { transit } from "../composition-root";

/** Etiqueta de una parada: nombre limpio y vagón (estaciones) o plataforma (portales). */
export const labelOf = (stop: Stop | undefined): StopLabel | undefined => (stop ? transit.labelOf(stop) : undefined);
/** «Toberín · vagón 2», «Portal Norte · T1» o el nombre solo. */
export const stopText = (stop: Stop | undefined, fallback = ""): string => (stop ? stopLabelText(transit.labelOf(stop)) : fallback);
/** Solo la etiqueta corta: «Vagón 2», «Plataforma T1» o nada. */
export function stopTag(stop: Stop | undefined): string {
  const l = labelOf(stop);
  return l?.wagon ? `Vagón ${l.wagon}` : l?.platform ? `Plataforma ${l.platform}` : "";
}
/** «Estación» (troncal, con vagones), «Portal» (plataformas) o «Parada». */
export function stopKind(stop: Stop | undefined): "Estación" | "Portal" | "Parada" {
  const l = labelOf(stop);
  return l?.wagon ? "Estación" : l?.platform ? "Portal" : "Parada";
}
/** Código de la parada sin el sufijo interno «_TM» («304B00_TM» → «304B00»). */
export const stopCode = (stop: Stop | undefined): string => (stop?.code ?? "").replace(/_TM$/i, "");
