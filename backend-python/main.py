"""
Data Center Climate Risk Insurance — API entry points.

Three endpoint functions:
    1. calculate_premium()       — compute parametric insurance premium
    2. check_event_and_payout()  — fetch real observation + evaluate payout
    3. simulate_event_and_payout() — fake observation for demos + evaluate payout
"""

from typing import Optional, Dict, Any

from lib.premium_math import (
    HAZARD_CONFIG,
    load_site_parameters,
    conditional_expectation_above,
    conditional_expectation_below,
)
from lib.distributions import build_distribution
from lib.spatial import find_nearest_site
from lib.fetcher import (
    HAZARD_API_CONFIG,
    fetch_latest_observation,
    evaluate_trigger,
)
from lib.simulator import simulate_observation


# ── Endpoint 1: Premium calculation ──────────────────────────────────

def calculate_premium(
    lat: float,
    lon: float,
    hazard: str,
    threshold: float,
    n_months: int = 12,
    payout: float = 10_000.0,
    loading_factor: float = 0.20,
    sites: Optional[dict] = None,
    site_parameters_path: str = "site_parameters.json",
) -> dict:
    """
    Calculate the parametric insurance premium for a location and hazard.

    Parameters
    ----------
    lat, lon : float
        User coordinates. Snapped to nearest data center site.
    hazard : str
        "flood" | "heatwave" | "waterstress" | "drought"
    threshold : float
        Trigger value in physical units.
    n_months : int
        Coverage period in months (default 12).
    payout : float
        Payout in USDC if trigger is breached (default 10,000).
    loading_factor : float
        Insurer markup (0.20 = 20%).
    sites : dict, optional
        Pre-loaded site parameters. If None, loads from site_parameters_path.
    site_parameters_path : str
        Path to site_parameters.json (used if sites is None).

    Returns
    -------
    dict with premium details, site info, and distribution metadata.
    """
    if hazard not in HAZARD_CONFIG:
        raise ValueError(
            f"Unknown hazard: '{hazard}'. "
            f"Choose from: {list(HAZARD_CONFIG.keys())}"
        )

    cfg = HAZARD_CONFIG[hazard]

    if sites is None:
        sites = load_site_parameters(site_parameters_path)

    site_list = list(sites.values())
    site, dist_km = find_nearest_site(lat, lon, site_list)

    if site is None:
        raise ValueError("No sites found in parameters file.")

    if hazard not in site.get("hazards", {}):
        return {
            "site_name": site["name"],
            "city": site["city"],
            "site_lat": site["lat"],
            "site_lon": site["lon"],
            "distance_km": round(dist_km, 2),
            "hazard": hazard,
            "error": f"No {hazard} parameters available for this site.",
        }

    hazard_data = site["hazards"][hazard]
    params = hazard_data["params"]

    if not hazard_data.get("converged", False):
        return {
            "site_name": site["name"],
            "city": site["city"],
            "site_lat": site["lat"],
            "site_lon": site["lon"],
            "distance_km": round(dist_km, 2),
            "hazard": hazard,
            "error": "Distribution fit did not converge for this site.",
        }

    dist = build_distribution(cfg["family"], params)

    if cfg["direction"] == "high_is_bad":
        exceedance_prob = float(dist.sf(threshold))
        expected_severity = conditional_expectation_above(dist, threshold, exceedance_prob)
    else:
        exceedance_prob = float(dist.cdf(threshold))
        expected_severity = conditional_expectation_below(dist, threshold, exceedance_prob)

    expected_loss_monthly = exceedance_prob * expected_severity
    pure_premium = expected_loss_monthly * n_months
    premium_usdc = exceedance_prob * n_months * payout * (1 + loading_factor)

    return {
        "site_name": site["name"],
        "city": site["city"],
        "site_lat": site["lat"],
        "site_lon": site["lon"],
        "distance_km": round(dist_km, 2),
        "hazard": hazard,
        "distribution": cfg["family"],
        "threshold": threshold,
        "unit": cfg["unit"],
        "exceedance_prob": round(exceedance_prob, 6),
        "expected_severity": round(expected_severity, 4),
        "expected_loss_monthly": round(expected_loss_monthly, 6),
        "n_months": n_months,
        "pure_premium": round(pure_premium, 4),
        "premium_usdc": round(premium_usdc, 2),
        "payout": payout,
        "loading_factor": loading_factor,
        "params": params,
        "n_obs": hazard_data.get("n_obs", 0),
        "ks_pvalue": round(hazard_data.get("ks_pvalue", 0.0), 4),
    }


# ── Endpoint 2: Real oracle check + payout ──────────────────────────

def check_event_and_payout(
    lat: float,
    lon: float,
    hazard: str,
    threshold: float,
    payout: float,
    lookback_months: int = 3,
) -> Dict[str, Any]:
    """
    Fetch the latest real observation from Open-Meteo, evaluate trigger,
    and return a payout decision payload.

    Parameters
    ----------
    lat, lon : float
        Site coordinates.
    hazard : str
        "flood" | "heatwave" | "waterstress" | "drought"
    threshold : float
        Trigger threshold in physical units.
    payout : float
        USDC payout if trigger is breached.
    lookback_months : int
        Months to look back for data (default 3).

    Returns
    -------
    dict with observation data, trigger result, and payout decision.
    """
    obs = fetch_latest_observation(lat=lat, lon=lon, hazard=hazard, lookback_months=lookback_months)

    trig = evaluate_trigger(observation=obs, threshold=threshold, hazard=hazard)

    if "error" in trig:
        decision = {
            "status": "error",
            "hazard": hazard,
            "error": trig["error"],
            "triggered": False,
            "payout": float(payout),
            "payout_due": 0.0,
        }
    else:
        payout_due = float(payout) if trig["triggered"] else 0.0
        decision = {
            "status": "ok",
            "hazard": hazard,
            "date": trig.get("date"),
            "triggered": bool(trig["triggered"]),
            "value": float(trig["value"]),
            "threshold": float(trig["threshold"]),
            "direction": trig["direction"],
            "margin": float(trig["margin"]),
            "payout": float(payout),
            "payout_due": payout_due,
        }

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


# ── Endpoint 3: Simulated oracle check + payout ─────────────────────

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
    Simulate a fake observation (no API calls) and return a payout decision.
    Useful for demos, videos, and testing.

    Parameters
    ----------
    lat, lon : float
        Site coordinates.
    hazard : str
        "flood" | "heatwave" | "waterstress" | "drought"
    threshold : float
        Trigger threshold in physical units.
    payout : float
        USDC payout if triggered.
    force_trigger : bool
        If True, simulated value breaches the threshold.
    date_str : str, optional
        Override simulated date (default: 1st of current month).
    jitter_frac : float
        How far from threshold to place simulated value.

    Returns
    -------
    dict with simulated observation, trigger result, and payout decision.
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
