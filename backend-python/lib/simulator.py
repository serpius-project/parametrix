"""Observation simulation helper for demos/testing."""

import random
from datetime import date
from typing import Dict, Any

from lib.fetcher import HAZARD_API_CONFIG


def simulate_observation(
    lat: float,
    lon: float,
    hazard: str,
    threshold: float,
    force_trigger: bool = True,
    date_str: str = None,
    jitter_frac: float = 0.10,
) -> Dict[str, Any]:
    """
    Create a fake observation dict (NO API calls).

    Parameters
    ----------
    force_trigger : bool
        If True, the simulated value breaches the threshold.
    jitter_frac : float
        How far from the threshold to place the simulated value.

    Returns
    -------
    dict shaped like fetch_latest_observation().
    """
    if hazard not in HAZARD_API_CONFIG:
        raise ValueError(f"Unknown hazard: '{hazard}'. Choose from: {list(HAZARD_API_CONFIG.keys())}")

    cfg = HAZARD_API_CONFIG[hazard]
    direction_high_bad = hazard in ("flood", "heatwave")

    if date_str is None:
        date_str = date.today().replace(day=1).isoformat()

    base = abs(float(threshold))
    jitter = base * float(jitter_frac)
    if jitter == 0:
        jitter = 1.0

    offset = random.uniform(0.25, 1.00) * jitter

    if force_trigger:
        value = (threshold + offset) if direction_high_bad else (threshold - offset)
    else:
        value = (threshold - offset) if direction_high_bad else (threshold + offset)

    return {
        "hazard": hazard,
        "lat": float(lat),
        "lon": float(lon),
        "date": date_str,
        "value": round(float(value), 4),
        "unit": cfg["unit"],
        "variable": cfg["output_variable"],
        "aggregation": cfg["aggregation"],
        "source": "SIMULATED_EVENT",
        "raw_daily_count": 0,
    }
