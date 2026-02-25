# Parametrix Climate Risk Insurance API

FastAPI application for calculating premiums and evaluating payouts for parametric climate risk insurance.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the API Server

```bash
# Development mode with auto-reload
uvicorn api:app --reload --port 8000

# Production mode
uvicorn api:app --host 0.0.0.0 --port 8000
```

### 3. Access the API

- **Interactive Docs**: http://localhost:8000/docs
- **Alternative Docs**: http://localhost:8000/redoc
- **API Root**: http://localhost:8000

## 📚 API Endpoints

#### `POST /threshold`
Calculate the trigger threshold (in physical units) that corresponds to a desired monthly exceedance probability for the nearest site and hazard.

**Request Body:**
```json
{
  "lat": 39.7392,
  "lon": -104.9903,
  "hazard": "heatwave",
  "exceedance_prob": 0.10
}
```

**Response:**
```json
{
  "hazard": "heatwave",
  "threshold": 33.2,
  "unit": "C",
  "exceedance_prob": 0.10,
  "direction": "high_is_bad",
  "site_id": "nearest_site",
  "distribution": "genextreme"
}
```

#### `POST /premium`
Calculate insurance premium for a location and hazard.

**Request Body:**
```json
{
  "lat": 39.7392,
  "lon": -104.9903,
  "hazard": "heatwave",
  "threshold": 35.0,
  "n_months": 12,
  "payout": 10000.0,
  "loading_factor": 0.20
}
```

**Response:**
```json
{
  "hazard": "heatwave",
  "threshold": 35.0,
  "unit": "C",
  "exceedance_prob": 0.023456,
  "expected_severity": 2.5,
  "expected_loss_monthly": 0.058,
  "n_months": 12,
  "pure_premium": 0.70,
  "premium_usdc": 281.47,
  "payout": 10000.0,
  "loading_factor": 0.20,
  "distribution": "genextreme"
}
```

#### `POST /check-event`
Check real weather observation and evaluate payout trigger.

**Request Body:**
```json
{
  "lat": 39.7392,
  "lon": -104.9903,
  "hazard": "heatwave",
  "threshold": 35.0,
  "payout": 10000.0,
  "lookback_months": 3
}
```

**Response:**
```json
{
  "status": "ok",
  "hazard": "heatwave",
  "date": "2024-02-01",
  "triggered": false,
  "value": 32.5,
  "threshold": 35.0,
  "direction": "high_is_bad",
  "margin": -2.5,
  "payout": 10000.0,
  "payout_due": 0.0,
  "lat": 39.7392,
  "lon": -104.9903,
  "unit": "C",
  "source": "Open-Meteo"
}
```

#### `POST /simulate-event`
Simulate a fake observation for demos and testing.

**Request Body:**
```json
{
  "lat": 39.7392,
  "lon": -104.9903,
  "hazard": "heatwave",
  "threshold": 35.0,
  "payout": 10000.0,
  "force_trigger": true,
  "jitter_frac": 0.10
}
```

**Response:**
```json
{
  "status": "ok",
  "hazard": "heatwave",
  "date": "2024-02-01",
  "lat": 39.7392,
  "lon": -104.9903,
  "value": 38.5,
  "unit": "C",
  "threshold": 35.0,
  "triggered": true,
  "margin": 3.5,
  "payout": 10000.0,
  "payout_due": 10000.0,
  "source": "simulated"
}
```

### Utility Endpoints

#### `GET /sites`
Get available site locations and their hazard coverage.

**Response:**
```json
{
  "sites": [
    {
      "site_id": "test_site_1",
      "name": "Test Site 1",
      "city": "Test Location",
      "lat": 39.7392,
      "lon": -104.9903,
      "available_hazards": ["heatwave", "flood"]
    },
    {
      "site_id": "test_site_2",
      "name": "Test Site 2",
      "city": "Test Location",
      "lat": 30.2672,
      "lon": -97.7431,
      "available_hazards": ["heatwave", "drought"]
    }
  ],
  "total_count": 2
}
```

#### `GET /hazards`
Get available hazard types and their configurations.

**Response:**
```json
{
  "hazards": {
    "flood": {
      "family": "weibull_min",
      "direction": "high_is_bad",
      "unit": "m3/s",
      "description": "River discharge (monthly max)"
    },
    "heatwave": {
      "family": "genextreme",
      "direction": "high_is_bad",
      "unit": "C",
      "description": "Wet-bulb temperature (monthly max)"
    },
    ...
  },
  "available_types": ["flood", "heatwave", "waterstress", "drought"]
}
```

#### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "api": "operational"
}
```

## 🧪 Testing the API

### Using cURL

**Calculate Premium:**
```bash
curl -X POST "http://localhost:8000/premium" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 39.7392,
    "lon": -104.9903,
    "hazard": "heatwave",
    "threshold": 35.0,
    "n_months": 12,
    "payout": 10000.0,
    "loading_factor": 0.20
  }'
```

**Simulate Event:**
```bash
curl -X POST "http://localhost:8000/simulate-event" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 39.7392,
    "lon": -104.9903,
    "hazard": "heatwave",
    "threshold": 35.0,
    "payout": 10000.0,
    "force_trigger": true
  }'
```

### Using Python Requests

```python
import requests

# Calculate premium
response = requests.post(
    "http://localhost:8000/premium",
    json={
        "lat": 39.7392,
        "lon": -104.9903,
        "hazard": "heatwave",
        "threshold": 35.0,
        "n_months": 12,
        "payout": 10000.0,
        "loading_factor": 0.20
    }
)
print(response.json())

# Simulate event
response = requests.post(
    "http://localhost:8000/simulate-event",
    json={
        "lat": 39.7392,
        "lon": -104.9903,
        "hazard": "heatwave",
        "threshold": 35.0,
        "payout": 10000.0,
        "force_trigger": True
    }
)
print(response.json())
```

## ⚙️ Configuration

### Hazard Types

- **flood**: River discharge (m³/s)
- **heatwave**: Wet-bulb temperature (°C)
- **waterstress**: Soil moisture (m³/m³)
- **drought**: Water deficit (mm)

## 🔒 CORS Configuration

By default, the API allows all origins. For production, update the CORS settings in `api.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend-domain.com"],  # Restrict origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 📝 Notes

- Premium calculations use statistical distributions fitted to historical weather data from Open-Meteo
- The `/threshold` endpoint is used by the frontend to auto-suggest trigger thresholds based on a desired exceedance probability
- Real event checking (`/check-event`) uses the Open-Meteo API for weather observations
- On-chain payout triggering is handled by the **CRE workflow** (`cre_chainlink/parametrix/payout_trigger/`), not by this API. The CRE workflow fetches weather data directly from Open-Meteo and calls `triggerPayout()` on the PolicyManager contract
- Simulated events (`/simulate-event`) are useful for demos without making external API calls

## 🆘 Troubleshooting

**Port already in use:**
```bash
# Use a different port
uvicorn api:app --port 8001
```

**Module not found:**
```bash
# Make sure you're in the correct directory
cd backend-python
pip install -r requirements.txt
```

**CORS errors:**
- Check the `allow_origins` setting in `api.py`
- Ensure your frontend is making requests to the correct URL

---

**Ready to go! Visit http://localhost:8000/docs to explore the interactive API documentation.** 🚀
