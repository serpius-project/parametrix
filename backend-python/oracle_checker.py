"""
Oracle Checker for Data Center Climate Risk Insurance.

Purpose
-------
Provides the "integration surface" for the protocol / oracle runner:

- check_actual_event(): calls the external API (Open-Meteo) to fetch the latest
  observed value for a hazard at a location.

- evaluate_payout(): NO API calls. Takes an observation + threshold (+ payout)
  and returns a clean payout/no payout decision payload.

- check_event_and_payout(): convenience wrapper that does both:
  fetch -> evaluate -> return a single dict.

Dependencies
------------
- oracle_fetcher.py (your existing module)
Requires only:
- requests, numpy (via oracle_fetcher)

Usage
-----
    from oracle_checker import check_actual_event, check_event_and_payout

    obs = check_actual_event(lat=41.86, lon=-87.65, hazard="flood")
    print(obs)

    decision = check_event_and_payout(
        lat=41.86, lon=-87.65,
        hazard="flood",
        threshold=50.0,
        payout=10_000,
    )
    print(decision)
"""

from typing import Dict, Any, Optional

from oracle_fetcher import fetch_latest_observation, evaluate_trigger, HAZARD_API_CONFIG


def check_actual_event(
    lat: float,
    lon: float,
    hazard: str,
    lookback_months: int = 3,
) -> Dict[str, Any]:
    """
    Fetch the latest observed event for a hazard at (lat, lon).

    This is the ONLY function that should call the external API.
    Intended to be used by the off-chain oracle runner / keeper.
    """
    return fetch_latest_observation(
        lat=lat,
        lon=lon,
        hazard=hazard,
        lookback_months=lookback_months,
    )


def evaluate_payout(
    observation: Dict[str, Any],
    hazard: str,
    threshold: float,
    payout: float,
) -> Dict[str, Any]:
    """
    Evaluate payout/no payout given an observation (NO API calls).

    Returns a clean dict suitable for:
    - logs
    - oracle message payload
    - contract call arguments (after encoding)
    """
    trig = evaluate_trigger(observation=observation, threshold=threshold, hazard=hazard)

    if "error" in trig:
        return {
            "status": "error",
            "hazard": hazard,
            "error": trig["error"],
            "triggered": False,
            "payout": float(payout),
            "payout_due": 0.0,
        }

    payout_due = float(payout) if trig["triggered"] else 0.0

    return {
        "status": "ok",
        "hazard": hazard,
        "date": trig.get("date"),
        "triggered": bool(trig["triggered"]),
        "value": float(trig["value"]),
        "threshold": float(trig["threshold"]),
        "direction": trig["direction"],     # "high_is_bad" / "low_is_bad"
        "margin": float(trig["margin"]),
        "payout": float(payout),
        "payout_due": payout_due,
    }


def check_event_and_payout(
    lat: float,
    lon: float,
    hazard: str,
    threshold: float,
    payout: float,
    lookback_months: int = 3,
) -> Dict[str, Any]:
    """
    Convenience one-liner:
      - calls the external API to fetch the latest event
      - evaluates trigger and payout
      - returns a single payload dict
    """
    obs = check_actual_event(lat=lat, lon=lon, hazard=hazard, lookback_months=lookback_months)

    decision = evaluate_payout(
        observation=obs,
        hazard=hazard,
        threshold=threshold,
        payout=payout,
    )

    # Attach provenance metadata if observation is valid
    if "error" not in obs:
        decision.update({
            "lat": float(obs.get("lat", lat)),
            "lon": float(obs.get("lon", lon)),
            "unit": obs.get("unit"),
            "variable": obs.get("variable"),
            "aggregation": obs.get("aggregation"),
            "source": obs.get("source"),
            "raw_daily_count": obs.get("raw_daily_count", None),
        })
    else:
        decision.update({
            "lat": float(lat),
            "lon": float(lon),
            "source": obs.get("source"),
        })

    return decision


if __name__ == "__main__":
    print("=" * 70)
    print("ORACLE CHECKER DEMO")
    print("Fetch latest event AND compute payout/no payout")
    print("=" * 70)

    lat, lon = 41.86, -87.65

    demo_thresholds = {
        "flood": 50.0,
        "heatwave": 25.0,
        "waterstress": 0.20,
        "drought": -50.0,
    }
    payout = 10_000.0

    for hazard, threshold in demo_thresholds.items():
        print(f"\n--- {hazard.upper()} ---")
        out = check_event_and_payout(
            lat=lat, lon=lon,
            hazard=hazard,
            threshold=threshold,
            payout=payout,
        )
        if out["status"] != "ok":
            print(f"  Error: {out.get('error')}")
            continue

        print(f"  Date: {out['date']}")
        print(f"  Value: {out['value']} {out.get('unit')}")
        print(f"  Threshold: {out['threshold']} ({out['direction']})")
        print(f"  Triggered: {out['triggered']} (margin: {out['margin']:.4f})")
        print(f"  Payout due: {out['payout_due']:.2f} USDC")