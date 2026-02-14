# DC Climate Risk Premium — API Exports

Self-contained modules for the hackathon API. No dependency on the `dc_risk` package.

## Files

| File | Purpose |
|------|---------|
| `premium_calculator.py` | Calculates user premium for each risk type |
| `oracle_fetcher.py` | Fetches latest data point from Open-Meteo for the oracle |
| `site_parameters.json` | Distribution parameters for all 20 sites x 4 hazards |

## Quick Start

```python
from premium_calculator import calculate_premium, load_site_parameters
from oracle_fetcher import fetch_latest_observation, evaluate_trigger

# 1. Load parameters (once at startup)
sites = load_site_parameters("site_parameters.json")

# 2. Calculate premium for a user
result = calculate_premium(
    lat=41.86, lon=-87.65,        # user location (snaps to nearest DC)
    hazard="flood",                # flood | heatwave | waterstress | drought
    threshold=50.0,                # trigger value in physical units
    n_months=12,                   # coverage period
    payout=10_000,                 # USDC payout if triggered
    loading_factor=0.20,           # 20% insurer markup
    sites=sites,
)
print(f"Premium: {result['premium_usdc']:.2f} USDC")

# 3. Fetch latest observation for oracle
obs = fetch_latest_observation(lat=41.86, lon=-87.65, hazard="flood")
print(f"Latest: {obs['value']} {obs['unit']} on {obs['date']}")

# 4. Evaluate trigger
trigger = evaluate_trigger(obs, threshold=50.0, hazard="flood")
print(f"Triggered: {trigger['triggered']}")
```

## Dependencies

```
pip install numpy scipy requests pandas
```

## Hazard Reference

| Hazard | Distribution | Direction | Unit | Example threshold |
|--------|-------------|-----------|------|-------------------|
| `flood` | Weibull (min) | high is bad | m3/s | 50 |
| `heatwave` | GEV | high is bad | C | 25 |
| `waterstress` | LogitNormal | low is bad | m3/m3 | 0.15 |
| `drought` | Johnson SU | low is bad | mm | -50 |

## Premium Calculator Output

```json
{
    "site_name": "Lakeside Tech Center",
    "city": "Chicago, IL",
    "site_lat": 41.8536,
    "site_lon": -87.6181,
    "distance_km": 2.38,
    "hazard": "flood",
    "distribution": "weibull_min",
    "threshold": 50.0,
    "unit": "m3/s",
    "exceedance_prob": 1.0,
    "expected_severity": 262.03,
    "expected_loss_monthly": 262.03,
    "n_months": 12,
    "pure_premium": 3144.42,
    "premium_usdc": 144000.0,
    "payout": 10000,
    "loading_factor": 0.2,
    "params": {"c": 1.31, "loc": 83.29, "scale": 248.05},
    "n_obs": 307,
    "ks_pvalue": 0.4525
}
```

## Oracle Fetcher Output

```json
{
    "hazard": "flood",
    "lat": 41.875,
    "lon": -87.625,
    "date": "2026-02-01",
    "value": 45.24,
    "unit": "m3/s",
    "variable": "river_discharge_m3s_max",
    "aggregation": "monthly_max",
    "source": "Open-Meteo Flood API",
    "raw_daily_count": 106
}
```

## Sites (20 global data centers)

See `site_parameters.json` for the full list. Includes:
China Telecom Inner Mongolia, The Citadel (Switch), Harbin DC, Range Intl Info Hub,
Switch SuperNAP, Google Council Bluffs, Meta New Albany, Lakeside Tech Center,
CWL1 Data Centre, Utah Data Center (NSA), Mesa DC (Apple), QTS Atlanta Metro,
Tract Phoenix Campus, Tulip Data City, CoreSite Reston, Intergate Seattle (Sabey),
Iron Mountain NJE-1, Yotta NM1, Microsoft Quincy, Sines Data Center.
