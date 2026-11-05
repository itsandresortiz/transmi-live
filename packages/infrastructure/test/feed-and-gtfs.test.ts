import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProxyLiveFeed, buildNetwork, parseGtfsLite } from "@transmi/infrastructure";

const fx = (n: string) => new Uint8Array(gunzipSync(readFileSync(fileURLToPath(new URL(`./fixtures/${n}.pb.gz`, import.meta.url)))));
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body), { status });

describe("fuente en vivo con respaldo", () => {
  const files: Record<string, Uint8Array> = { positions: fx("positions.a"), tripupdates: fx("tripupdates"), alerts: fx("alerts") };
  const make = (primaryUp: boolean, log: string[] = []) => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const u = String(input);
      log.push(u);
      if (u.startsWith("https://proxy.test")) {
        if (!primaryUp) throw new TypeError("network");
        if (u.includes("/meta")) return reply({ pos: "P1", tu: "T1", al: "A1" });
        const k = Object.keys(files).find((x) => u.includes(`/${x}?`))!;
        return reply(files[k]!);
      }
      if (u.includes("meta.json")) return reply({ pos: "P1", tu: "T1", al: "A1" });
      const k = Object.keys(files).find((x) => u.includes(`/${x}.pb`))!;
      return reply(files[k]!);
    }) as typeof fetch;
    return new ProxyLiveFeed({ primaryBase: "https://proxy.test/fn", fallbackBase: "https://raw.test/live/", fetchFn });
  };

  it("descarga posiciones, retrasos y avisos cuando hay datos nuevos", async () => {
    const poll = await make(true).poll({});
    expect(poll!.source).toBe("live");
    expect(poll!.batch.positions!.length).toBeGreaterThan(5000);
    expect(poll!.batch.tripUpdates!.length).toBeGreaterThan(3000);
    expect(poll!.batch.alerts!.length).toBeGreaterThan(100);
    expect(poll!.signature).toEqual({ pos: "P1", tu: "T1", al: "A1" });
  });
  it("no descarga nada si las huellas no cambiaron", async () => {
    const log: string[] = [];
    const poll = await make(true, log).poll({ pos: "P1", tu: "T1", al: "A1" });
    expect(poll).toBeNull();
    expect(log).toHaveLength(1); // solo la consulta mínima
  });
  it("usa la copia de respaldo si el intermediario falla, y lo marca como retrasada", async () => {
    const poll = await make(false).poll({});
    expect(poll!.source).toBe("delayed");
    expect(poll!.batch.positions!.length).toBeGreaterThan(5000);
  });
  it("falla con un mensaje claro si no hay ninguna fuente", async () => {
    const feed = new ProxyLiveFeed({ primaryBase: "https://x.test", fetchFn: (async () => { throw new TypeError("net"); }) as typeof fetch });
    await expect(feed.poll({})).rejects.toThrow(/Sin conexión/);
  });
  it("rechaza un lote cortado", async () => {
    const cut = files.positions!.subarray(0, Math.floor(files.positions!.length * 0.45));
    const fetchFn = (async (i: RequestInfo | URL) => String(i).includes("/meta") ? reply({ pos: "P2" }) : reply(cut)) as typeof fetch;
    await expect(new ProxyLiveFeed({ primaryBase: "https://p.test", fetchFn }).poll({})).rejects.toThrow();
  });
});

describe("lector del GTFS reducido", () => {
  async function sampleZip() {
    const z = new JSZip();
    z.file("routes.txt", 'route_id,route_short_name,route_long_name,route_desc,route_type,route_color,agency_id\nR1,B12,"Portal 80 || Calle 100",,3,,1\nR2,6-4,Alimentador Suba,,3,,1\nR3,C19,Kennedy || Centro,,3,,1\n');
    z.file("trips.txt", "route_id,trip_id,trip_headsign,direction_id,shape_id\nR1,T1,Calle 100,0,S1\nR1,T1b,Calle 100,0,S1\nR1,T2,Portal 80,1,S2\nR2,T3,,0,S3\nR3,T4,,,S4\n");
    z.file("stops.txt", "stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon\nA,1,Portal 80,,4.7136,-74.113\nB,2,Calle 76,,4.69,-74.099\nC,3,Calle 100,,4.683,-74.055\n");
    z.file("shapes.txt", "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS1,4.7136,-74.113,1\nS1,4.69,-74.099,2\nS1,4.683,-74.055,3\nS2,4.683,-74.055,1\nS2,4.7136,-74.113,2\nS3,4.6,-74.1,1\nS3,4.61,-74.11,2\nS4,4.62,-74.12,1\nS4,4.63,-74.13,2\n");
    z.file("stop_times.txt", "trip_id,stop_id,stop_sequence\nT1,A,1\nT1,B,2\nT1,C,3\nT2,C,1\nT2,A,2\n");
    return z.generateAsync({ type: "uint8array" });
  }
  it("lee rutas, paradas, destinos y recorridos", async () => {
    const net = buildNetwork(await parseGtfsLite(await sampleZip()));
    expect(net.routes.size).toBe(3);
    expect(net.routes.get("R1")!.system).toBe("troncal");
    expect(net.routes.get("R2")!.system).toBe("alimentador");
    expect(net.stops.get("A")!.name).toBe("Portal 80");
    expect(net.headsigns.get("R1")).toEqual(expect.arrayContaining(["Calle 100", "Portal 80"]));
    const shapes = net.shapesOf("R1");
    expect(shapes).toHaveLength(2); // ida y vuelta
    const ida = shapes.find((s) => s.direction === "0")!;
    expect(ida.stopIds).toEqual(["A", "B", "C"]);
    expect(ida.points.length).toBeGreaterThanOrEqual(3);
    expect(net.isLoaded).toBe(true);
  });
  it("trata los viajes sin sentido como sentido 0", async () => {
    const net = buildNetwork(await parseGtfsLite(await sampleZip()));
    expect(net.shapesOf("R3")[0]!.direction).toBe("0");
  });
});

describe("reloj del servidor", () => {
  it("mide cuánto se adelanta o atrasa el reloj del dispositivo respecto al servidor", async () => {
    const offsets: number[] = [];
    const serverNow = Math.floor(Date.now() / 1000) + 90;           // el dispositivo está 90 s atrasado respecto al servidor
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith("/meta")) return new Response(JSON.stringify({ pos: "p1", at: serverNow }), { status: 200 });
      return new Response(new Uint8Array(), { status: 200 });
    }) as unknown as typeof fetch;
    const feed = new ProxyLiveFeed({ primaryBase: "https://x/fn", fetchFn, onClock: (ms) => offsets.push(ms) });
    await feed.poll({ pos: "p1" }).catch(() => null);               // sin cambios: igual se mide el reloj
    expect(offsets).toHaveLength(1);
    expect(offsets[0]!).toBeGreaterThan(88_000);
    expect(offsets[0]!).toBeLessThan(92_000);
  });
});
