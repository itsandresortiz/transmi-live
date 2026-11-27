import { BufferGeometry, Camera, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Scene, Vector3, WebGLRenderer } from "three";
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from "maplibre-gl";
import { TREE_COLORS, TREE_3D_MIN_ZOOM, crownColor, treeShape, type TreePoint } from "@transmi/application";

/** Árboles en 3D de la web, «tipo Mapas de Apple»: copa como una nube (una esfera grande y varias pequeñas, verde azulado) y tronco café.
 *  Capa propia de MapLibre con three.js; se carga con `import()` solo al encender el 3D de cerca, así quien no lo usa no baja three.js.
 *  Cada esfera es una instancia de la misma malla (`InstancedMesh`): miles de árboles en tres llamadas de dibujo. La luz va «horneada» en
 *  los colores de los vértices (arriba y hacia el sol más claro, abajo más oscuro): sombreado suave sin luces que calcular. */

/** Luz que viene de arriba y un poco del noroeste (este, norte, arriba). */
const SUN = new Vector3(-0.35, 0.45, 0.82).normalize();

/** Una esfera de radio 1 con la luz horneada en los colores de sus vértices (los vértices llevan su normal = su posición). */
function litSphere(detail: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);
  const pos = g.getAttribute("position"), colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i), ny = pos.getY(i), nz = pos.getZ(i);
    const sun = Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
    // sombra suave por debajo (oclusión), luz difusa arriba y un toque de brillo hacia el sol
    const k = 0.5 + 0.26 * (nz * 0.5 + 0.5) + 0.36 * sun;
    colors.push(k, k, k);
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}
function litTrunk(): BufferGeometry {
  // tronco de radio 1 y alto 1, de 0 a 1 (base en el suelo); un poco más angosto arriba
  const g = new CylinderGeometry(0.8, 1, 1, 7, 1, true);
  g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5);
  const pos = g.getAttribute("position"), colors: number[] = [];
  for (let i = 0; i < pos.count; i++) { const k = 0.75 + 0.25 * Math.max(0, (pos.getX(i) * SUN.x + pos.getY(i) * SUN.y) / Math.hypot(pos.getX(i), pos.getY(i))); colors.push(k, k, k); }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

