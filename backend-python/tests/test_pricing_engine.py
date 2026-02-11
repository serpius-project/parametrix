"""Minimal tests for the parametric pricing engine.

Tests cover:
  - haversine sanity
  - backward-compatible earthquake (legacy schema)
  - generic schema with custom trigger
  - all edge cases from the spec
  - validation errors
  - determinism
"""

import math
import pytest
from src.pricing_engine import compute_premiums, _haversine_km, haversine_km


# ---------------------------------------------------------------------------
# Haversine sanity
# ---------------------------------------------------------------------------

def test_haversine_same_point():
    assert haversine_km(46.0, 8.9, 46.0, 8.9) == 0.0


def test_haversine_known_distance():
    d = haversine_km(47.3769, 8.5417, 46.9480, 7.4474)
    assert 90.0 < d < 100.0


def test_haversine_alias():
    """The old private alias still works."""
    assert _haversine_km(0, 0, 0, 0) == 0.0


# ---------------------------------------------------------------------------
# Spec example — legacy earthquake schema (backward compat)
# ---------------------------------------------------------------------------

def test_spec_example_legacy():
    """Reproduce the exact numbers from the md specification."""
    inp = {
        "units": [{"id": "px_0001", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 45.9, "lon": 8.95, "magnitude": 5.7,
             "time": "2012-05-20T02:03:00Z"}
        ],
        "params": {
            "M0": 5.5, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.20, "T_hist_years": 30.0,
        },
    }
    out = compute_premiums(inp)  # default trigger_fn = earthquake_trigger
    r = out["results"][0]

    assert r["id"] == "px_0001"
    assert r["n_trigger_events"] == 1
    assert math.isclose(r["lambda"], 1 / 30, rel_tol=1e-9)
    assert math.isclose(r["trigger_probability"], 1 - math.exp(-1 / 30), rel_tol=1e-9)
    assert math.isclose(r["expected_loss"], 1000 * (1 - math.exp(-1 / 30)), rel_tol=1e-9)
    assert math.isclose(r["premium"], 1000 * (1 - math.exp(-1 / 30)) * 1.2, rel_tol=1e-9)


# ---------------------------------------------------------------------------
# Generic schema with GeoRadiusThreshold trigger
# ---------------------------------------------------------------------------

def test_generic_schema_geo_radius():
    """Generic events (value field) with an explicit trigger_fn."""
    from src.trigger_rules import GeoRadiusThreshold
    trigger = GeoRadiusThreshold()

    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 45.9, "lon": 8.95, "value": 5.7,
             "time": "2012-05-20T02:03:00Z"}
        ],
        "params": {
            "threshold": 5.5, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.20, "T_hist_years": 30.0,
        },
    }
    out = compute_premiums(inp, trigger_fn=trigger)
    r = out["results"][0]
    assert r["n_trigger_events"] == 1
    assert math.isclose(r["lambda"], 1 / 30, rel_tol=1e-9)


def test_generic_below_threshold():
    from src.trigger_rules import GeoRadiusThreshold
    trigger = GeoRadiusThreshold()

    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 46.0, "lon": 8.9, "value": 100.0,
             "time": "2020-01-01T00:00:00Z"}
        ],
        "params": {
            "threshold": 150.0, "R_km": 50.0, "T_years": 1.0,
            "L": 5000.0, "alpha": 0.25, "T_hist_years": 20.0,
        },
    }
    r = compute_premiums(inp, trigger_fn=trigger)["results"][0]
    assert r["n_trigger_events"] == 0
    assert r["premium"] == 0.0


# ---------------------------------------------------------------------------
# IndexTimeSeriesThreshold trigger
# ---------------------------------------------------------------------------

