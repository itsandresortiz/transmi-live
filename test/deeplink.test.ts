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
  it("ignora lo que no es un enlace", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#/otra/cosa")).toBeNull();
    expect(parseHash("#/ruta/")).toBeNull();
  });
  it("arma la dirección completa", () => {
    expect(shareUrl({ kind: "parada", id: "9" }, { origin: "https://x.io", pathname: "/transmi-live/" })).toBe("https://x.io/transmi-live/#/parada/9");
  });
});
