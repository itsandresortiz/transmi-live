#!/usr/bin/env python3
"""Genera el mapa base de la app (claro y oscuro) a partir de los estilos «positron» y «dark» de OpenFreeMap, cambiándoles los colores
para que calles, parques y agua se distingan mejor (el «dark» original es casi negro sobre negro).

Uso: python3 tools/map-styles.py [carpeta con positron.json y dark.json]
Sin carpeta, los baja de github.com/hyperknot/openfreemap-styles. Escribe apps/mobile/src/map/style-light.json y style-dark.json y sus
copias de la web (apps/web/src/map/base-light.json y base-dark.json, iguales byte a byte). No editar esos a mano.
"""
import json, os, sys, urllib.request

SRC = "https://raw.githubusercontent.com/hyperknot/openfreemap-styles/main/styles/%s/style.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "mobile", "src", "map")
WEB = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "src", "map")

# id de capa -> {propiedad: color}. Lo que no aparezca queda como en el estilo original.
LIGHT = {
    "background": {"background-color": "#f4f2ec"},
    "landuse_residential": {"fill-color": "#efede6"},
    "water": {"fill-color": "#a6d0ee"},
    "waterway": {"line-color": "#a6d0ee"},
    "building": {"fill-color": "#e7e3da", "fill-outline-color": "#d6d1c6"},
    "aeroway-area": {"fill-color": "#e9e6ee"}, "aeroway-runway": {"line-color": "#d9d5e2"}, "aeroway-taxiway": {"line-color": "#d9d5e2"}, "aeroway-runway-casing": {"line-color": "#c9c4d4"},
    "road_area_pier": {"fill-color": "#f4f2ec"}, "road_pier": {"line-color": "#f4f2ec"},
    "highway_path": {"line-color": "#e1ddd3"},
    "highway_minor": {"line-color": "#ffffff"},
    "highway_major_casing": {"line-color": "#cbc6ba"}, "highway_major_inner": {"line-color": "#ffffff"}, "highway_major_subtle": {"line-color": "#d8d3c7"},
    "highway_motorway_casing": {"line-color": "#bdb7a9"}, "highway_motorway_inner": {"line-color": "#fff7df"}, "highway_motorway_subtle": {"line-color": "#d2ccbe"},
    "highway_motorway_bridge_casing": {"line-color": "#bdb7a9"}, "highway_motorway_bridge_inner": {"line-color": "#fff7df"},
    "tunnel_motorway_casing": {"line-color": "#cbc6ba"}, "tunnel_motorway_inner": {"line-color": "#f2efe6"},
    "railway": {"line-color": "#c9c4b8"}, "railway_transit": {"line-color": "#c9c4b8"}, "railway_service": {"line-color": "#c9c4b8"},
    "highway-name-path": {"text-color": "#8a8f98", "text-halo-color": "#f4f2ec"},
    "highway-name-minor": {"text-color": "#6a6f78", "text-halo-color": "#ffffff"}, "highway-name-major": {"text-color": "#555a63", "text-halo-color": "#ffffff"},
    "water_name_point_label": {"text-color": "#3f78a6"}, "water_name_line_label": {"text-color": "#3f78a6"}, "waterway_line_label": {"text-color": "#3f78a6"},
    "label_other": {"text-color": "#4a4e57"}, "label_village": {"text-color": "#2c2f36"}, "label_town": {"text-color": "#2c2f36"}, "label_city": {"text-color": "#1f2228"}, "label_city_capital": {"text-color": "#1f2228"},
}
DARK = {
    "background": {"background-color": "#1d1f24"},
    "landuse_residential": {"fill-color": "#212329"},
    "landcover_ice_shelf": {"fill-color": "#1d1f24"}, "landcover_glacier": {"fill-color": "#1d1f24"},
    "water": {"fill-color": "#10293d"}, "waterway": {"line-color": "#10293d"},
    "water_name": {"text-color": "#6f93b3", "text-halo-color": "#0c1c2a"},
    "building": {"fill-color": "#272a31", "fill-outline-color": "#31353d"},
    "aeroway-area": {"fill-color": "#24272d"}, "aeroway-runway": {"line-color": "#353943"}, "aeroway-taxiway": {"line-color": "#353943"}, "aeroway-runway-casing": {"line-color": "#4c5260"},
    "road_area_pier": {"fill-color": "#1d1f24"}, "road_pier": {"line-color": "#1d1f24"},
    "highway_path": {"line-color": "#2e323a"},
    "highway_minor": {"line-color": "#373c46"},
    "highway_major_casing": {"line-color": "#525967"}, "highway_major_inner": {"line-color": "#434a57"}, "highway_major_subtle": {"line-color": "#3e4450"},
    "highway_motorway_casing": {"line-color": "#616979"}, "highway_motorway_inner": {"line-color": "#505868"}, "highway_motorway_subtle": {"line-color": "#474d5a"},
    "railway": {"line-color": "#3b3f48"}, "railway_minor": {"line-color": "#3b3f48"}, "railway_transit": {"line-color": "#3b3f48"},
    "railway_dashline": {"line-color": "#24272d"}, "railway_minor_dashline": {"line-color": "#24272d"}, "railway_transit_dashline": {"line-color": "#24272d"},
    "highway_name_other": {"text-color": "#9ea5b1", "text-halo-color": "#1d1f24"}, "highway_name_motorway": {"text-color": "#b0b7c3", "text-halo-color": "#1d1f24"},
    "boundary_state": {"line-color": "#4c5260"}, "boundary_country_z0-4": {"line-color": "#5a6170"}, "boundary_country_z5-": {"line-color": "#5a6170"},
}
for k in ("place_other", "place_suburb", "place_village", "place_town", "place_city", "place_city_large", "place_state", "place_country_other", "place_country_minor", "place_country_major"):
    DARK[k] = {"text-color": "#c3c8d2", "text-halo-color": "rgba(18,20,24,0.85)"}


