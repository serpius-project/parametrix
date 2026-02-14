"""
Premium Calculator for Data Center Climate Risk Insurance.

Self-contained module — no dependency on dc_risk package.
Requires only: numpy, scipy, json.

Usage
-----
    from premium_calculator import calculate_premium, load_site_parameters

    # Load parameters once at startup
    sites = load_site_parameters("site_parameters.json")

    # Calculate premium for a user
    result = calculate_premium(
        lat=41.86,
        lon=-87.65,
        hazard="flood",
        threshold=50.0,
        n_months=12,
        payout=10_000,          # USDC payout if trigger is breached
        loading_factor=0.20,    # insurer markup (20%)
        sites=sites,
    )
    print(result)

Hazards & Distributions
-----------------------
| Hazard       | Distribution  | Trigger direction | Physical unit      |
|-------------|---------------|-------------------|--------------------|
| flood       | Weibull (min) | high is bad       | m3/s (river flow)  |
| heatwave    | GEV           | high is bad       | C (wet-bulb temp)  |
| waterstress | LogitNormal   | low is bad        | m3/m3 (soil moist) |
| drought     | Johnson SU    | low is bad        | mm (water deficit) |
"""

import json
import math
from typing import Optional

import numpy as np
from scipy import stats, integrate

# ── Hazard configuration ──────────────────────────────────────────────

HAZARD_CONFIG = {
    "flood": {
        "family": "weibull_min",
        "param_names": ["c", "loc", "scale"],
        "direction": "high_is_bad",
        "unit": "m3/s",
        "description": "River discharge (monthly max)",
    },
    "heatwave": {
        "family": "genextreme",
        "param_names": ["c", "loc", "scale"],
        "direction": "high_is_bad",
        "unit": "C",
        "description": "Wet-bulb temperature (monthly max)",
    },
    "waterstress": {
        "family": "logitnormal",
        "param_names": ["mu", "sigma"],
        "direction": "low_is_bad",
        "unit": "m3/m3",
        "description": "Soil moisture (monthly mean)",
    },
    "drought": {
        "family": "johnsonsu",
        "param_names": ["a", "b", "loc", "scale"],
        "direction": "low_is_bad",
        "unit": "mm",
        "description": "Water deficit D_mm (precip - PET, mm/month)",
    },
}


# ── LogitNormal distribution ──────────────────────────────────────────

class LogitNormalDist:
    """
    LogitNormal distribution with scipy-like interface.

    If X ~ LogitNormal(mu, sigma), then logit(X) ~ Normal(mu, sigma).
    Support: (0, 1).
    """

    def __init__(self, mu: float, sigma: float):
        self.mu = mu
        self.sigma = sigma

    def cdf(self, x):
        x = np.clip(x, 1e-12, 1 - 1e-12)
        logit_x = np.log(x / (1 - x))
        return stats.norm.cdf(logit_x, self.mu, self.sigma)

    def sf(self, x):
        return 1.0 - self.cdf(x)

    def pdf(self, x):
        x = np.clip(x, 1e-12, 1 - 1e-12)
        logit_x = np.log(x / (1 - x))
        return stats.norm.pdf(logit_x, self.mu, self.sigma) / (x * (1 - x))

    def ppf(self, q):
        z = stats.norm.ppf(q, self.mu, self.sigma)
        return 1.0 / (1.0 + np.exp(-z))

    def std(self):
        return float(self.ppf(0.841) - self.ppf(0.159)) / 2.0


# ── Distribution builder ──────────────────────────────────────────────

def _build_distribution(family: str, params: dict):
    """Reconstruct a frozen scipy distribution from stored parameters."""
    if family == "genextreme":
        return stats.genextreme(c=params["c"], loc=params["loc"], scale=params["scale"])
    elif family == "weibull_min":
        return stats.weibull_min(c=params["c"], loc=params["loc"], scale=params["scale"])
    elif family == "logitnormal":
        return LogitNormalDist(mu=params["mu"], sigma=params["sigma"])
    elif family == "johnsonsu":
        return stats.johnsonsu(a=params["a"], b=params["b"], loc=params["loc"], scale=params["scale"])
    else:
        raise ValueError(f"Unknown distribution family: {family}")


# ── Spatial lookup ────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
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


def _find_nearest_site(lat: float, lon: float, sites: list) -> tuple:
    """
    Find the site closest to (lat, lon).

    Returns
    -------
    (site_dict, distance_km)
    """
    best_site = None
    best_dist = float("inf")
    for site in sites:
        d = _haversine_km(lat, lon, site["lat"], site["lon"])
        if d < best_dist:
            best_dist = d
            best_site = site
    return best_site, best_dist


# ── Conditional expectations ──────────────────────────────────────────

def _conditional_expectation_above(dist, threshold: float, exceedance_prob: float) -> float:
    """E[X - threshold | X > threshold] via numerical integration."""
    if exceedance_prob < 1e-12:
        return 0.0

    ub = dist.ppf(0.99999)
    if np.isnan(ub) or np.isinf(ub):
        ub = threshold + 10 * dist.std()

    val, _ = integrate.quad(
        lambda x: (x - threshold) * dist.pdf(x),
        threshold, ub, limit=100,
    )
    return max(val / exceedance_prob, 0.0)


