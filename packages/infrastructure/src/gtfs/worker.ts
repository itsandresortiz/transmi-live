/// <reference lib="webworker" />
import { parseGtfsLite } from "./parse";

/** Procesa el GTFS fuera del hilo principal para que la pantalla no se congele. */
self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    const dto = await parseGtfsLite(e.data);
    (self as unknown as Worker).postMessage({ ok: true, dto });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