def test_index_timeseries_trigger():
    from src.trigger_rules import IndexTimeSeriesThreshold
    trigger = IndexTimeSeriesThreshold()

    inp = {
        "units": [
            {"id": "region_A"},
            {"id": "region_B"},
        ],
        "events": [
            {"unit_id": "region_A", "value": 120.0, "lat": 0, "lon": 0,
             "time": "2020-03-01T00:00:00Z"},
            {"unit_id": "region_A", "value": 80.0, "lat": 0, "lon": 0,
             "time": "2021-07-01T00:00:00Z"},
            {"unit_id": "region_B", "value": 200.0, "lat": 0, "lon": 0,
             "time": "2022-01-01T00:00:00Z"},
        ],
        "params": {
            "threshold": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.10, "T_hist_years": 10.0,
        },
    }
    out = compute_premiums(inp, trigger_fn=trigger)
    by_id = {r["id"]: r for r in out["results"]}

    assert by_id["region_A"]["n_trigger_events"] == 1  # only the 120
    assert by_id["region_B"]["n_trigger_events"] == 1  # the 200
    assert math.isclose(by_id["region_A"]["lambda"], 0.1, rel_tol=1e-9)


# ---------------------------------------------------------------------------
# PolygonContainsThreshold trigger
# ---------------------------------------------------------------------------

def test_polygon_contains_trigger():
    from src.trigger_rules import PolygonContainsThreshold
    trigger = PolygonContainsThreshold()

    # A simple square polygon [0,0] → [1,0] → [1,1] → [0,1]
    square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]

    inp = {
        "units": [{"id": "sq1", "polygon": square}],
        "events": [
            # Inside the square, above threshold
            {"lat": 0.5, "lon": 0.5, "value": 200.0,
             "time": "2020-01-01T00:00:00Z"},
            # Inside but below threshold
            {"lat": 0.5, "lon": 0.5, "value": 50.0,
             "time": "2020-06-01T00:00:00Z"},
            # Outside the square, above threshold
            {"lat": 5.0, "lon": 5.0, "value": 300.0,
             "time": "2021-01-01T00:00:00Z"},
        ],
        "params": {
            "threshold": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.15, "T_hist_years": 10.0,
        },
    }
    out = compute_premiums(inp, trigger_fn=trigger)
    r = out["results"][0]
    assert r["n_trigger_events"] == 1  # only the 200 inside


# ---------------------------------------------------------------------------
# Edge cases from spec (still legacy schema for backward compat)
# ---------------------------------------------------------------------------

def test_no_qualifying_events():
    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 46.0, "lon": 8.9, "magnitude": 3.0,
             "time": "2020-01-01T00:00:00Z"}
        ],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.2, "T_hist_years": 30.0,
        },
    }
    r = compute_premiums(inp)["results"][0]
    assert r["n_trigger_events"] == 0
    assert r["premium"] == 0.0


def test_event_too_far():
    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 50.0, "lon": 8.9, "magnitude": 7.0,
             "time": "2020-01-01T00:00:00Z"}
        ],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.2, "T_hist_years": 30.0,
        },
    }
    r = compute_premiums(inp)["results"][0]
    assert r["n_trigger_events"] == 0
    assert r["premium"] == 0.0


def test_T_years_zero():
    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 46.0, "lon": 8.9, "magnitude": 7.0,
             "time": "2020-01-01T00:00:00Z"}
        ],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 0.0,
            "L": 1000.0, "alpha": 0.2, "T_hist_years": 30.0,
        },
    }
    r = compute_premiums(inp)["results"][0]
    assert r["premium"] == 0.0


def test_L_zero():
    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 46.0, "lon": 8.9, "magnitude": 7.0,
             "time": "2020-01-01T00:00:00Z"}
        ],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 0.0, "alpha": 0.2, "T_hist_years": 30.0,
        },
    }
    r = compute_premiums(inp)["results"][0]
    assert r["premium"] == 0.0


def test_empty_events():
    inp = {
        "units": [{"id": "u1", "lat": 46.0, "lon": 8.9}],
        "events": [],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.2, "T_hist_years": 30.0,
        },
    }
    r = compute_premiums(inp)["results"][0]
    assert r["n_trigger_events"] == 0
    assert r["premium"] == 0.0


