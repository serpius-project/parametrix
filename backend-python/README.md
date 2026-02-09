# Parametric Insurance Pricing Engine

A generic, event-driven parametric pricing framework for insurance products.
Computes per-pixel premiums from historical event data using a Poisson model.

Works with **any event type** — earthquakes, floods, fires, rainfall, power outages — by swapping the trigger rule and data source.

## Quick start

```bash
pip install -r requirements.txt

# Run the earthquake demo (Italy, USGS data)
python run_map.py --config configs/earthquake_italy.json

# Run the rainfall demo (Northern Italy, synthetic data)
python run_map.py --config configs/rainfall_northern_italy.json
```

Outputs are written to `output/` (GeoJSON, interactive HTML map, CSV).

## How it works

For each pixel on the grid:

1. **Count** historical events matching the trigger rule → `N_trigger`
2. **Annual rate** → `λ = N_trigger / T_hist_years`
3. **Trigger probability** → `P = 1 − exp(−λ × T_years)`
4. **Premium** → `L × P × (1 + α)`

The math is defined in [`docs/pricing_model_instructions.md`](docs/pricing_model_instructions.md) and implemented exactly in [`src/pricing_engine.py`](src/pricing_engine.py).

## Project structure

```
├── run_map.py                  # CLI entry point
├── configs/                    # Product configurations (JSON)
│   ├── earthquake_italy.json
│   └── rainfall_northern_italy.json
├── src/
│   ├── pricing_engine.py       # Core pricing engine (Poisson model)
│   ├── trigger_rules.py        # Pluggable trigger rules
│   ├── output_writers.py       # GeoJSON / CSV / HTML map writers
│   └── fetchers/               # Pluggable data fetchers
│       ├── usgs.py             # USGS Earthquake Catalog API
│       └── synthetic_rainfall.py
├── tests/
│   └── test_pricing_engine.py  # 21 tests
├── docs/                       # Specification documents
│   ├── pricing_model_instructions.md
│   ├── data_sources.md
│   └── claude_prompt.md
└── output/                     # Generated at runtime (gitignored)
```

## Trigger rules

| Rule | Use case | Match condition |
|---|---|---|
| `GeoRadiusThreshold` | Earthquakes, fires, rainfall stations | `distance ≤ R_km` AND `value ≥ threshold` |
| `PolygonContainsThreshold` | Flood zones, admin regions | `point in polygon` AND `value ≥ threshold` |
| `IndexTimeSeriesThreshold` | Power outages, custom indices | `event.unit_id == unit.id` AND `value ≥ threshold` |

## Adding a new product

1. Write a fetcher in `src/fetchers/` (or use synthetic data)
2. Choose a trigger rule (or write one)
3. Create a config JSON in `configs/`
4. Run: `python run_map.py --config configs/your_product.json`

## Tests

```bash
python -m pytest tests/ -v
```

## Design principles

- **Deterministic**: same input → same output, no randomness
- **Separation of concerns**: the pricing engine never fetches data
- **Auditable**: output includes `N_trigger`, `λ`, `P(trigger)` per pixel
- **Oracle-friendly**: all parameters explicit, JSON in/out
