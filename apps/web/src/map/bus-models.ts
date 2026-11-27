import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type CustomLayerInterface, type CustomRenderMethodInput, LngLat, type Map as MLMap } from "maplibre-gl";
import { mixHex } from "@transmi/application";
import { GROUPS, type Group, type Parts, articulatedBus, standardBus } from "./bus-geometry";
import type { BusDraw } from "./BusCanvas";

/** Buses modelados en 3D (vista 3D de cerca, solo en la web): una capa propia de MapLibre que dibuja con three.js.
 *
 *  Por qué: con `fill-extrusion` (cajas con paredes verticales) las curvas salían en escalones: ruedas cuadradas, techo en gradas. Aquí
 *  cada bus es un modelo de verdad, armado con geometría (sin archivos externos ni licencias de terceros): carrocería con aristas
 *  redondeadas, parabrisas inclinado, ventanas oscuras con marcos, puertas, techo más claro con el aire acondicionado, ruedas redondas
 *  con rin en sus guardabarros, faros, pilotos y parachoques; la troncal es articulada (dos cuerpos y fuelle de acordeón).
 *
 *  Rendimiento: un `InstancedMesh` por pieza (carrocería, techo, piezas de color fijo), por tipo (padrón o articulado) y por estado
 *  (al día o con dato viejo): ~16 dibujos por cuadro sin importar cuántos buses haya. Por bus solo cambia su matriz (posición y rumbo)
 *  y su color. Este archivo (y three.js) se carga aparte, solo cuando alguien enciende el 3D y se acerca. */

/* ---------- la capa ---------- */

type Kit = Record<Group, THREE.InstancedMesh> & { geo: Record<Group, THREE.BufferGeometry>; stale: boolean; cap: number };
interface Placed { lon: number; lat: number; z: number; pitch: number; t: number; gen: number }

const toMercX = (lon: number) => (lon + 180) / 360;
const toMercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
/** Metros por unidad de Mercator a esa latitud (la circunferencia de la Tierra en ese paralelo), con el mismo radio que usa MapLibre
 *  (6.371.008,8 m): con el radio del ecuador la altura del suelo (~3.200 m con el relieve) quedaba 3,5 m abajo y los buses, enterrados. */
const metersPerMerc = (lat: number) => 2 * Math.PI * 6_371_008.8 * Math.cos((lat * Math.PI) / 180);

