#!/usr/bin/env python3
"""
Generic parametric premium map runner.

Usage:
    python run_map.py --config configs/earthquake_italy.json
    python run_map.py --config configs/rainfall_northern_italy.json

The config JSON controls:
  - region bbox & grid resolution
  - trigger rule selection + parameters
  - fetcher selection + parameters
  - pricing parameters (L, alpha, T_years, …)
  - output file paths

The pricing engine is imported unchanged and never fetches data.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys

from src.pricing_engine import compute_premiums
from src.trigger_rules import get_trigger
from src.fetchers import get_fetcher
from src.output_writers import write_geojson, write_csv, write_html_map


# ============================================================================
# Grid builder
# ============================================================================

def build_grid(bbox: dict, grid_step: float) -> list[dict]:
    """Build a regular lat/lon pixel grid within *bbox*."""
    units: list[dict] = []
    lat = bbox["min_lat"] + grid_step / 2.0
    idx = 0
    while lat < bbox["max_lat"]:
        lon = bbox["min_lon"] + grid_step / 2.0
        while lon < bbox["max_lon"]:
            units.append({
                "id": f"px_{idx:06d}",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            })
            idx += 1
            lon += grid_step
        lat += grid_step
    print(f"Grid: {len(units)} pixels  (step={grid_step}°)")
    return units


# ============================================================================
# Summary statistics
# ============================================================================

def print_summary(results: list[dict], n_total: int, n_above: int,
                  threshold: float) -> None:
    premiums = [r["premium"] for r in results]
    nonzero = [p for p in premiums if p > 0]
    n_zero = len(premiums) - len(nonzero)
    pct_zero = 100.0 * n_zero / len(premiums) if premiums else 0.0

    print("\n===== Summary =====")
    print(f"Events fetched (total):          {n_total}")
    print(f"Events with value >= {threshold}: {n_above}")
    print(f"Grid pixels:                     {len(premiums)}")
    print(f"Pixels with premium = 0:         {n_zero}  ({pct_zero:.1f}%)")
    print(f"Pixels with premium > 0:         {len(nonzero)}")
    if nonzero:
        print(f"  Min premium:    ${min(nonzero):.4f}")
        print(f"  Median premium: ${statistics.median(nonzero):.4f}")
        print(f"  Max premium:    ${max(nonzero):.4f}")
    print("===================\n")


# ============================================================================
# Main pipeline
# ============================================================================

def run(config_path: str) -> None:
    # 1) Load config
    with open(config_path) as f:
        cfg = json.load(f)

    product = cfg["product"]
    bbox = cfg["bbox"]
    grid_step = cfg["grid_step"]
    pricing_params = cfg["pricing_params"]
    trigger_name = cfg["trigger_rule"]
    fetcher_cfg = cfg["fetcher"]
    outputs = cfg["outputs"]

    print(f"=== {product} ===")
    print(f"Bbox: lat [{bbox['min_lat']}, {bbox['max_lat']}]  "
          f"lon [{bbox['min_lon']}, {bbox['max_lon']}]")
    print(f"Window: {cfg['time_start']} → {cfg['time_end']}")
    print(f"Grid step: {grid_step}°")
    print(f"Trigger: {trigger_name}")
    print(f"Params: {json.dumps(pricing_params, indent=None)}\n")

    # 2) Fetch events
    fetcher = get_fetcher(
        fetcher_cfg["name"],
        bbox=bbox,
        time_start=cfg["time_start"],
        time_end=cfg["time_end"],
        **fetcher_cfg.get("params", {}),
    )
    events = fetcher.fetch()
    n_total = len(events)
    threshold = pricing_params.get("threshold", pricing_params.get("M0", 0))
    n_above = sum(1 for e in events if e.get("value", e.get("magnitude", 0)) >= threshold)

    # 3) Build grid
    units = build_grid(bbox, grid_step)

    # 4) Resolve trigger rule
    trigger_fn = get_trigger(trigger_name)

    # 5) Call the pricing engine (unchanged)
    input_json = {
        "units": units,
        "events": events,
        "params": pricing_params,
    }

    print("Running pricing engine …")
    output = compute_premiums(input_json, trigger_fn=trigger_fn)
    results = output["results"]

    # Enrich results with lat/lon for output writers
    unit_lookup = {u["id"]: u for u in units}
    for r in results:
        u = unit_lookup[r["id"]]
        r["_lat"] = u["lat"]
        r["_lon"] = u["lon"]

    # 6) Summary
    print_summary(results, n_total, n_above, threshold)

    # 7) Write outputs
    legend = (
        f"threshold={threshold} &nbsp; "
        f"R={pricing_params.get('R_km', 'n/a')} km &nbsp; "
        f"L=${pricing_params['L']:.0f} &nbsp; "
        f"α={pricing_params['alpha']}"
    )

    write_geojson(results, grid_step, outputs["geojson"])
    write_csv(results, outputs["csv"])
    write_html_map(
        results, grid_step, bbox, outputs["html"],
        title=f"Premium Map — {product}",
        legend_extra=legend,
    )

    print("Done.")


# ============================================================================
# CLI entry point
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generic parametric premium map runner."
    )
    parser.add_argument(
        "--config", required=True,
        help="Path to product configuration JSON file.",
    )
    args = parser.parse_args()
    run(args.config)


if __name__ == "__main__":
    main()
