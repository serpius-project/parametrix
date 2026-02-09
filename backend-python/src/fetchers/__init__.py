"""
Pluggable event data fetchers.

Each fetcher is a callable that returns a list of normalised events in the
generic schema::

    {"type": str, "time": str, "lat": float, "lon": float,
     "value": float, "meta": dict}

Fetchers are OPTIONAL — the pricing engine never calls them.  They exist
only in the pipeline layer (run_map.py) to acquire data before pricing.
"""

from src.fetchers.usgs import USGSFetcher
from src.fetchers.synthetic_rainfall import SyntheticRainfallFetcher

FETCHER_REGISTRY: dict[str, type] = {
    "usgs": USGSFetcher,
    "synthetic_rainfall": SyntheticRainfallFetcher,
}


def get_fetcher(name: str, **kwargs):
    """Instantiate a fetcher by name."""
    if name not in FETCHER_REGISTRY:
        raise KeyError(
            f"Unknown fetcher '{name}'. Available: {sorted(FETCHER_REGISTRY)}"
        )
    return FETCHER_REGISTRY[name](**kwargs)
