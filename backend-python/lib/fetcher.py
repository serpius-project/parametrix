"""Oracle data fetching: API calls, aggregation, Thornthwaite PET, trigger evaluation."""

import time
from datetime import date, timedelta
from collections import defaultdict

import numpy as np
import requests


# ── API configuration ─────────────────────────────────────────────────

FLOOD_API = "https://flood-api.open-meteo.com/v1/flood"
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"

HAZARD_API_CONFIG = {
    "flood": {
        "url": FLOOD_API,
        "daily_vars": "river_discharge",
        "source": "Open-Meteo Flood API",
        "output_variable": "river_discharge_m3s_max",
        "unit": "m3/s",
        "aggregation": "monthly_max",
    },
    "heatwave": {
        "url": ARCHIVE_API,
        "daily_vars": "wet_bulb_temperature_2m_max",
        "source": "Open-Meteo Historical Weather API",
        "output_variable": "wbt_c_max",
        "unit": "C",
        "aggregation": "monthly_max",
    },
    "waterstress": {
        "url": ARCHIVE_API,
        "daily_vars": "soil_moisture_0_to_100cm_mean",
        "extra_params": {"models": "era5_land"},
        "source": "Open-Meteo Historical Weather API (ERA5-Land)",
        "output_variable": "soil_moisture_mean",
        "unit": "m3/m3",
        "aggregation": "monthly_mean",
    },
    "drought": {
        "url": ARCHIVE_API,
        "daily_vars": "temperature_2m_mean,precipitation_sum",
        "source": "Open-Meteo Historical Weather API",
        "output_variable": "D_mm",
        "unit": "mm",
        "aggregation": "monthly_thornthwaite_deficit",
    },
}


# ── HTTP with retry ───────────────────────────────────────────────────

def get_json(url: str, params: dict, timeout: int = 60, max_retries: int = 3) -> dict:
    """GET request with exponential backoff retry."""
    for attempt in range(max_retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429 and attempt < max_retries:
                wait = 2 ** (attempt + 1)
                time.sleep(wait)
                continue
            if r.status_code in (500, 502, 503, 504) and attempt < max_retries:
                wait = 2 ** (attempt + 1)
                time.sleep(wait)
                continue
            r.raise_for_status()
        except requests.exceptions.RequestException as exc:
            if attempt == max_retries:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"Max retries exceeded for {url}")


# ── Thornthwaite PET ──────────────────────────────────────────────────

def compute_thornthwaite_deficit(dates, temps, precips) -> tuple:
    """
    Compute monthly water deficit D_mm = precip - PET (Thornthwaite).

    Returns
    -------
    (monthly_dates, D_mm_values) : tuple of lists
    """
    import pandas as pd

    df = pd.DataFrame({
        "date": pd.to_datetime(dates),
        "temp_c": temps,
        "precip_mm": precips,
    }).dropna()

    if len(df) < 30:
        return [], []

    m = df.resample("MS", on="date").agg(
        temp_c=("temp_c", "mean"),
        precip_mm=("precip_mm", "sum"),
    )

    T = m["temp_c"].clip(lower=0)
    I = (T / 5.0) ** 1.514
    annual_I = I.rolling(12, center=True).sum().bfill().ffill()
    a = (6.75e-7 * annual_I**3) - (7.71e-5 * annual_I**2) + (1.79e-2 * annual_I) + 0.492
    annual_I_safe = annual_I.replace(0, np.nan).bfill().ffill()

    m["pet_mm_month"] = 16.0 * ((10.0 * T) / annual_I_safe) ** a
    m["D_mm"] = m["precip_mm"] - m["pet_mm_month"]

    dates_out = [d.strftime("%Y-%m-%d") for d in m.index]
    values_out = m["D_mm"].tolist()
    return dates_out, values_out


# ── Monthly aggregation ──────────────────────────────────────────────

def aggregate_monthly(dates: list, values: list, method: str) -> list:
    """
    Aggregate daily values to monthly.

    Returns
    -------
    list of (date_str, value) tuples, sorted by date.
    """
    monthly = defaultdict(list)
    for d, v in zip(dates, values):
        if v is None:
            continue
        month_key = d[:7] + "-01"
        monthly[month_key].append(float(v))

    result = []
    for month_key in sorted(monthly.keys()):
        vals = monthly[month_key]
        if not vals:
            continue
        if method == "max":
            agg = max(vals)
        elif method == "mean":
            agg = sum(vals) / len(vals)
        else:
            raise ValueError(f"Unknown method: {method}")
        result.append((month_key, agg))

    return result