export class BusModelLayer implements CustomLayerInterface {
  readonly id = "buses-modelo";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly root = new THREE.Group();
  private readonly kits: Kit[] = [];
  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.9);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.9);
  /** Punto de referencia (Mercator) del que se miden los buses en metros: así no se pierde precisión con números grandes. */
  private origin = { x: 0, y: 0, lat: 0, set: false };
  private readonly ground = new Map<string, Placed>();
  /** Altura e inclinación que se están mostrando de cada bus (se acercan suavemente a las medidas en `ground`). */
  private readonly drawnGround = new Map<string, { z: number; pitch: number; t: number }>();
  /** Sube cuando llegan teselas del relieve: las alturas medidas antes (quizá con una tesela gruesa) se vuelven a medir. */
  private groundGen = 0;
  private readonly proj = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly col = new THREE.Color();
  private dark = false;
  private vw = 0; private vh = 0;
  failed = false;
  /** Cuántos buses dibujó en la última actualización (para medir). */
  shown = 0;

  constructor(private readonly map: MLMap, private readonly onFail: () => void) {}

  private readonly onSourceData = (e: { sourceId?: string; tile?: unknown }) => { if (e.sourceId === "relieve" && e.tile) this.groundGen++; };

  onAdd(_map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map.on("sourcedata", this.onSourceData);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    // la escena va en metros: X al este, Y al norte, Z arriba (el paso a Mercator, cuya Y crece hacia el sur, va en la proyección)
    this.ambient.position.set(0, 0, 1);
    this.sun.position.set(0.45, 0.7, 1);       // sol alto del noreste
    this.scene.add(this.ambient, this.sun, this.root);
    const std = standardBus(), art = articulatedBus();
    for (const stale of [false, true]) for (const parts of [std, art]) this.kits.push(this.makeKit(parts, stale));
  }

  private makeKit(parts: Parts, stale: boolean): Kit {
    const geo = Object.fromEntries(GROUPS.map((g) => [g, mergeGeometries(parts[g])!])) as Record<Group, THREE.BufferGeometry>;
    const kit = { geo, stale, cap: 0 } as Kit;
    this.grow(kit, 16);
    return kit;
  }
  private material(stale: boolean, g: Group): THREE.Material {
    // sombra de contacto bajo el bus: un velo oscuro sobre el suelo (sin ella el bus parece flotar)
    if (g === "shade") return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: stale ? 0.5 : 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return new THREE.MeshLambertMaterial({ vertexColors: true, ...(stale ? { transparent: true, opacity: 0.5 } : {}) });
  }
  /** Agranda (o crea) las mallas de un juego para que quepan `need` buses. */
  private grow(kit: Kit, need: number) {
    if (kit.cap >= need) return;
    const cap = Math.max(16, 1 << Math.ceil(Math.log2(need)));
    for (const g of GROUPS) {
      const old = kit[g] as THREE.InstancedMesh | undefined;
      if (old) { this.root.remove(old); old.dispose(); (old.material as THREE.Material).dispose(); }
      const m = new THREE.InstancedMesh(kit.geo[g], this.material(kit.stale, g), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;       // la caja que la contiene cambia con cada bus: se deja a la tarjeta gráfica
      m.count = 0;
      m.setColorAt(0, this.col.set(1, 1, 1));
      m.renderOrder = kit.stale ? 1 : 0;
      kit[g] = m;
      this.root.add(m);
    }
    kit.cap = cap;
  }

  private lastSig = NaN;
  private lastDark = false;
  private readonly colorKeys = new Map<string, number>();
  private colorKey(c: string): number {
    let v = this.colorKeys.get(c);
    if (v === undefined) { v = this.colorKeys.size + 1; this.colorKeys.set(c, v); }
    return v;
  }

  /** Pone los buses (los mismos que dibuja `BusRenderer`, con la posición suavizada que ya calcula). Devuelve si cambió algo. */
  setBuses(items: readonly BusDraw[] | null, dark: boolean): boolean {
    if (!this.renderer || this.failed) return false;
    this.dark = dark;
    const map = this.map, c = map.getCenter();
    const b = map.getBounds(), padLon = (b.getEast() - b.getWest()) * 0.15, padLat = (b.getNorth() - b.getSouth()) * 0.15;
    const w0 = b.getWest() - padLon, w1 = b.getEast() + padLon, s0 = b.getSouth() - padLat, s1 = b.getNorth() + padLat;
    // el punto de referencia se mueve solo si el mapa se alejó más de ~2 km
    if (!this.origin.set || Math.abs(toMercX(c.lng) - this.origin.x) * metersPerMerc(c.lat) > 2000 || Math.abs(toMercY(c.lat) - this.origin.y) * metersPerMerc(c.lat) > 2000)
      this.origin = { x: toMercX(c.lng), y: toMercY(c.lat), lat: c.lat, set: true };
    const k = metersPerMerc(this.origin.lat), ox = this.origin.x, oy = this.origin.y;
    const terrain = (map as unknown as { terrain?: { getElevationForLngLatZoom?: (l: LngLat, z: number) => number; tileManager?: { maxzoom?: number } } | null }).terrain ?? null;
    const tz = Math.min(terrain?.tileManager?.maxzoom ?? 14, Math.floor(map.getZoom()));
    const now = performance.now();
    const counts = [0, 0, 0, 0];
    let sig = 0;
    for (const bus of items ?? []) {
      if (bus.lon < w0 || bus.lon > w1 || bus.lat < s0 || bus.lat > s1) continue;
      const ki = (bus.stale ? 2 : 0) + (bus.long ? 1 : 0), kit = this.kits[ki]!, i = counts[ki]!++;
      if (i >= kit.cap) this.grow(kit, i + 1);
      const deg = bus.angle != null && Number.isFinite(bus.angle) ? bus.angle : bus.left ? 270 : 90, r = (deg * Math.PI) / 180;
      const co = Math.cos(r), si = Math.sin(r);
      // altura del suelo (con el relieve levantado), medida al centro y en la nariz y la cola: el bus se inclina con la pendiente y nunca
      // queda enterrado. Se vuelve a medir si el bus avanzó ~10 m, cada 2 s o cuando llegan teselas nuevas del relieve
      let z = 0, pitch = 0;
      if (terrain) {
        let g = this.ground.get(bus.id);
        if (!g || now - g.t > 2000 || g.gen !== this.groundGen || Math.abs(g.lon - bus.lon) > 9e-5 || Math.abs(g.lat - bus.lat) > 9e-5) {
          const half = (bus.long ? 18.3 : 12) / 2, dLon = (si * half) / (111_320 * Math.cos((bus.lat * Math.PI) / 180)), dLat = (co * half) / 110_540;
          const at = (lon: number, lat: number) => {
            const e = terrain.getElevationForLngLatZoom ? terrain.getElevationForLngLatZoom(new LngLat(lon, lat), tz) : (map.queryTerrainElevation([lon, lat]) ?? 0);
            return Number.isFinite(e) ? e : 0;
          };
          const zc = at(bus.lon, bus.lat), zf = at(bus.lon + dLon, bus.lat + dLat), zr = at(bus.lon - dLon, bus.lat - dLat);
          // lo más alto de los tres puntos y 20 cm de holgura: el relieve que se dibuja se interpola entre teselas y en algunos tramos
          // queda unos centímetros por encima de lo medido (el bus se veía «enterrado», 2026-11-27)
          g = { lon: bus.lon, lat: bus.lat, z: Math.max(zc, zf, zr) + 0.2, pitch: Math.atan2(zf - zr, 2 * half), t: now, gen: this.groundGen };
          this.ground.set(bus.id, g);
        }
        // la altura y la inclinación no saltan: se acercan a lo medido en ~¼ s. Antes, al volver a medir el suelo (cada ~10 m, cada 2 s o
        // cada vez que llegaba una tesela del relieve más detallada) el bus subía o bajaba de golpe y parecía que brincara
        let sh = this.drawnGround.get(bus.id);
        if (!sh || now - sh.t > 1500) sh = { z: g.z, pitch: g.pitch, t: now };
        else { const k = 1 - Math.exp(-(now - sh.t) / 250); sh.z += (g.z - sh.z) * k; sh.pitch += (g.pitch - sh.pitch) * k; sh.t = now; }
        this.drawnGround.set(bus.id, sh);
        z = sh.z; pitch = sh.pitch;
      }
      const x = (toMercX(bus.lon) - ox) * k, y = -(toMercY(bus.lat) - oy) * k;     // metros al este y al norte del punto de referencia
      // gira según el rumbo (adelante = +Y), se inclina con la pendiente y se pone en su sitio
      const pc = Math.cos(pitch), ps = Math.sin(pitch);
      this.tmp.set(co, si * pc, -si * ps, x, -si, co * pc, -co * ps, y, 0, ps, pc, z, 0, 0, 0, 1);
      for (const g of GROUPS) kit[g].setMatrixAt(i, this.tmp);
      const paint = bus.stale ? mixHex(bus.color, dark ? "#3a3d44" : "#c9ccd2", 0.55) : bus.color;
      kit.body.setColorAt(i, this.col.set(paint));
      kit.roof.setColorAt(i, this.col.set(mixHex(paint, "#ffffff", 0.3)));
      kit.fixed.setColorAt(i, this.col.set(1, 1, 1)); kit.shade.setColorAt(i, this.col);
      sig += x * 1.31 + y * 0.77 + z * 0.13 + deg * 0.011 + pitch + (bus.stale ? 7 : 0) + this.colorKey(bus.color) * (i + 1);
    }
    // ¿cambió algo? (si nada se movió, no hace falta volver a dibujar el mapa)
    let changed = sig !== this.lastSig || dark !== this.lastDark;
    this.lastSig = sig; this.lastDark = dark;
    this.kits.forEach((kit, ki) => {
      const n = counts[ki]!;
      for (const g of GROUPS) {
        const m = kit[g];
        if (m.count !== n) changed = true;
        m.count = n; m.visible = n > 0;
        if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      }
    });
    this.shown = counts.reduce((a, v) => a + v, 0);
    if (this.ground.size > 2000) this.ground.clear();
    if (this.drawnGround.size > 2000) this.drawnGround.clear();
    return changed;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const r = this.renderer;
    if (!r || this.failed || this.shown === 0) return;
    try {
      // matriz del mapa (Mercator → pantalla) × punto de referencia × metros → Mercator
      const s = 1 / metersPerMerc(this.origin.lat);
      this.proj.fromArray(args.defaultProjectionData.mainMatrix as ArrayLike<number> as number[]);
      this.tmp.set(s, 0, 0, this.origin.x, 0, -s, 0, this.origin.y, 0, 0, s, 0, 0, 0, 0, 1);
      this.camera.projectionMatrix.multiplyMatrices(this.proj, this.tmp);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      const dim = this.dark ? 0.72 : 1;
      this.ambient.intensity = 1.9 * dim; this.sun.intensity = 1.9 * dim;
      if (gl.drawingBufferWidth !== this.vw || gl.drawingBufferHeight !== this.vh) {
        this.vw = gl.drawingBufferWidth; this.vh = gl.drawingBufferHeight;
        r.setViewport(0, 0, this.vw, this.vh);
      }
      r.resetState();
      r.render(this.scene, this.camera);
    } catch (e) {
      this.failed = true;
      console.warn("Buses 3D: no se pudo dibujar el modelo; se vuelve a los volúmenes simples", e);
      this.onFail();
    }
  }

  /** Punto de la pantalla (px) de un sitio a `alt` m sobre el suelo, con la cámara de este momento (para el nombre y el toque). */
  screenAt(lon: number, lat: number, id: string, alt: number): { x: number; y: number } | null {
    const t = (this.map as unknown as { transform?: { getProjectionDataForCustomLayer?: (g?: boolean) => { mainMatrix: ArrayLike<number> } } }).transform;
    const data = t?.getProjectionDataForCustomLayer?.(true);
    if (!data) return null;
    const m = data.mainMatrix, z = ((this.drawnGround.get(id)?.z ?? this.ground.get(id)?.z ?? 0) + alt) / metersPerMerc(lat), x = toMercX(lon), y = toMercY(lat);
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (!(cw > 0)) return null;
    const c = this.map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    return { x: ((cx / cw + 1) / 2) * w, y: ((1 - cy / cw) / 2) * h };
  }

  onRemove() {
    this.map.off("sourcedata", this.onSourceData);
    for (const kit of this.kits) for (const g of GROUPS) { kit[g].dispose(); (kit[g].material as THREE.Material).dispose(); kit.geo[g].dispose(); }
    this.renderer?.dispose();
    this.renderer = null;
  }
}