def test_two_units_two_events():
    inp = {
        "units": [
            {"id": "A", "lat": 46.0, "lon": 8.9},
            {"id": "B", "lat": 48.0, "lon": 12.0},
        ],
        "events": [
            {"lat": 46.05, "lon": 8.92, "magnitude": 6.0,
             "time": "2010-01-01T00:00:00Z"},
            {"lat": 48.01, "lon": 12.01, "magnitude": 5.5,
             "time": "2015-06-01T00:00:00Z"},
        ],
        "params": {
            "M0": 5.5, "R_km": 50.0, "T_years": 1.0,
            "L": 500.0, "alpha": 0.1, "T_hist_years": 20.0,
        },
    }
    out = compute_premiums(inp)
    by_id = {r["id"]: r for r in out["results"]}
    assert by_id["A"]["n_trigger_events"] == 1
    assert by_id["B"]["n_trigger_events"] == 1
    for uid in ("A", "B"):
        assert math.isclose(by_id[uid]["lambda"], 0.05, rel_tol=1e-9)


# ---------------------------------------------------------------------------
# Validation errors
# ---------------------------------------------------------------------------

def test_missing_params_key():
    with pytest.raises(ValueError, match="Missing 'params'"):
        compute_premiums({"units": [{"id": "x", "lat": 0, "lon": 0}], "events": []})


def test_negative_alpha():
    inp = {
        "units": [{"id": "u1", "lat": 0, "lon": 0}],
        "events": [],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": -0.1, "T_hist_years": 30.0,
        },
    }
    with pytest.raises(ValueError, match="alpha"):
        compute_premiums(inp)


def test_zero_T_hist_years():
    inp = {
        "units": [{"id": "u1", "lat": 0, "lon": 0}],
        "events": [],
        "params": {
            "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.2, "T_hist_years": 0.0,
        },
    }
    with pytest.raises(ValueError, match="T_hist_years"):
        compute_premiums(inp)


def test_params_echo():
    params = {
        "M0": 5.0, "R_km": 100.0, "T_years": 1.0,
        "L": 1000.0, "alpha": 0.2, "T_hist_years": 30.0,
    }
    inp = {
        "units": [{"id": "u1", "lat": 0, "lon": 0}],
        "events": [],
        "params": params,
    }
    out = compute_premiums(inp)
    assert out["params_echo"] == params


# ---------------------------------------------------------------------------
# Generic validation: custom trigger doesn't need M0/R_km
# ---------------------------------------------------------------------------

def test_generic_trigger_no_earthquake_params():
    """With a custom trigger_fn, M0 and R_km are not required."""
    from src.trigger_rules import IndexTimeSeriesThreshold
    trigger = IndexTimeSeriesThreshold()

    inp = {
        "units": [{"id": "u1"}],
        "events": [
            {"unit_id": "u1", "value": 10.0, "lat": 0, "lon": 0,
             "time": "2020-01-01T00:00:00Z"},
        ],
        "params": {
            "threshold": 5.0, "T_years": 1.0,
            "L": 100.0, "alpha": 0.0, "T_hist_years": 10.0,
        },
    }
    out = compute_premiums(inp, trigger_fn=trigger)
    assert out["results"][0]["n_trigger_events"] == 1


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_deterministic():
    inp = {
        "units": [{"id": "px_0001", "lat": 46.0, "lon": 8.9}],
        "events": [
            {"lat": 45.9, "lon": 8.95, "magnitude": 5.7,
             "time": "2012-05-20T02:03:00Z"}
        ],
        "params": {
            "M0": 5.5, "R_km": 100.0, "T_years": 1.0,
            "L": 1000.0, "alpha": 0.20, "T_hist_years": 30.0,
        },
    }
    a = compute_premiums(inp)
    b = compute_premiums(inp)
    assert a == b


# ---------------------------------------------------------------------------
# Synthetic rainfall fetcher determinism
# ---------------------------------------------------------------------------

def test_synthetic_rainfall_deterministic():
    from src.fetchers.synthetic_rainfall import SyntheticRainfallFetcher
    bbox = {"min_lat": 44.0, "max_lat": 47.0, "min_lon": 7.0, "max_lon": 13.0}
    f1 = SyntheticRainfallFetcher(bbox=bbox, time_start="2005-01-01",
                                   time_end="2025-01-01", seed=42)
    f2 = SyntheticRainfallFetcher(bbox=bbox, time_start="2005-01-01",
                                   time_end="2025-01-01", seed=42)
    assert f1.fetch() == f2.fetch()
