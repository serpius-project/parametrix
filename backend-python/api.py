"""
FastAPI application for Parametrix Climate Risk Insurance.

Endpoints:
- POST /premium - Calculate insurance premium
- POST /check-event - Check real observation and evaluate payout
- POST /simulate-event - Simulate event and evaluate payout
"""

from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from main import (
    calculate_premium,
    check_event_and_payout,
    simulate_event_and_payout,
)
from lib.premium_math import HAZARD_CONFIG, load_site_parameters

# Initialize FastAPI app
app = FastAPI(
    title="Parametrix Climate Risk Insurance API",
    description="API for calculating premiums and evaluating payouts for parametric climate risk insurance",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class PremiumRequest(BaseModel):
    """Request model for premium calculation."""
    lat: float = Field(..., description="Latitude of the location", ge=-90, le=90)
    lon: float = Field(..., description="Longitude of the location", ge=-180, le=180)
    hazard: str = Field(..., description="Hazard type: flood, heatwave, waterstress, or drought")
    threshold: float = Field(..., description="Trigger threshold in physical units", gt=0)
    n_months: int = Field(12, description="Coverage period in months", ge=1, le=120)
    payout: float = Field(10000.0, description="Payout in USDC if triggered", gt=0)
    loading_factor: float = Field(0.20, description="Insurer markup (0.20 = 20%)", ge=0, le=1.0)

    class Config:
        json_schema_extra = {
            "example": {
                "lat": 39.7392,
                "lon": -104.9903,
                "hazard": "heatwave",
                "threshold": 35.0,
                "n_months": 12,
                "payout": 10000.0,
                "loading_factor": 0.20
            }
        }


class CheckEventRequest(BaseModel):
    """Request model for checking real event."""
    lat: float = Field(..., description="Latitude of the location", ge=-90, le=90)
    lon: float = Field(..., description="Longitude of the location", ge=-180, le=180)
    hazard: str = Field(..., description="Hazard type: flood, heatwave, waterstress, or drought")
    threshold: float = Field(..., description="Trigger threshold in physical units", gt=0)
    payout: float = Field(..., description="Payout in USDC if triggered", gt=0)
    lookback_months: int = Field(3, description="Months to look back for data", ge=1, le=12)

    class Config:
        json_schema_extra = {
            "example": {
                "lat": 39.7392,
                "lon": -104.9903,
                "hazard": "heatwave",
                "threshold": 35.0,
                "payout": 10000.0,
                "lookback_months": 3
            }
        }


class SimulateEventRequest(BaseModel):
    """Request model for simulating event."""
    lat: float = Field(..., description="Latitude of the location", ge=-90, le=90)
    lon: float = Field(..., description="Longitude of the location", ge=-180, le=180)
    hazard: str = Field(..., description="Hazard type: flood, heatwave, waterstress, or drought")
    threshold: float = Field(..., description="Trigger threshold in physical units", gt=0)
    payout: float = Field(..., description="Payout in USDC if triggered", gt=0)
    force_trigger: bool = Field(True, description="Force the simulated value to breach threshold")
    date_str: Optional[str] = Field(None, description="Override simulated date (YYYY-MM-DD format)")
    jitter_frac: float = Field(0.10, description="How far from threshold to place value", ge=0, le=1.0)

    class Config:
        json_schema_extra = {
            "example": {
                "lat": 39.7392,
                "lon": -104.9903,
                "hazard": "heatwave",
                "threshold": 35.0,
                "payout": 10000.0,
                "force_trigger": True,
                "jitter_frac": 0.10
            }
        }


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Root endpoint - API information."""
    return {
        "name": "Parametrix Climate Risk Insurance API",
        "version": "1.0.0",
        "endpoints": {
            "POST /premium": "Calculate insurance premium",
            "POST /check-event": "Check real observation and evaluate payout",
            "POST /simulate-event": "Simulate event and evaluate payout",
            "GET /hazards": "Get available hazard types and their configurations",
            "GET /sites": "Get available site locations",
            "GET /health": "Health check endpoint"
        },
        "docs": "/docs"
    }


@app.get("/hazards")
async def get_hazards():
    """Get available hazard types and their configurations."""
    return {
        "hazards": HAZARD_CONFIG,
        "available_types": list(HAZARD_CONFIG.keys())
    }


@app.get("/sites")
async def get_sites():
    """Get available site locations and their hazard coverage."""
    try:
        sites = load_site_parameters()

        # Filter out comment keys and format site data
        site_list = []
        for site_id, site_data in sites.items():
            if isinstance(site_data, dict) and "lat" in site_data and "lon" in site_data:
                site_info = {
                    "site_id": site_id,
                    "name": site_data.get("name", site_id),
                    "city": site_data.get("city", ""),
                    "lat": site_data["lat"],
                    "lon": site_data["lon"],
                    "available_hazards": list(site_data.get("hazards", {}).keys())
                }
                site_list.append(site_info)

        return {
            "sites": site_list,
            "total_count": len(site_list)
        }
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Site parameters file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading sites: {str(e)}")


@app.post("/premium")
async def calculate_premium_endpoint(request: PremiumRequest):
    """
    Calculate parametric insurance premium for a location and hazard.
    """
    try:
        result = calculate_premium(
            lat=request.lat,
            lon=request.lon,
            hazard=request.hazard,
            threshold=request.threshold,
            n_months=request.n_months,
            payout=request.payout,
            loading_factor=request.loading_factor,
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@app.post("/check-event")
async def check_event_endpoint(request: CheckEventRequest):
    """
    Fetch the latest real observation from Open-Meteo and evaluate trigger.

    This endpoint makes real API calls to weather data providers.
    """
    try:
        result = check_event_and_payout(
            lat=request.lat,
            lon=request.lon,
            hazard=request.hazard,
            threshold=request.threshold,
            payout=request.payout,
            lookback_months=request.lookback_months,
        )

        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("error"))

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@app.post("/simulate-event")
async def simulate_event_endpoint(request: SimulateEventRequest):
    """
    Simulate a fake observation and return payout decision.

    Useful for demos, videos, and testing without making real API calls.
    """
    try:
        result = simulate_event_and_payout(
            lat=request.lat,
            lon=request.lon,
            hazard=request.hazard,
            threshold=request.threshold,
            payout=request.payout,
            force_trigger=request.force_trigger,
            date_str=request.date_str,
            jitter_frac=request.jitter_frac,
        )

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "api": "operational"
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=2082)
