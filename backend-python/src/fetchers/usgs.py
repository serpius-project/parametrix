"""
USGS Earthquake Catalog fetcher.

Fetches from the FDSNWS event/1 endpoint, normalises to the generic event
schema, supports time-chunked fetching and local JSON caching.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
USGS_ROW_LIMIT = 20000


class USGSFetcher:
    """Fetch and normalise earthquake events from the USGS catalogue.

    Parameters
    ----------
    bbox : dict
        ``{"min_lat", "max_lat", "min_lon", "max_lon"}``
    time_start, time_end : str
        ISO date strings, e.g. ``"1995-01-01"``.
    min_magnitude : float
        Minimum magnitude to request (default 2.0).
    query_pad_deg : float
        Degrees to pad the bbox for the API query (default 1.0).
    chunk_years : int
        Size of time slices for chunked fetching (default 5).
    cache_dir : str | Path
        Local directory for cached responses (default ``"usgs_cache"``).
    """

    def __init__(
        self,
        bbox: dict,
        time_start: str,
        time_end: str,
        min_magnitude: float = 2.0,
        query_pad_deg: float = 1.0,
        chunk_years: int = 5,
        cache_dir: str | Path = "usgs_cache",
    ):
        self.bbox = bbox
        self.time_start = time_start
        self.time_end = time_end
        self.min_magnitude = min_magnitude
        self.query_pad_deg = query_pad_deg
        self.chunk_years = chunk_years
        self.cache_dir = Path(cache_dir)

    # ------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """Return deduplicated, normalised events."""
        start_year = int(self.time_start[:4])
        end_year = int(self.time_end[:4])

        all_events: list[dict] = []
        y = start_year
        while y < end_year:
            chunk_end = min(y + self.chunk_years, end_year)
            s = f"{y}-01-01"
            e = f"{chunk_end}-01-01"
            all_events.extend(self._fetch_chunk(s, e))
            y = chunk_end

        before = len(all_events)
        all_events = self._dedup(all_events)
        after = len(all_events)
        if before != after:
            print(f"  Dedup: {before} → {after}  (removed {before - after})")
        print(f"Total normalised events: {len(all_events)}")
        return all_events

    # ------------------------------------------------------------------

    def _cache_key(self, params: dict) -> str:
        raw = json.dumps(params, sort_keys=True)
        h = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"usgs_{params['starttime']}_{params['endtime']}_{h}.json"

    def _fetch_chunk(self, start: str, end: str) -> list[dict]:
        params = {
            "format": "geojson",
            "starttime": start,
            "endtime": end,
            "minlatitude": self.bbox["min_lat"] - self.query_pad_deg,
            "maxlatitude": self.bbox["max_lat"] + self.query_pad_deg,
            "minlongitude": self.bbox["min_lon"] - self.query_pad_deg,
            "maxlongitude": self.bbox["max_lon"] + self.query_pad_deg,
            "minmagnitude": self.min_magnitude,
            "orderby": "time-asc",
            "limit": USGS_ROW_LIMIT,
        }

        self.cache_dir.mkdir(exist_ok=True)
        cache_file = self.cache_dir / self._cache_key(params)

        if cache_file.exists():
            print(f"  [cache hit]  {start} → {end}")
            with open(cache_file) as f:
                return json.load(f)

        print(f"  [fetching]   {start} → {end} …", end="", flush=True)
        resp = requests.get(USGS_URL, params=params, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        print(f" {len(features)} features")

        if len(features) >= USGS_ROW_LIMIT:
            print(f"  WARNING: chunk {start}–{end} hit the {USGS_ROW_LIMIT}-"
                  f"row limit.  Consider smaller chunk_years.")

        events = self._normalise(features)

        with open(cache_file, "w") as f:
            json.dump(events, f)
        return events

    # ------------------------------------------------------------------

    @staticmethod
    def _normalise(features: list[dict]) -> list[dict]:
        """USGS GeoJSON → generic event schema."""
        events: list[dict] = []
        for feat in features:
            props = feat["properties"]
            coords = feat["geometry"]["coordinates"]
            mag = props.get("mag")
            time_ms = props.get("time")
            if mag is None or coords[0] is None or coords[1] is None:
                continue
            time_str = (
                datetime.fromtimestamp(time_ms / 1000.0, tz=timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ")
            )
            events.append({
                "type": "earthquake",
                "lat": float(coords[1]),
                "lon": float(coords[0]),
                "value": float(mag),
                "time": time_str,
                "meta": {
                    "magnitude_scale": props.get("magType", ""),
                    "data_source": "USGS",
                    "depth_km": float(coords[2]) if coords[2] is not None else None,
                },
            })
        return events

    @staticmethod
    def _dedup(events: list[dict]) -> list[dict]:
        seen: set[tuple] = set()
        unique: list[dict] = []
        for e in events:
            key = (
                e["time"],
                round(e["lat"], 3),
                round(e["lon"], 3),
                round(e.get("value", e.get("magnitude", 0)), 3),
            )
            if key not in seen:
                seen.add(key)
                unique.append(e)
        return unique
