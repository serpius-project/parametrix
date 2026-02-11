# Event Data Sources and Assumptions

## Purpose
This document defines the **authoritative data sources** and **data assumptions** for event-driven parametric insurance pricing.

The pricing engine:
- DOES NOT fetch data
- DOES NOT validate real-world truth
- ONLY consumes structured event data passed as input

Data acquisition and verification are handled upstream (e.g. via oracles).

---

## 1) Canonical Event Data Sources

### Earthquakes (default use case)

Primary source:
- USGS Earthquake Catalog

Acceptable alternatives:
- EM-DAT (for disaster-level aggregation)
- National seismic agencies (region-specific)

All sources must provide, at minimum:
- Event timestamp (UTC)
- Epicenter latitude
- Epicenter longitude
- Event magnitude (Mw or comparable)

---

## 2) Required Event Data Schema

Each historical event must be normalized to the following structure:

    {
      "lat": float,
      "lon": float,
      "magnitude": float,
      "time": ISO-8601 string (UTC)
    }

Notes:
- Magnitude must be comparable across events (e.g. Mw).
- All distances are computed using geographic coordinates (WGS84).

---

## 3) Historical Window Definition

The historical observation window (`T_hist_years`) is:
- Provided explicitly as a parameter
- Chosen upstream by the system or governance
- NOT inferred automatically from event timestamps unless explicitly instructed

This ensures deterministic pricing.

---

## 4) Data Integrity Assumptions

The pricing engine assumes:
- Event data has already been validated
- No missing or corrupted fields
- No duplicate events
- No retroactive revisions

Handling of:
- Data corrections
- Reorgs
- Conflicting sources

is **out of scope** for the pricing model.

---

## 5) Extension to Other Event Types

For non-earthquake products (e.g. floods, outages, weather):
- Replace the event source
- Keep the same event schema concept
- Redefine the trigger rule

The pricing engine remains unchanged.
