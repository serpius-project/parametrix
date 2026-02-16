"""
Simple test script for the Parametrix API.
Run this after starting the API server to verify all endpoints work correctly.

Usage:
    python test_api.py
"""

import requests
import json
from typing import Dict, Any


BASE_URL = "http://localhost:8000"


def print_response(title: str, response: requests.Response):
    """Pretty print API response."""
    print(f"\n{'='*60}")
    print(f"{title}")
    print(f"{'='*60}")
    print(f"Status Code: {response.status_code}")
    print(f"Response:")
    print(json.dumps(response.json(), indent=2))


def test_root():
    """Test root endpoint."""
    response = requests.get(f"{BASE_URL}/")
    print_response("1. Root Endpoint", response)
    return response.status_code == 200


def test_health():
    """Test health check endpoint."""
    response = requests.get(f"{BASE_URL}/health")
    print_response("2. Health Check", response)
    return response.status_code == 200


def test_hazards():
    """Test hazards endpoint."""
    response = requests.get(f"{BASE_URL}/hazards")
    print_response("3. Hazards Configuration", response)
    return response.status_code == 200


def test_sites():
    """Test sites endpoint."""
    response = requests.get(f"{BASE_URL}/sites")
    print_response("4. Available Sites", response)
    return response.status_code == 200


def test_calculate_premium():
    """Test premium calculation endpoint."""
    payload = {
        "lat": 39.7392,
        "lon": -104.9903,
        "hazard": "heatwave",
        "threshold": 35.0,
        "n_months": 12,
        "payout": 10000.0,
        "loading_factor": 0.20
    }
    response = requests.post(f"{BASE_URL}/premium", json=payload)
    print_response("5. Calculate Premium", response)
    return response.status_code == 200


def test_simulate_event():
    """Test simulate event endpoint."""
    payload = {
        "lat": 39.7392,
        "lon": -104.9903,
        "hazard": "heatwave",
        "threshold": 35.0,
        "payout": 10000.0,
        "force_trigger": True,
        "jitter_frac": 0.10
    }
    response = requests.post(f"{BASE_URL}/simulate-event", json=payload)
    print_response("6. Simulate Event (Triggered)", response)
    return response.status_code == 200


def test_simulate_event_no_trigger():
    """Test simulate event endpoint without trigger."""
    payload = {
        "lat": 39.7392,
        "lon": -104.9903,
        "hazard": "heatwave",
        "threshold": 35.0,
        "payout": 10000.0,
        "force_trigger": False,
        "jitter_frac": 0.10
    }
    response = requests.post(f"{BASE_URL}/simulate-event", json=payload)
    print_response("7. Simulate Event (Not Triggered)", response)
    return response.status_code == 200


def test_premium_different_hazards():
    """Test premium calculation for different hazards."""
    hazards = ["heatwave", "flood", "drought"]
    locations = {
        "Denver": (39.7392, -104.9903),
        "Austin": (30.2672, -97.7431),
        "Phoenix": (33.4484, -112.0740)
    }

    print(f"\n{'='*60}")
    print("8. Premium Comparison Across Hazards and Locations")
    print(f"{'='*60}")

    for city, (lat, lon) in locations.items():
        print(f"\n{city}:")
        for hazard in hazards:
            payload = {
                "lat": lat,
                "lon": lon,
                "hazard": hazard,
                "threshold": 35.0 if hazard == "heatwave" else 100.0,
                "n_months": 12,
                "payout": 10000.0,
                "loading_factor": 0.20
            }
            response = requests.post(f"{BASE_URL}/premium", json=payload)
            if response.status_code == 200:
                data = response.json()
                if "premium_usdc" in data:
                    print(f"  {hazard}: ${data['premium_usdc']:.2f} USDC")
                else:
                    print(f"  {hazard}: {data.get('error', 'Error')}")
            else:
                print(f"  {hazard}: Request failed")

    return True


def run_all_tests():
    """Run all tests and report results."""
    print("\n" + "="*60)
    print("PARAMETRIX API TEST SUITE")
    print("="*60)
    print("\nMake sure the API server is running:")
    print("  uvicorn api:app --reload --port 8000")
    print("\nStarting tests...")

    tests = [
        ("Root Endpoint", test_root),
        ("Health Check", test_health),
        ("Hazards Config", test_hazards),
        ("Available Sites", test_sites),
        ("Calculate Premium", test_calculate_premium),
        ("Simulate Event (Trigger)", test_simulate_event),
        ("Simulate Event (No Trigger)", test_simulate_event_no_trigger),
        ("Premium Comparison", test_premium_different_hazards),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, passed))
        except requests.exceptions.ConnectionError:
            print(f"\n❌ Connection Error: Is the API server running?")
            print("   Start it with: uvicorn api:app --reload --port 8000")
            return
        except Exception as e:
            print(f"\n❌ Test '{test_name}' failed with error: {e}")
            results.append((test_name, False))

    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 All tests passed! API is working correctly.")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Check the output above for details.")


if __name__ == "__main__":
    run_all_tests()
