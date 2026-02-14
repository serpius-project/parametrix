"""Premium calculation helpers: conditional expectations and site parameter loading."""

import json

import numpy as np
from scipy import integrate


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


# ── Conditional expectations ──────────────────────────────────────────

def conditional_expectation_above(dist, threshold: float, exceedance_prob: float) -> float:
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


def conditional_expectation_below(dist, threshold: float, exceedance_prob: float) -> float:
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