export class TreeLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map: MLMap | null = null;
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new Camera();
  private big: InstancedMesh | null = null;
  private small: InstancedMesh | null = null;
  private trunks: InstancedMesh | null = null;
  /** Punto de referencia de los árboles dibujados (los árboles van en metros desde aquí) y la altura del relieve ahí. */
  private origin = { lon: -74.075, lat: 4.65, elev: 0 };
  private dark = false;
  private trees: readonly TreePoint[] = [];
  /** Tiempo de la última vez que se armaron las instancias (ms), para medir. */
  lastBuildMs = 0;

  constructor(id = "arboles-3d", private readonly maxTrees = 2000) { this.id = id; }

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    const mat = (side: typeof DoubleSide) => new MeshBasicMaterial({ vertexColors: true, side });
    // el eje norte va al revés del de MapLibre (que crece hacia el sur): las caras quedan «del otro lado», así que se dibujan las dos
    this.big = new InstancedMesh(litSphere(2), mat(DoubleSide), this.maxTrees);
    this.small = new InstancedMesh(litSphere(1), mat(DoubleSide), this.maxTrees * 5);
    this.trunks = new InstancedMesh(litTrunk(), mat(DoubleSide), this.maxTrees);
    for (const m of [this.big, this.small, this.trunks]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
    this.build();
  }

  onRemove() {
    for (const m of [this.big, this.small, this.trunks]) { m?.geometry.dispose(); (m?.material as MeshBasicMaterial | undefined)?.dispose(); }
    this.renderer?.dispose?.();
    this.renderer = null; this.map = null;
  }

  /** Cambia los árboles (y su color, según la apariencia). */
  setTrees(trees: readonly TreePoint[], dark: boolean) {
    this.trees = trees; this.dark = dark;
    this.build();
    this.map?.triggerRepaint();
  }
  get count(): number { return Math.min(this.trees.length, this.maxTrees); }

  private build() {
    const map = this.map, big = this.big, small = this.small, trunks = this.trunks;
    if (!map || !big || !small || !trunks) return;
    const t0 = performance.now();
    const trees = this.trees.length > this.maxTrees ? this.trees.slice(0, this.maxTrees) : this.trees;
    const c = map.getCenter();
    // con el relieve levantado, cada árbol se apoya en el suelo de su sitio. Si el relieve de aquí aún no llegó, no se dibuja nada (los
    // árboles quedarían 2.600 m más abajo, bajo los cerros) y se vuelve a intentar en cada cuadro hasta que llegue
    const ground = this.ground();
    const e0 = ground ? ground(c.lng, c.lat) : 0;
    this.waitGround = !!ground && !(e0 > 0);
    this.origin = { lon: c.lng, lat: c.lat, elev: e0 };
    const kx = 111_320 * Math.cos((this.origin.lat * Math.PI) / 180), ky = 110_540;
    const m4 = new Matrix4(), col = new Color(), trunkCol = new Color(TREE_COLORS[this.dark ? "dark" : "light"].trunk);
    let nb = 0, ns = 0, nt = 0;
    const smallMax = this.maxTrees * 5;
    for (const t of trees) {
      const s = treeShape(t);
      const x = (t.lon - this.origin.lon) * kx, y = (t.lat - this.origin.lat) * ky;
      const e = ground && !this.waitGround ? ground(t.lon, t.lat) : 0;
      const z = e > 0 ? e - this.origin.elev : 0;
      trunks.setMatrixAt(nt, m4.makeScale(s.trunkR, s.trunkR, s.trunkH + 0.4).setPosition(x, y, z - 0.3));
      trunks.setColorAt(nt++, trunkCol);
      const base = crownColor(s.tone, this.dark);
      s.blobs.forEach((b, k) => {
        // cada esfera con un tono apenas distinto: la copa no se ve de un solo color plano
        col.set(base).offsetHSL(0, 0, (k === 0 ? 0 : 0.025) + (k === s.blobs.length - 1 ? 0.03 : 0));
        m4.makeScale(b.r, b.r, b.r * 0.92).setPosition(x + b.x, y + b.y, z + b.z);
        if (k === 0) { big.setMatrixAt(nb, m4); big.setColorAt(nb++, col); }
        else if (ns < smallMax) { small.setMatrixAt(ns, m4); small.setColorAt(ns++, col); }
      });
    }
    big.count = nb; small.count = ns; trunks.count = nt;
    for (const m of [big, small, trunks]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.lastBuildMs = performance.now() - t0;
  }

  /** La altura del suelo (m, con la exageración del relieve) en un punto; `null` sin relieve levantado. Usa la tesela de relieve más
   *  detallada (zoom 14) directamente: `queryTerrainElevation` recalcula las teselas de la pantalla en cada llamada y con miles de árboles
   *  se traba. */
  private ground(): ((lon: number, lat: number) => number) | null {
    const map = this.map;
    if (!map?.getTerrain()) return null;
    const terr = (map as unknown as { terrain?: { getElevationForLngLatZoom?: (ll: maplibregl.LngLat, z: number) => number; tileManager?: { maxzoom?: number } } }).terrain;
    if (terr?.getElevationForLngLatZoom) {
      const z = terr.tileManager?.maxzoom ?? 14;
      return (lon, lat) => terr.getElevationForLngLatZoom!(new maplibregl.LngLat(lon, lat), z);
    }
    return (lon, lat) => map.queryTerrainElevation([lon, lat]) ?? 0;
  }
  private waitGround = false;

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const map = this.map, renderer = this.renderer;
    if (!map || !renderer || !this.big || this.big.count === 0 || map.getZoom() < TREE_3D_MIN_ZOOM - 0.4) return;
    if (this.waitGround) {
      const g = this.ground();
      if (g && !(g(this.origin.lon, this.origin.lat) > 0)) return;
      this.build();                    // llegó el relieve (o se apagó): se arman de nuevo, ya apoyados en el suelo
      if (this.waitGround) return;
    }
    const o = maplibregl.MercatorCoordinate.fromLngLat([this.origin.lon, this.origin.lat], this.origin.elev);
    const s = o.meterInMercatorCoordinateUnits();
    // metros (este, norte, arriba) desde el origen → coordenadas de Mercator de MapLibre (que crecen hacia el sur)
    const local = new Matrix4().makeTranslation(o.x, o.y, o.z ?? 0).scale(new Vector3(s, -s, s));
    this.camera.projectionMatrix = new Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(local);
    renderer.resetState();
    renderer.render(this.scene, this.camera);
  }
}
