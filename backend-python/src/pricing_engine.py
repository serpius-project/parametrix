"""
Generic Parametric Pricing Engine — Event-Driven Time Series.

The engine is event-type agnostic.  It consumes:
  - units   (pixels / regions / index keys)
  - events  (normalised to the generic schema: lat, lon, time, value)
  - params  (pricing + trigger parameters)
  - a deterministic trigger function

Pricing equations (Poisson model) are unchanged from the .md specification.
"""

import math
from typing import Any, Callable, Protocol


# ============================================================================
# Haversine distance (km) — public, used by trigger rules
# ============================================================================

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two WGS-84 points."""
    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)
    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


# Keep the old private name as an alias so existing imports still work.
_haversine_km = haversine_km


# ============================================================================
# Trigger function protocol
# ============================================================================

class TriggerFn(Protocol):
    """Any callable(unit, event, params) -> bool."""
    def __call__(self, unit: dict, event: dict, params: dict) -> bool: ...


# ============================================================================
# Legacy earthquake trigger (backward-compatible default)
# ============================================================================

def earthquake_trigger(unit: dict, event: dict, params: dict) -> bool:
    """Earthquake trigger: magnitude >= M0 AND haversine <= R_km.

    Works with BOTH the legacy event schema (``magnitude`` field) and the
    generic schema (``value`` field).  This keeps existing callers working.
    """
    mag = event.get("value", event.get("magnitude"))
    if mag is None:
        raise ValueError("Event has neither 'value' nor 'magnitude' field")
    if mag < params["M0"]:
        return False
    dist = haversine_km(unit["lat"], unit["lon"], event["lat"], event["lon"])
    return dist <= params["R_km"]


# ============================================================================
# Input validation
# ============================================================================

# Core pricing params required by the Poisson model (always mandatory).
_PRICING_PARAMS = {"T_years", "L", "alpha", "T_hist_years"}

# The earthquake default also needs these (for backward compat).
_EARTHQUAKE_EXTRA_PARAMS = {"M0", "R_km"}

# Unit must always have an id.  lat/lon are required for geo triggers but
# optional for index-based triggers — validated per trigger rule, not here.
_REQUIRED_UNIT_FIELDS = {"id"}

# Generic normalised event fields.
_REQUIRED_EVENT_FIELDS_GENERIC = {"lat", "lon", "value", "time"}

# Legacy earthquake event fields (accepted as alternative).
_REQUIRED_EVENT_FIELDS_LEGACY = {"lat", "lon", "magnitude", "time"}


def _assert_finite_number(value: Any, name: str) -> None:
    if not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be finite, got {value}")


def _validate_input(input_json: dict, require_earthquake_params: bool) -> None:
    """Validate the input dict structure.

    Parameters
    ----------
    require_earthquake_params : bool
        If True, also require M0 and R_km (backward-compatible earthquake mode).
    """
    if not isinstance(input_json, dict):
        raise ValueError("input_json must be a dict")

    # --- units ---
    if "units" not in input_json:
        raise ValueError("Missing 'units' key")
    units = input_json["units"]
    if not isinstance(units, list) or len(units) == 0:
        raise ValueError("'units' must be a non-empty list")
    for i, u in enumerate(units):
        if "id" not in u:
            raise ValueError(f"Unit at index {i} missing 'id'")

    # --- events ---
    if "events" not in input_json:
        raise ValueError("Missing 'events' key")
    events = input_json["events"]
    if not isinstance(events, list):
        raise ValueError("'events' must be a list")
    for i, e in enumerate(events):
        # Accept either generic or legacy schema
        has_generic = _REQUIRED_EVENT_FIELDS_GENERIC.issubset(e)
        has_legacy = _REQUIRED_EVENT_FIELDS_LEGACY.issubset(e)
        if not has_generic and not has_legacy:
            raise ValueError(
                f"Event at index {i} must have fields "
                f"{_REQUIRED_EVENT_FIELDS_GENERIC} (generic) or "
                f"{_REQUIRED_EVENT_FIELDS_LEGACY} (legacy earthquake)"
            )
        # Validate numeric fields that are present
        if "lat" in e:
            _assert_finite_number(e["lat"], f"events[{i}].lat")
        if "lon" in e:
            _assert_finite_number(e["lon"], f"events[{i}].lon")
        if "value" in e:
            _assert_finite_number(e["value"], f"events[{i}].value")
        if "magnitude" in e:
            _assert_finite_number(e["magnitude"], f"events[{i}].magnitude")

    # --- params ---
    if "params" not in input_json:
        raise ValueError("Missing 'params' key")
    params = input_json["params"]

    required = set(_PRICING_PARAMS)
    if require_earthquake_params:
        required |= _EARTHQUAKE_EXTRA_PARAMS

    missing_p = required - set(params)
    if missing_p:
        raise ValueError(f"Missing params: {missing_p}")

    _assert_finite_number(params["T_years"], "params.T_years")
    _assert_finite_number(params["L"], "params.L")
    _assert_finite_number(params["alpha"], "params.alpha")
    _assert_finite_number(params["T_hist_years"], "params.T_hist_years")

    if params["T_hist_years"] <= 0:
        raise ValueError("T_hist_years must be > 0")
    if params["T_years"] < 0:
        raise ValueError("T_years must be >= 0")
    if params["L"] < 0:
        raise ValueError("L must be >= 0")
    if params["alpha"] < 0:
        raise ValueError("alpha must be >= 0")

    if "R_km" in params:
        _assert_finite_number(params["R_km"], "params.R_km")
        if params["R_km"] < 0:
            raise ValueError("R_km must be >= 0")
    if "M0" in params:
        _assert_finite_number(params["M0"], "params.M0")


# ============================================================================
# Core pricing engine — math is IDENTICAL to the .md specification
# ============================================================================

def compute_premiums(
    input_json: dict,
    trigger_fn: TriggerFn | None = None,
) -> dict:
    """Compute per-unit parametric insurance premiums.

    Parameters
    ----------
    input_json : dict
        ``{"units": [...], "events": [...], "params": {...}}``
    trigger_fn : callable(unit, event, params) -> bool, optional
        Deterministic trigger rule.  Defaults to ``earthquake_trigger``.

    Returns
    -------
    dict with keys ``params_echo`` and ``results``.
    """
    # Default to earthquake trigger for backward compatibility
    if trigger_fn is None:
        trigger_fn = earthquake_trigger
        _validate_input(input_json, require_earthquake_params=True)
    else:
        _validate_input(input_json, require_earthquake_params=False)

    units = input_json["units"]
    events = input_json["events"]
    params = input_json["params"]

    T_hist_years: float = params["T_hist_years"]
    T_years: float = params["T_years"]
    L: float = params["L"]
    alpha: float = params["alpha"]

    results: list[dict] = []

    for unit in units:
        # --- count trigger-eligible events ---
        n_trigger = 0
        for event in events:
            if trigger_fn(unit, event, params):
                n_trigger += 1

        # --- pricing formulas (spec §2) ---
        if n_trigger == 0 or T_years == 0 or L == 0:
            results.append({
                "id": unit["id"],
                "n_trigger_events": n_trigger,
                "lambda": 0.0 if n_trigger == 0 else n_trigger / T_hist_years,
                "trigger_probability": 0.0,
                "expected_loss": 0.0,
                "premium": 0.0,
            })
        else:
            lam = n_trigger / T_hist_years
            p_trigger = 1.0 - math.exp(-lam * T_years)
            expected_loss = L * p_trigger
            premium = expected_loss * (1.0 + alpha)

            results.append({
                "id": unit["id"],
                "n_trigger_events": n_trigger,
                "lambda": lam,
                "trigger_probability": p_trigger,
                "expected_loss": expected_loss,
                "premium": premium,
            })

    return {
        "params_echo": params,
        "results": results,
    }
