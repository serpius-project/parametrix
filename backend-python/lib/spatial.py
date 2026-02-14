"""Spatial utilities for site lookup."""

import math


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km between two points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def find_nearest_site(lat: float, lon: float, sites: list) -> tuple:
    """
    Find the site closest to (lat, lon).

    Returns
    -------
    (site_dict, distance_km)
    """
    best_site = None
    best_dist = float("inf")
    for site in sites:
        d = haversine_km(lat, lon, site["lat"], site["lon"])
        if d < best_dist:
            best_dist = d
            best_site = site
    return best_site, best_dist
