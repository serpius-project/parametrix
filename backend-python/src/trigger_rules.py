"""
Pluggable trigger rules for the parametric pricing engine.

Each trigger rule is a callable with signature:
    qualifies(unit: dict, event: dict, params: dict) -> bool

All rules are deterministic and stateless.

Built-in rules
--------------
A) GeoRadiusThreshold
     haversine(unit, event) <= R_km  AND  event.value >= threshold
B) PolygonContainsThreshold
     event point inside unit polygon  AND  event.value >= threshold
C) IndexTimeSeriesThreshold  (non-geographic)
     event.unit_id == unit.id  AND  event.value >= threshold
"""

from __future__ import annotations

from src.pricing_engine import haversine_km


# ============================================================================
# A) GeoRadiusThreshold
# ============================================================================

class GeoRadiusThreshold:
    """Geo-spatial trigger: value >= threshold within a radius.

    Params consumed from ``params`` dict at call time:
      - ``threshold``  (float)  — minimum event value to qualify
      - ``R_km``       (float)  — maximum haversine distance in km

    Works for earthquakes (value=magnitude), rainfall totals at stations,
    fire hotspot intensities, etc.
    """

    def __call__(self, unit: dict, event: dict, params: dict) -> bool:
        value = event.get("value", event.get("magnitude"))
        if value is None:
            raise ValueError("Event missing 'value' (and 'magnitude') field")
        threshold = params.get("threshold", params.get("M0"))
        if threshold is None:
            raise ValueError("params missing 'threshold' (and 'M0')")
        if value < threshold:
            return False
        dist = haversine_km(unit["lat"], unit["lon"],
                            event["lat"], event["lon"])
        return dist <= params["R_km"]


# ============================================================================
# B) PolygonContainsThreshold
# ============================================================================

class PolygonContainsThreshold:
    """Trigger: event point falls inside the unit's polygon AND value >= threshold.

    Each unit must carry a ``"polygon"`` key whose value is a list of
    ``[lon, lat]`` pairs forming a closed ring (first == last point).
    Uses the ray-casting algorithm for point-in-polygon.
    """

    @staticmethod
    def _point_in_polygon(px: float, py: float,
                          polygon: list[list[float]]) -> bool:
        """Ray-casting point-in-polygon test.

        ``polygon`` is a list of [x, y] (lon, lat) pairs, closed ring.
        """
        n = len(polygon)
        inside = False
        x1, y1 = polygon[0]
        for i in range(1, n):
            x2, y2 = polygon[i]
            if min(y1, y2) < py <= max(y1, y2):
                if x1 == x2:
                    xinters = x1
                else:
                    xinters = (py - y1) * (x2 - x1) / (y2 - y1) + x1
                if px <= xinters:
                    inside = not inside
            x1, y1 = x2, y2
        return inside

    def __call__(self, unit: dict, event: dict, params: dict) -> bool:
        polygon = unit.get("polygon")
        if polygon is None:
            raise ValueError(f"Unit '{unit['id']}' missing 'polygon' field")
        value = event.get("value", event.get("magnitude"))
        if value is None:
            raise ValueError("Event missing 'value' field")
        threshold = params.get("threshold", params.get("M0"))
        if threshold is None:
            raise ValueError("params missing 'threshold'")
        if value < threshold:
            return False
        return self._point_in_polygon(event["lon"], event["lat"], polygon)


# ============================================================================
# C) IndexTimeSeriesThreshold (non-geographic)
# ============================================================================

class IndexTimeSeriesThreshold:
    """Non-spatial trigger: event belongs to unit by id AND value >= threshold.

    Each event must carry a ``"unit_id"`` field that matches ``unit["id"]``.
    Useful for power-outage indices, custom metric feeds, etc.
    """

    def __call__(self, unit: dict, event: dict, params: dict) -> bool:
        if event.get("unit_id") != unit["id"]:
            return False
        value = event.get("value")
        if value is None:
            raise ValueError("Event missing 'value' field")
        threshold = params.get("threshold")
        if threshold is None:
            raise ValueError("params missing 'threshold'")
        return value >= threshold


# ============================================================================
# Registry: resolve a trigger rule by name string (used by the CLI runner).
# ============================================================================

TRIGGER_REGISTRY: dict[str, object] = {
    "geo_radius_threshold": GeoRadiusThreshold(),
    "polygon_contains_threshold": PolygonContainsThreshold(),
    "index_timeseries_threshold": IndexTimeSeriesThreshold(),
}


def get_trigger(name: str):
    """Look up a trigger rule by name.  Raises KeyError if unknown."""
    if name not in TRIGGER_REGISTRY:
        raise KeyError(
            f"Unknown trigger rule '{name}'. "
            f"Available: {sorted(TRIGGER_REGISTRY)}"
        )
    return TRIGGER_REGISTRY[name]
