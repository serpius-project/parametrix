"""
Output writers: GeoJSON, CSV, and interactive Folium HTML map.

These are product-agnostic — they work with the standard pricing engine
output enriched with ``_lat`` / ``_lon`` per result row.
"""

from __future__ import annotations

import csv
import json


# ============================================================================
# GeoJSON
# ============================================================================

def write_geojson(results: list[dict], grid_step: float, path: str) -> None:
    """Write a GeoJSON FeatureCollection of pixel polygons."""
    half = grid_step / 2.0
    features = []
    for r in results:
        lat, lon = r["_lat"], r["_lon"]
        coords = [[
            [round(lon - half, 6), round(lat - half, 6)],
            [round(lon + half, 6), round(lat - half, 6)],
            [round(lon + half, 6), round(lat + half, 6)],
            [round(lon - half, 6), round(lat + half, 6)],
            [round(lon - half, 6), round(lat - half, 6)],
        ]]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": {
                "id": r["id"],
                "premium": round(r["premium"], 6),
                "lambda": round(r["lambda"], 8),
                "trigger_probability": round(r["trigger_probability"], 8),
                "n_trigger_events": r["n_trigger_events"],
                "expected_loss": round(r["expected_loss"], 6),
            },
        })

    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(fc, f)
    print(f"Wrote GeoJSON: {path}  ({len(features)} features)")


# ============================================================================
# CSV
# ============================================================================

def write_csv(results: list[dict], path: str) -> None:
    """Write one row per unit with all pricing metrics."""
    fieldnames = [
        "id", "lat", "lon", "n_trigger_events",
        "lambda", "trigger_probability", "expected_loss", "premium",
    ]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in results:
            w.writerow({
                "id": r["id"],
                "lat": r["_lat"],
                "lon": r["_lon"],
                "n_trigger_events": r["n_trigger_events"],
                "lambda": r["lambda"],
                "trigger_probability": r["trigger_probability"],
                "expected_loss": r["expected_loss"],
                "premium": r["premium"],
            })
    print(f"Wrote CSV: {path}")


# ============================================================================
# Interactive Folium HTML map
# ============================================================================

def _premium_color(premium: float, max_premium: float) -> str:
    """Green → yellow → red gradient."""
    if max_premium <= 0:
        return "#00ff00"
    t = min(premium / max_premium, 1.0)
    if t < 0.5:
        r = int(255 * (t * 2))
        g = 255
    else:
        r = 255
        g = int(255 * (1 - (t - 0.5) * 2))
    return f"#{r:02x}{g:02x}00"


def write_html_map(
    results: list[dict],
    grid_step: float,
    bbox: dict,
    path: str,
    title: str = "Premium Map",
    legend_extra: str = "",
) -> None:
    """Write an interactive Leaflet map coloured by premium."""
    import folium

    center_lat = (bbox["min_lat"] + bbox["max_lat"]) / 2.0
    center_lon = (bbox["min_lon"] + bbox["max_lon"]) / 2.0
    m = folium.Map(location=[center_lat, center_lon], zoom_start=6,
                   tiles="CartoDB positron")

    max_premium = max((r["premium"] for r in results), default=0.0)
    half = grid_step / 2.0

    features = []
    for r in results:
        lat, lon = r["_lat"], r["_lon"]
        color = _premium_color(r["premium"], max_premium)
        opacity = 0.75 if r["premium"] > 0 else 0.10
        coords = [[
            [lon - half, lat - half],
            [lon + half, lat - half],
            [lon + half, lat + half],
            [lon - half, lat + half],
            [lon - half, lat - half],
        ]]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": {
                "id": r["id"],
                "premium": round(r["premium"], 2),
                "lam": round(r["lambda"], 6),
                "p_trig": round(r["trigger_probability"], 6),
                "n_ev": r["n_trigger_events"],
                "e_loss": round(r["expected_loss"], 2),
                "_color": color,
                "_opacity": opacity,
            },
        })

    fc = {"type": "FeatureCollection", "features": features}

    style_fn = lambda feat: {
        "fillColor": feat["properties"]["_color"],
        "color": feat["properties"]["_color"],
        "weight": 0.3,
        "fillOpacity": feat["properties"]["_opacity"],
    }

    popup = folium.GeoJsonPopup(
        fields=["id", "premium", "lam", "p_trig", "n_ev", "e_loss"],
        aliases=["Pixel", "Premium ($)", "λ (annual)", "P(trigger)",
                 "N events", "E[loss] ($)"],
        localize=True,
    )

    folium.GeoJson(fc, style_function=style_fn, popup=popup).add_to(m)

    legend_html = f"""
    <div style="position:fixed; bottom:30px; left:30px; z-index:1000;
                background:white; padding:10px 14px; border:2px solid grey;
                border-radius:5px; font-size:13px; line-height:1.6;">
        <b>{title}</b><br>
        {legend_extra}<br>
        <span style="color:#00ff00;">&#9632;</span> $0 &nbsp;
        <span style="color:#ffff00;">&#9632;</span> mid &nbsp;
        <span style="color:#ff0000;">&#9632;</span> ${max_premium:.2f} (max)
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    m.save(path)
    print(f"Wrote HTML map: {path}")
