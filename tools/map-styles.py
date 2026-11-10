#!/usr/bin/env python3
"""Genera el mapa base de la app (claro y oscuro) a partir de los estilos «positron» y «dark» de OpenFreeMap, cambiándoles los colores
para que calles, parques y agua se distingan mejor (el «dark» original es casi negro sobre negro).

Uso: python3 tools/map-styles.py [carpeta con positron.json y dark.json]
Sin carpeta, los baja de github.com/hyperknot/openfreemap-styles. Escribe apps/mobile/src/map/style-light.json y style-dark.json. No editar esos a mano.
"""
import json, os, sys, urllib.request

SRC = "https://raw.githubusercontent.com/hyperknot/openfreemap-styles/main/styles/%s/style.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "mobile", "src", "map")

# id de capa -> {propiedad: color}. Lo que no aparezca queda como en el estilo original.
LIGHT = {
    "background": {"background-color": "#f4f2ec"},
    "landuse_residential": {"fill-color": "#efede6"},
    "park": {"fill-color": "#cfe8c9"},
    "landcover_wood": {"fill-color": "#c3e0bd"},
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
    "landuse_park": {"fill-color": "#1c2d24"}, "landcover_wood": {"fill-color": "#1b2a22"},
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
    missing = sorted(set(palette) - seen)
    if missing:
        print(f"  aviso ({name}): estas capas ya no existen en el estilo original: {', '.join(missing)}")
    return style


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else None
    for name, palette, out in (("positron", LIGHT, "style-light.json"), ("dark", DARK, "style-dark.json")):
        style = build(name, palette, folder)
        path = os.path.normpath(os.path.join(OUT, out))
        json.dump(style, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{out}: {len(style['layers'])} capas, {os.path.getsize(path) // 1024} KB")
