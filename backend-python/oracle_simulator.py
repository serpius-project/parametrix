"""
Oracle Event Simulator for Data Center Climate Risk Insurance.

Purpose
-------
Generate fake "oracle observations" for demos / videos without calling
any external API.

- simulate_observation(): creates an observation dict with the same shape
  as oracle_fetcher.fetch_latest_observation().
- simulate_event_and_payout(): combines the simulation with a trigger/payout
  decision payload, matching oracle_checker.check_event_and_payout().

Dependencies
------------
- oracle_fetcher.py (for hazard metadata + trigger logic)
Requires only:
- numpy (already used in your repo)

Usage
-----
    from oracle_simulator import simulate_event_and_payout

    out = simulate_event_and_payout(
        lat=41.86, lon=-87.65,
        hazard="flood",
        threshold=50,
        payout=10_000,
        force_trigger=True,
    )
    print(out)
"""

from typing import Dict, Any
from datetime import date
import random

from oracle_fetcher import HAZARD_API_CONFIG, evaluate_trigger


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
        If False, it will be on the safe side.
    jitter_frac : float
        How far from the threshold to place the simulated value, as a fraction
        of |threshold|. If threshold is 0, uses a small absolute jitter.

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

    # pick a random offset within a reasonable demo range
    offset = random.uniform(0.25, 1.00) * jitter

    if force_trigger:
        # breach threshold
        value = (threshold + offset) if direction_high_bad else (threshold - offset)
    else:
        # safe side
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


def simulate_event_and_payout(
    lat: float,
    lon: float,
    hazard: str,
    threshold: float,
    payout: float,
    force_trigger: bool = True,
    date_str: str = None,
    jitter_frac: float = 0.10,
) -> Dict[str, Any]:
    """
    Simulate an event and return the same style of payload as the real oracle
    path: observation -> evaluate trigger -> payout decision.
    """
    obs = simulate_observation(
        lat=lat,
        lon=lon,
        hazard=hazard,
        threshold=threshold,
        force_trigger=force_trigger,
        date_str=date_str,
        jitter_frac=jitter_frac,
    )

    trig = evaluate_trigger(observation=obs, threshold=threshold, hazard=hazard)
    payout_due = float(payout) if trig.get("triggered") else 0.0

    return {
        "status": "ok",
        "hazard": hazard,
        "date": obs["date"],
        "lat": obs["lat"],
        "lon": obs["lon"],
        "value": float(obs["value"]),
        "unit": obs["unit"],
        "variable": obs["variable"],
        "aggregation": obs["aggregation"],
        "threshold": float(threshold),
        "direction": trig.get("direction"),
        "triggered": bool(trig.get("triggered")),
        "margin": float(trig.get("margin", 0.0)),
        "payout": float(payout),
        "payout_due": payout_due,
        "source": obs["source"],
    }


if __name__ == "__main__":
    print("=" * 70)
    print("ORACLE SIMULATOR DEMO")
    print("Generate fake events that breach thresholds for video demos")
    print("=" * 70)

    lat, lon = 41.86, -87.65
    payout = 10_000.0

    demo_thresholds = {
        "flood": 50.0,
        "heatwave": 25.0,
        "waterstress": 0.20,
        "drought": -50.0,
    }

    for hazard, threshold in demo_thresholds.items():
        print(f"\n--- {hazard.upper()} (FORCED TRIGGER) ---")
        out = simulate_event_and_payout(
            lat=lat, lon=lon,
            hazard=hazard,
            threshold=threshold,
            payout=payout,
            force_trigger=True,
        )
        print(f"  Date: {out['date']}")
        print(f"  Value: {out['value']} {out['unit']} | Threshold: {out['threshold']}")
        print(f"  Triggered: {out['triggered']} (margin: {out['margin']:.4f})")
        print(f"  Payout due: {out['payout_due']:.2f} USDC")

        print(f"--- {hazard.upper()} (SAFE) ---")
        out2 = simulate_event_and_payout(
            lat=lat, lon=lon,
            hazard=hazard,
            threshold=threshold,
            payout=payout,
            force_trigger=False,
        )
        print(f"  Value: {out2['value']} {out2['unit']} | Threshold: {out2['threshold']}")
        print(f"  Triggered: {out2['triggered']} (margin: {out2['margin']:.4f})")