# Zonas verdes «tipo Mapas de Apple»: en Bogotá los parques NO vienen en la capa `park` de OpenMapTiles (esa trae solo reservas, como
# los cerros orientales) sino en `landcover` (clase grass: subclases park, garden, grass, recreation_ground…; clase wood: bosques).
# Los estilos originales no pintaban esa hierba, así que el Simón Bolívar o El Virrey se veían del color del fondo. Aquí se pintan con
# un verde presente pero sobrio (claro: verde suave; oscuro: verde azulado), por debajo de calles, líneas y textos.
GREEN = {
    False: {"park": "#c2e4bb", "grass": "#bfe3b8", "wood": "#a9d8a3", "pitch": "#cdeac5", "pitch_line": "#b2d9aa",
            "label": "#2f6a3c", "halo": "rgba(244,242,236,0.92)"},
    True: {"park": "#1b3832", "grass": "#1d3d36", "wood": "#1f443b", "pitch": "#1f3f39", "pitch_line": "#2a5048",
           "label": "#86d1ad", "halo": "rgba(20,24,26,0.9)"},
}
GRASS_FILTER = ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], True, False], ["==", ["get", "class"], "grass"]]
PITCH_FILTER = ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], True, False], ["match", ["get", "class"], ["pitch", "playground"], True, False]]
# nombres de parques y jardines (capa `poi`), de cerca: verde oscuro (claro) / verde claro (oscuro) con halo. Van debajo de los nombres
# de barrios y de todo lo de TransMi LIVE: MapLibre ubica primero los textos de las capas de arriba, así que las estaciones ganan.
PARK_LABEL_FILTER = ["all", ["match", ["get", "class"], ["park", "garden"], True, False], ["has", "name"]]


