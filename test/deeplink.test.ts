import { describe, expect, it } from "vitest";
import { formatHash, parseHash, shareUrl, type Target } from "../apps/web/src/deeplink";

describe("enlaces", () => {
  const casos: Target[] = [
    { kind: "ruta", id: "M82" },
    { kind: "ruta", id: "B 10", direction: "1" },
    { kind: "parada", id: "700123" },
    { kind: "estacion", ids: ["a/1", "b,2", "c"] },
  ];
  it.each(casos)("ida y vuelta %j", (t) => {
    const back = parseHash(formatHash(t));
    expect(back?.kind).toBe(t.kind);
    if (t.kind === "estacion") expect(back).toEqual(t);
    else expect(back).toMatchObject({ id: (t as { id: string }).id });
  });
  it("enlace de un viaje: con origen y desde «mi ubicación»", () => {
    const a: Target = { kind: "viaje", from: { lat: 4.7357, lon: -74.0905, name: "Suba · Gratamira" }, to: { lat: 4.684, lon: -74.0577, name: "Calle 100, Bogotá" } };
    expect(parseHash(formatHash(a))).toEqual(a);
    const b: Target = { kind: "viaje", from: null, to: { lat: 4.6, lon: -74.1, name: "Portal Sur" } };
    expect(formatHash(b)).toMatch(/^#\/viaje\/-\//);
    expect(parseHash(formatHash(b))).toEqual(b);
    expect(parseHash("#/viaje/-/xx,yy,Nada")).toBeNull();
  });
  it("ignora lo que no es un enlace", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#/otra/cosa")).toBeNull();
    expect(parseHash("#/ruta/")).toBeNull();
  });
  it("arma la dirección completa", () => {
    expect(shareUrl({ kind: "parada", id: "9" }, { origin: "https://x.io", pathname: "/transmi-live/" })).toBe("https://x.io/transmi-live/#/parada/9");
  });
});
