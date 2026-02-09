# File: pricing_model_instructions.md

# Generic Parametric Pricing Model — Event-Driven Time Series (with Earthquake Example)

## Purpose
This document defines a **generic pricing model** for parametric insurance products where payouts are triggered by an **event condition** derived from an event-driven time series.

The same structure supports:
- Earthquakes (event = magnitude threshold within radius)
- Floods (event = satellite index over threshold)
- Power outages (event = downtime > threshold)
- Any offchain metric (event = metric crosses threshold)

The final goal is to generate a **pixelated premium map**: a grid where each cell has a premium based on historical event risk.

---

## 1) Core Contract Abstraction

### 1.1 Inputs
- **Unit**: a “policy unit” can be a pixel on a map (geo cell), a region id, or any index key.
- **Sum insured**: `L` (USD), i.e. the payout amount if the trigger occurs.
- **Policy duration**: `T_years` (years).
- **Loading factor**: `alpha >= 0` (expenses / margin / risk buffer).

### 1.2 Trigger (generic)
We define a deterministic trigger function:

- Let `Y_t(u)` be an observed time series for unit `u` (e.g., earthquakes near pixel u, a flood index, etc.).
- Define the trigger indicator for a policy period of length `T_years`:

  I_trigger(u; T) = 1 if trigger condition is met at least once during the period, else 0.

This is intentionally generic: the only requirement is that the trigger can be evaluated deterministically from data.

---

## 2) Premium Model (Baseline, Recommended for MVP)

We model the occurrence of trigger events as a **Poisson process**.

### 2.1 Historical observation window
Let:
- `T_hist_years` = length of the historical dataset in years.

### 2.2 Counting trigger-eligible events
For each unit `u`, count how many historical events would have triggered the policy:

- `N_trigger(u)` = number of historical events satisfying the trigger rule for unit `u`.

### 2.3 Poisson intensity
Annual intensity for unit `u`:

  lambda(u) = N_trigger(u) / T_hist_years

### 2.4 Trigger probability over policy horizon
Probability of at least one trigger in `T_years`:

  P_trigger(u) = 1 - exp( -lambda(u) * T_years )

### 2.5 Expected loss and premium
Fixed payout `L`:

  E_loss(u) = L * P_trigger(u)

Premium:

  Premium(u) = L * (1 - exp(-lambda(u) * T_years)) * (1 + alpha)

This is the **final pricing formula** for the MVP.

---

## 3) Optional Extensions (Only if Needed)

### 3.1 Multi-event payouts (cap)
If the contract pays per event up to a cap `K` events:

Let N ~ Poisson(lambda(u) * T_years)

Expected payout:

  E[payout] = L * E[min(N, K)]

(For MVP, prefer K=1 to keep things simple and explainable.)

### 3.2 Empirical (Binomial) alternative
If you prefer not to assume Poisson, you can estimate P_trigger directly:

- Split history into `m` equal windows of length `T_years`.
- Let `S(u)` = number of windows where at least one trigger occurred.

Then:

  P_trigger(u) = S(u) / m

Premium = L * P_trigger(u) * (1 + alpha)

(Still deterministic; often very explainable.)

### 3.3 Non-stationary intensity (rolling lambda)
If risk changes over time, define lambda using only recent history, e.g. last `W` years:

  lambda_W(u) = N_trigger_last_W(u) / W

---

## 4) Pixelated Premium Map Construction

### 4.1 Grid
Discretize the region into pixels:

- Grid = {u_1, u_2, ..., u_N}
- Each pixel u_j corresponds to a cell center (lat/lon) or an id.

### 4.2 Pipeline
For each pixel `u`:
1) Compute `N_trigger(u)` from historical data and the trigger rule
2) Compute `lambda(u)`
3) Compute `Premium(u)`
4) Store as (pixel_id, premium)

Optional:
- Convert premiums into tiers using quantiles for color mapping.

---

## 5) Earthquake Specialization (Example Trigger Rule)

For a pixel center x and an earthquake event i with epicenter x_i and magnitude M_i:

Trigger-eligible if:

- M_i >= M0
- d_km(x, x_i) <= R_km

Then:
- N_trigger(x) is the count of such events over history
- plug into the generic Poisson premium model above

---

## 6) Determinism and Oracle-Friendliness

Hard rules:
- No randomness or simulation
- Same inputs => same premiums
- All parameters explicit (M0, R_km, T_years, L, alpha, T_hist_years)
- Output is audit-friendly (include N_trigger and lambda)

---

## 7) Recommended Output Schema

Input JSON (example structure; no network calls implied):

    {
      "units": [{"id": "px_0001", "lat": 46.0, "lon": 8.9}],
      "events": [{"lat": 45.9, "lon": 8.95, "magnitude": 5.7, "time": "2012-05-20T02:03:00Z"}],
      "params": {"M0": 5.5, "R_km": 100, "T_years": 1.0, "L": 1000, "alpha": 0.2, "T_hist_years": 30}
    }

Output JSON:

    {
      "results": [
        {
          "id": "px_0001",
          "n_trigger_events": 1,
          "lambda": 0.0333333333,
          "trigger_probability": 0.0327868852,
          "expected_loss": 32.7868852,
          "premium": 39.3442623
        }
      ]
    }