# ── Main fetch function ───────────────────────────────────────────────

def fetch_latest_observation(
    lat: float,
    lon: float,
    hazard: str,
    lookback_months: int = 3,
) -> dict:
    """
    Fetch the latest observed value from Open-Meteo for a hazard.

    Returns
    -------
    dict with keys:
        hazard, lat, lon, date, value, unit, variable,
        aggregation, source, raw_daily_count
    """
    if hazard not in HAZARD_API_CONFIG:
        raise ValueError(
            f"Unknown hazard: '{hazard}'. "
            f"Choose from: {list(HAZARD_API_CONFIG.keys())}"
        )

    cfg = HAZARD_API_CONFIG[hazard]
    today = date.today()

    if hazard == "drought":
        lookback_months = max(lookback_months, 14)

    start_date = (today - timedelta(days=lookback_months * 31)).replace(day=1)

    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": cfg["daily_vars"],
        "start_date": start_date.isoformat(),
        "end_date": today.isoformat(),
        "timezone": "UTC",
    }
    params.update(cfg.get("extra_params", {}))

    data = get_json(cfg["url"], params)

    daily = data.get("daily", {})
    times = daily.get("time", [])

    if not times:
        return {
            "hazard": hazard,
            "lat": data.get("latitude", lat),
            "lon": data.get("longitude", lon),
            "error": "No daily data returned from API.",
            "source": cfg["source"],
        }

    if hazard == "flood":
        values = daily.get("river_discharge", [])
        monthly = aggregate_monthly(times, values, "max")

    elif hazard == "heatwave":
        values = daily.get("wet_bulb_temperature_2m_max", [])
        monthly = aggregate_monthly(times, values, "max")

    elif hazard == "waterstress":
        values = daily.get("soil_moisture_0_to_100cm_mean", [])
        monthly = aggregate_monthly(times, values, "mean")

    elif hazard == "drought":
        temps = daily.get("temperature_2m_mean", [])
        precips = daily.get("precipitation_sum", [])
        dates_out, values_out = compute_thornthwaite_deficit(times, temps, precips)
        monthly = list(zip(dates_out, values_out))

    if not monthly:
        return {
            "hazard": hazard,
            "lat": data.get("latitude", lat),
            "lon": data.get("longitude", lon),
            "error": "Could not compute monthly aggregation.",
            "source": cfg["source"],
        }

    latest_date, latest_value = monthly[-1]

    return {
        "hazard": hazard,
        "lat": data.get("latitude", lat),
        "lon": data.get("longitude", lon),
        "date": latest_date,
        "value": round(float(latest_value), 4),
        "unit": cfg["unit"],
        "variable": cfg["output_variable"],
        "aggregation": cfg["aggregation"],
        "source": cfg["source"],
        "raw_daily_count": len(times),
    }


# ── Batch fetch ──────────────────────────────────────────────────────

def fetch_all_hazards(lat: float, lon: float, lookback_months: int = 3) -> dict:
    """Fetch the latest observation for ALL hazards at a site."""
    results = {}
    for hazard in HAZARD_API_CONFIG:
        try:
            results[hazard] = fetch_latest_observation(lat, lon, hazard, lookback_months)
        except Exception as e:
            results[hazard] = {
                "hazard": hazard,
                "lat": lat,
                "lon": lon,
                "error": str(e),
            }
    return results


# ── Trigger evaluation ────────────────────────────────────────────────

def evaluate_trigger(
    observation: dict,
    threshold: float,
    hazard: str,
) -> dict:
    """
    Evaluate whether an oracle observation triggers a payout.

    Returns
    -------
    dict with keys:
        triggered (bool), value, threshold, direction, margin
    """
    if "error" in observation:
        return {"triggered": False, "error": observation["error"]}

    value = observation["value"]

    if hazard in ("flood", "heatwave"):
        triggered = value > threshold
        margin = value - threshold
    else:
        triggered = value < threshold
        margin = threshold - value

    return {
        "triggered": triggered,
        "value": round(value, 4),
        "threshold": threshold,
        "direction": "high_is_bad" if hazard in ("flood", "heatwave") else "low_is_bad",
        "margin": round(margin, 4),
        "date": observation.get("date"),
        "hazard": hazard,
    }
