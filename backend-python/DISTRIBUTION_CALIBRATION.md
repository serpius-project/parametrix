# Distribution Calibration for Climate Risk Premiums

## Overview

Calibration is the process of fitting statistical distributions to historical climate observations for each risk type. These fitted distributions serve as the probabilistic models used to compute risk premiums.

## General Approach

1. **Data Acquisition**: Fetch historical climate data (temperature, precipitation, soil moisture, SPEI) from Open-Meteo API for the target region and time period.

2. **Preprocessing**: Aggregate or transform raw observations into risk-relevant metrics:
   - Extract block maxima (e.g., annual maximum temperature for heatwaves)
   - Compute derived indices (e.g., standardized indices for drought)
   - Normalize continuous variables to [0, 1] bounds where applicable

3. **Distribution Selection**: Choose a distribution family appropriate for each risk:
   - **Block maxima risks** (heatwave, flood): GEV distribution captures extreme value statistics
   - **Bounded continuous variables** (water stress): Beta distribution respects [0, 1] bounds
   - **Standardized indices** (drought): Normal distribution fits z-score data

4. **Parameter Estimation**: Fit the chosen distribution to the historical data using maximum likelihood estimation (MLE) or method-of-moments, yielding shape, location, and scale parameters.

5. **Validation**: Assess goodness-of-fit to ensure the distribution reasonably represents the data.

## Usage in Premium Computation

Once calibrated, each distribution is characterized by its fitted parameters. These are then used in closed-form mathematical expressions to compute the risk premium—typically as a function of tail statistics (e.g., probability of extreme outcomes, expected shortfall).

## Key Considerations

- **Data Quality & Duration**: Longer historical windows (ideally 30+ years) improve parameter stability.
- **Regional Variation**: Distributions are fitted independently for each geographic location, capturing local climate patterns.
- **Non-Stationarity**: Current calibration assumes stationary distributions; longer-term climate trends may require time-windowing approaches.