def _conditional_expectation_below(dist, threshold: float, exceedance_prob: float) -> float:
    """E[threshold - X | X < threshold] via numerical integration."""
    if exceedance_prob < 1e-12:
        return 0.0

    lb = dist.ppf(0.00001)
    if np.isnan(lb) or np.isinf(lb):
        lb = threshold - 10 * dist.std()

    val, _ = integrate.quad(
        lambda x: (threshold - x) * dist.pdf(x),
        lb, threshold, limit=100,
    )
    return max(val / exceedance_prob, 0.0)


# ── Site parameters loader ────────────────────────────────────────────

def load_site_parameters(path: str = "site_parameters.json") -> dict:
    """
    Load the site parameters JSON.

    Returns
    -------
    dict
        Keys: site names. Values: dicts with lat, lon, city, hazards.
    """
    with open(path) as f:
        return json.load(f)


# ── Main premium function ─────────────────────────────────────────────

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
        Trigger value in physical units:
        - flood: river discharge in m3/s               (e.g. 50)
        - heatwave: wet-bulb temperature in C           (e.g. 25)
        - waterstress: soil moisture in m3/m3           (e.g. 0.15)
        - drought: water deficit D_mm in mm/month       (e.g. -50)
    n_months : int
        Coverage period in months (default 12).
    payout : float
        Payout in USDC if trigger is breached (default 10,000).
    loading_factor : float
        Insurer markup (0.20 = 20%).
    sites : dict, optional
        Pre-loaded site parameters (from load_site_parameters).
        If None, loads from site_parameters_path.
    site_parameters_path : str
        Path to site_parameters.json (used if sites is None).

    Returns
    -------
    dict with keys:
        site_name, city, site_lat, site_lon, distance_km,
        hazard, distribution, threshold, unit,
        exceedance_prob, expected_severity,
        expected_loss_monthly, n_months, pure_premium,
        premium_usdc, payout, loading_factor,
        params, n_obs, ks_pvalue
    """
    # Validate hazard
    if hazard not in HAZARD_CONFIG:
        raise ValueError(
            f"Unknown hazard: '{hazard}'. "
            f"Choose from: {list(HAZARD_CONFIG.keys())}"
        )

    cfg = HAZARD_CONFIG[hazard]

    # Load site parameters
    if sites is None:
        sites = load_site_parameters(site_parameters_path)

    # Find nearest site
    site_list = list(sites.values())
    site, dist_km = _find_nearest_site(lat, lon, site_list)

    if site is None:
        raise ValueError("No sites found in parameters file.")

    # Check hazard is available for this site
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

    # Check convergence
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

    # Build distribution
    dist = _build_distribution(cfg["family"], params)

    # Compute exceedance probability & expected severity
    if cfg["direction"] == "high_is_bad":
        exceedance_prob = float(dist.sf(threshold))           # P(X > threshold)
        expected_severity = _conditional_expectation_above(dist, threshold, exceedance_prob)
    else:
        exceedance_prob = float(dist.cdf(threshold))          # P(X < threshold)
        expected_severity = _conditional_expectation_below(dist, threshold, exceedance_prob)

    # Expected loss per month (in physical units)
    expected_loss_monthly = exceedance_prob * expected_severity

    # Pure premium = loss/month * coverage months
    pure_premium = expected_loss_monthly * n_months

    # USDC premium = P(breach) * months * payout * (1 + loading)
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


# ── CLI demo ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os

    # Auto-detect path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    params_path = os.path.join(script_dir, "site_parameters.json")

    sites = load_site_parameters(params_path)

    # Demo: compute premiums for all 4 hazards at Lakeside Chicago
    demo_configs = [
        {"hazard": "flood",       "threshold": 50,    "label": "River discharge > 50 m3/s"},
        {"hazard": "heatwave",    "threshold": 25,    "label": "Wet-bulb temp > 25 C"},
        {"hazard": "waterstress", "threshold": 0.20,  "label": "Soil moisture < 0.20 m3/m3"},
        {"hazard": "drought",     "threshold": -50,   "label": "Water deficit < -50 mm/month"},
    ]

    print("=" * 70)
    print("PREMIUM CALCULATOR DEMO")
    print(f"Location: Lakeside Tech Center, Chicago (41.86, -87.65)")
    print(f"Payout: 10,000 USDC | Coverage: 12 months | Loading: 20%")
    print("=" * 70)

    for cfg in demo_configs:
        result = calculate_premium(
            lat=41.86, lon=-87.65,
            hazard=cfg["hazard"],
            threshold=cfg["threshold"],
            n_months=12,
            payout=10_000,
            loading_factor=0.20,
            sites=sites,
        )
        print(f"\n--- {cfg['hazard'].upper()} ({cfg['label']}) ---")
        print(f"  Site: {result['site_name']} ({result['city']})")
        print(f"  Distribution: {result['distribution']}")
        print(f"  Exceedance prob: {result['exceedance_prob']:.4%}")
        print(f"  Expected severity: {result['expected_severity']:.4f} {result['unit']}")
        print(f"  Pure premium (12mo): {result['pure_premium']:.4f}")
        print(f"  USDC Premium: {result['premium_usdc']:.2f} USDC")