def greens(style, dark):
    """Agrega la hierba, las canchas y los nombres de parques, y repinta bosques y reservas (mismas capas en claro y oscuro)."""
    g = GREEN[dark]
    layers = style["layers"]
    ids = [l["id"] for l in layers]

    def insert_before(before, layer):
        layers.insert(ids.index(before) if before in ids else len(layers), layer)
        ids[:] = [l["id"] for l in layers]

    def put(layer, before):
        if layer["id"] in ids:
            layers[ids.index(layer["id"])] = layer
        else:
            insert_before(before, layer)

    park_op = ["interpolate", ["linear"], ["zoom"], 8, 0.55, 12, 0.85]
    put({"id": "park", "type": "fill", "source": "openmaptiles", "source-layer": "park",
         "filter": ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], True, False],
         "paint": {"fill-color": g["park"], "fill-opacity": park_op}}, "water")
    wood = next(l for l in layers if l["id"] == "landcover_wood")
    wood["paint"] = {"fill-color": g["wood"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 10, 0.7, 13, 0.95]}
    # la hierba, debajo del bosque y encima de lo residencial
    put({"id": "landcover_grass", "type": "fill", "source": "openmaptiles", "source-layer": "landcover", "minzoom": 10, "filter": GRASS_FILTER,
         "paint": {"fill-color": g["grass"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 13, 0.95]}}, "landcover_wood")
    put({"id": "landuse_pitch", "type": "fill", "source": "openmaptiles", "source-layer": "landuse", "minzoom": 13, "filter": PITCH_FILTER,
         "paint": {"fill-color": g["pitch"], "fill-outline-color": g["pitch_line"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1]}}, "waterway")
    # el agua va ENCIMA de parques y hierba: los lagos dentro de un parque (el del Simón Bolívar, El Lago) quedaban tapados por el verde
    if "water" in ids and "waterway" in ids:
        water = layers.pop(ids.index("water")); ids[:] = [l["id"] for l in layers]
        insert_before("waterway", water)
    if "landuse_park" in ids:          # en el oscuro original: la clase `park` de `landuse` no existe en OpenMapTiles (no pintaba nada)
        layers.pop(ids.index("landuse_park")); ids[:] = [l["id"] for l in layers]
    before = "place_other" if dark else "label_other"
    put({"id": "poi_park", "type": "symbol", "source": "openmaptiles", "source-layer": "poi", "minzoom": 14, "filter": PARK_LABEL_FILTER,
         "layout": {"text-field": ["get", "name"], "text-font": ["Noto Sans Regular"],
                    "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 17, 13.5], "text-max-width": 8, "text-padding": 16,
                    "symbol-sort-key": ["get", "rank"]},
         "paint": {"text-color": g["label"], "text-halo-color": g["halo"], "text-halo-width": 1.4, "text-halo-blur": 0.4,
                   "text-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.85, 15, 1]}}, before)


def load(name, folder):
    if folder:
        return json.load(open(os.path.join(folder, name + ".json"), encoding="utf-8"))
    with urllib.request.urlopen(SRC % name, timeout=40) as r:
        return json.load(r)


def recolor(value, color):
    """Si el color original cambia con el zoom (una expresión), se conserva la expresión y solo se cambia su último color."""
    if isinstance(value, list):
        out = list(value)
        for i in range(len(out) - 1, -1, -1):
            if isinstance(out[i], str) and (out[i].startswith(("#", "rgb", "hsl"))):
                out[i] = color
                break
        return out
    return color


def build(name, palette, folder):
    text = json.dumps(load(name, folder)).replace("__TILEJSON_DOMAIN__", "tiles.openfreemap.org")
    style = json.loads(text)
    seen = set()
    for layer in style["layers"]:
        changes = palette.get(layer["id"])
        if not changes:
            continue
        seen.add(layer["id"])
        paint = layer.setdefault("paint", {})
        for prop, color in changes.items():
            paint[prop] = recolor(paint.get(prop), color)
    greens(style, name == "dark")
    missing = sorted(set(palette) - seen)
    if missing:
        print(f"  aviso ({name}): estas capas ya no existen en el estilo original: {', '.join(missing)}")
    return style


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else None
    for name, palette, out, web in (("positron", LIGHT, "style-light.json", "base-light.json"), ("dark", DARK, "style-dark.json", "base-dark.json")):
        style = build(name, palette, folder)
        path = os.path.normpath(os.path.join(OUT, out))
        for p in (path, os.path.normpath(os.path.join(WEB, web))):
            json.dump(style, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{out}: {len(style['layers'])} capas, {os.path.getsize(path) // 1024} KB")
