import { describe, expect, it } from "vitest";
import { routeOfficialName, routeTitle, type Route } from "../src";
const r = (longName: string) => ({ id: "x", shortName: "M82", longName, system: "sitp" }) as unknown as Route;
describe("routeTitle", () => {
  it("limpia códigos y conserva el nombre oficial", () => {
    const x = r("M82 CLL134 KR 7 || L82 Portal 20 de Julio Ciclovía");
    expect(routeTitle(x)).toContain("Calle 134");
    expect(routeTitle(x)).not.toContain("M82");
    expect(routeOfficialName(x)).toBe("M82 CLL134 KR 7 || L82 Portal 20 de Julio Ciclovía");
  });
});
