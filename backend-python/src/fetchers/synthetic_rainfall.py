"""
Synthetic rainfall event generator for demo / testing purposes.

Produces deterministic, reproducible rainfall events scattered across a
bounding box.  Uses a seeded LCG (linear congruential generator) so output
is identical on every run — no dependency on ``random`` module state.
"""

from __future__ import annotations

import math


class SyntheticRainfallFetcher:
    """Generate synthetic daily rainfall events.

    Parameters
    ----------
    bbox : dict
        ``{"min_lat", "max_lat", "min_lon", "max_lon"}``
    time_start, time_end : str
        ISO date strings for the historical window.
    n_stations : int
        Number of virtual rain gauge stations (default 40).
    n_events : int
        Total rainfall events to generate (default 800).
    seed : int
        Deterministic seed for the LCG (default 42).
    """

    def __init__(
        self,
        bbox: dict,
        time_start: str,
        time_end: str,
        n_stations: int = 40,
        n_events: int = 800,
        seed: int = 42,
    ):
        self.bbox = bbox
        self.time_start = time_start
        self.time_end = time_end
        self.n_stations = n_stations
        self.n_events = n_events
        self.seed = seed

    # simple deterministic PRNG (LCG) — no external state
    @staticmethod
    def _lcg(state: int) -> tuple[int, float]:
        """Return (next_state, uniform_0_1)."""
        # Numerical Recipes LCG constants
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state, state / 0xFFFFFFFF

    def fetch(self) -> list[dict]:
        """Return a deterministic list of synthetic rainfall events."""
        bbox = self.bbox
        lat_range = bbox["max_lat"] - bbox["min_lat"]
        lon_range = bbox["max_lon"] - bbox["min_lon"]

        state = self.seed

        # Generate station positions
        stations: list[tuple[float, float]] = []
        for _ in range(self.n_stations):
            state, u1 = self._lcg(state)
            state, u2 = self._lcg(state)
            lat = bbox["min_lat"] + u1 * lat_range
            lon = bbox["min_lon"] + u2 * lon_range
            stations.append((round(lat, 4), round(lon, 4)))

        # Parse year range
        start_year = int(self.time_start[:4])
        end_year = int(self.time_end[:4])
        total_days = (end_year - start_year) * 365

        events: list[dict] = []
        for i in range(self.n_events):
            # pick station
            state, u = self._lcg(state)
            st_idx = int(u * self.n_stations) % self.n_stations
            lat, lon = stations[st_idx]

            # pick day offset
            state, u = self._lcg(state)
            day_offset = int(u * total_days)
            year = start_year + day_offset // 365
            doy = (day_offset % 365) + 1
            # clamp doy to valid range
            if doy > 365:
                doy = 365
            month = min(12, (doy - 1) // 30 + 1)
            day = min(28, (doy - 1) % 30 + 1)
            time_str = f"{year:04d}-{month:02d}-{day:02d}T12:00:00Z"

            # rainfall amount (mm): exponential-ish distribution via -ln(U)
            state, u = self._lcg(state)
            u = max(u, 1e-9)
            rainfall_mm = round(-50.0 * math.log(u), 1)

            events.append({
                "type": "rainfall",
                "lat": lat,
                "lon": lon,
                "value": rainfall_mm,
                "time": time_str,
                "meta": {
                    "unit": "mm",
                    "station_idx": st_idx,
                    "data_source": "synthetic",
                },
            })

        print(f"Generated {len(events)} synthetic rainfall events "
              f"across {self.n_stations} stations.")
        return events
