import { describe, expect, it } from "vitest";
import { routeCodes, routeOfficialName, routeTitle, routeVariant, type Route } from "../src";
const r = (longName: string) => ({ id: "x", shortName: "M82", longName, system: "sitp" }) as unknown as Route;
describe("routeTitle", () => {
  it("limpia códigos y conserva el nombre oficial", () => {
    const x = r("M82 CLL134 KR 7 || L82 Portal 20 de Julio Ciclovía");
    expect(routeTitle(x)).toContain("Calle 134");
    expect(routeTitle(x)).not.toContain("M82");
    expect(routeOfficialName(x)).toBe("M82 CLL134 KR 7 || L82 Portal 20 de Julio Ciclovía");
  });
});

describe("códigos y variantes", () => {
  it("separa los códigos de las rutas SITP pareadas", () => {
    expect(routeCodes(r("K635 Suba || H635 Tibabuyes"))).toEqual(["K635", "H635"]);
    expect(routeCodes(r("M82 CLL134 KR 7 || L82 Portal 20 de Julio Ciclovía"))).toEqual(["M82", "L82"]);
  });
  it("sin códigos en el nombre devuelve el del feed", () => {
    expect(routeCodes(r("Portal Norte - Portal Sur"))).toEqual(["M82"]);
  });
  it("reconoce la variante al final del nombre", () => {
    expect(routeVariant(r("M82 A || L82 B Ciclovía"))).toBe("Ciclovía");
    expect(routeVariant(r("M82 A || L82 B"))).toBeNull();
  });
});
