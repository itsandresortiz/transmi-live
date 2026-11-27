import { describe, expect, it } from "vitest";
import { EtaHold } from "../src";

describe("la cuenta regresiva no sube de golpe", () => {
  it("si la nueva hora es un poco más tarde, la cuenta se queda quieta hasta alcanzarla", () => {
    const h = new EtaHold();
    expect(h.smooth("b", "P", 1000 + 70, 1000)).toBe(1070);          // faltan 70 s
    // 5 s después llega un lote: el bus quedó atrás, ahora dice 1110 (faltarían 105 s): se muestran los mismos 70 s
    expect(h.smooth("b", "P", 1110, 1005) - 1005).toBe(70);
    expect(h.smooth("b", "P", 1110, 1020) - 1020).toBe(70);          // sigue esperando
    expect(h.smooth("b", "P", 1110, 1045) - 1045).toBe(65);          // ya la alcanzó: vuelve a bajar
  });
  it("un atraso grande se muestra tal cual, y llegar antes también", () => {
    const h = new EtaHold();
    h.smooth("b", "P", 1060, 1000);
    expect(h.smooth("b", "P", 1300, 1005)).toBe(1300);
    expect(h.smooth("b", "P", 1100, 1010)).toBe(1100);
  });
});
