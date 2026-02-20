import { useEffect, useRef, useCallback, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'
import type { Site, PolicyOnChain } from '../../types'
import { HAZARD_ID_TO_STRING } from '../../types'
import { findNearestSite } from '../../utils/mapbox'
import { int32ToCoord, rawToUsdc, formatUsdc, formatDate } from '../../utils/format'

interface MapViewProps {
  sites: Site[]
  selectedSite: Site | null
  policies: PolicyOnChain[]
  onLocationSelect: (lat: number, lon: number, site: Site, distanceKm: number, placeName: string | null) => void
}

function getPolicyStatus(policy: PolicyOnChain): 'active' | 'inactive' {
  const now = Math.floor(Date.now() / 1000)
  if (policy.paid) return 'inactive'
  if (policy.end < now) return 'inactive'
  return 'active'
}

function getPolicyStatusLabel(policy: PolicyOnChain): string {
  const now = Math.floor(Date.now() / 1000)
  if (policy.paid) return 'Paid Out'
  if (policy.end < now) return 'Expired'
  return 'Active'
}

export default function MapView({ sites, policies, onLocationSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const geocoderRef = useRef<MapboxGeocoder | null>(null)
  const clickMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const policyMarkersRef = useRef<mapboxgl.Marker[]>([])
  const siteMarkersRef = useRef<mapboxgl.Marker[]>([])
  const hasFittedRef = useRef(false)
  const [showSites, setShowSites] = useState(false)
  // Keep latest callbacks in refs so map/geocoder handlers always use current values
  const sitesRef = useRef(sites)
  const onLocationSelectRef = useRef(onLocationSelect)
  sitesRef.current = sites
  onLocationSelectRef.current = onLocationSelect

  const selectLocation = useCallback((map: mapboxgl.Map, lat: number, lon: number) => {
    const result = findNearestSite(lat, lon, sitesRef.current)
    if (!result) return

    // Place click marker
    if (clickMarkerRef.current) clickMarkerRef.current.remove()
    const el = document.createElement('div')
    el.className = 'click-marker'
    clickMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat([lon, lat])
      .addTo(map)

    // Zoom into the clicked location
    map.flyTo({
      center: [lon, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 1500,
    })

    // Reverse geocode to get place name
    const token = mapboxgl.accessToken
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place,country&limit=1&access_token=${token}`)
      .then((res) => res.json())
      .then((data) => {
        const features = data.features || []
        const placeName = features.length > 0 ? features[0].place_name : null
        onLocationSelectRef.current(lat, lon, result.site, result.distanceKm, placeName)
      })
      .catch(() => {
        onLocationSelectRef.current(lat, lon, result.site, result.distanceKm, null)
      })
  }, [])

  // Initialize map + geocoder (runs once)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [8.5417, 47.3769], // Zurich
      zoom: 15,
      pitch: 45,
      antialias: true,
      customAttribution: '© Wedefin Labs',
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Geocoder search bar
    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl: mapboxgl as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      marker: false,
      placeholder: 'Search location...',
      collapsed: false,
    })

    map.addControl(geocoder, 'top-left')

    // When user selects a geocoder result, snap to nearest data center
    geocoder.on('result', (e: { result: { center: [number, number] } }) => {
      const [lon, lat] = e.result.center
      selectLocation(map, lat, lon)
    })

    // Add 3D buildings once style loads
    map.on('load', () => {
      const layers = map.getStyle().layers
      // Find the first symbol layer to insert buildings beneath labels
      let labelLayerId: string | undefined
      for (const layer of layers || []) {
        if (layer.type === 'symbol' && (layer.layout as any)?.['text-field']) {
          labelLayerId = layer.id
          break
        }
      }

      map.addLayer(
        {
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.6,
          },
        },
        labelLayerId,
      )
    })

    // Handle map clicks
    map.on('click', (e: mapboxgl.MapMouseEvent) => {
      selectLocation(map, e.lngLat.lat, e.lngLat.lng)
    })

    mapRef.current = map
    geocoderRef.current = geocoder

    return () => {
      map.remove()
      mapRef.current = null
      geocoderRef.current = null
    }
  }, [selectLocation])

  // Render policy markers and fit bounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up previous policy markers
    policyMarkersRef.current.forEach((m) => m.remove())
    policyMarkersRef.current = []

    if (policies.length === 0) return

    const bounds = new mapboxgl.LngLatBounds()

    policies.forEach((policy) => {
      const lat = int32ToCoord(policy.lat)
      const lon = int32ToCoord(policy.lon)
      const status = getPolicyStatus(policy)
      const statusLabel = getPolicyStatusLabel(policy)
      const hazard = HAZARD_ID_TO_STRING[policy.hazard as 0 | 1 | 2] ?? `Hazard ${policy.hazard}`

      const el = document.createElement('div')
      el.className = `policy-marker ${status}`
      const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(
        `<div class="site-popup">
          <strong>Policy #${policy.id.toString()}</strong>
          <p>${hazard.charAt(0).toUpperCase() + hazard.slice(1)} — ${statusLabel}</p>
          <p>Coverage: $${formatUsdc(rawToUsdc(policy.maxCoverage))} USDC</p>
          <p class="hazards">${formatDate(policy.start)} — ${formatDate(policy.end)}</p>
        </div>`,
      )

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(map)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15), duration: 1500 })
        marker.togglePopup()
      })

      policyMarkersRef.current.push(marker)
      bounds.extend([lon, lat])
    })

    // Fit bounds only on first load
    if (!hasFittedRef.current) {
      hasFittedRef.current = true
      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 12,
        duration: 1500,
      })
    }
  }, [policies])

  // Fly to default view: policies bounds or Zurich
  const flyToDefault = useCallback((map: mapboxgl.Map) => {
    if (policies.length > 0) {
      const bounds = new mapboxgl.LngLatBounds()
      policies.forEach((p) => bounds.extend([int32ToCoord(p.lon), int32ToCoord(p.lat)]))
      map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1500 })
    } else {
      map.flyTo({ center: [8.5417, 47.3769], zoom: 15, pitch: 45, duration: 1500 })
    }
  }, [policies])

  // Toggle data center site markers + zoom
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up previous site markers
    siteMarkersRef.current.forEach((m) => m.remove())
    siteMarkersRef.current = []

    if (!showSites || sites.length === 0) {
      // When toggling off, fly back to default view
      if (!showSites && map) {
        flyToDefault(map)
      }
      return
    }

    // Fit to all site locations
    const bounds = new mapboxgl.LngLatBounds()

    sites.forEach((site) => {
      const el = document.createElement('div')
      el.className = 'site-marker'
      el.title = `${site.name} — ${site.city}`
      const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(
        `<div class="site-popup">
          <strong>${site.name}</strong>
          <p>${site.city}</p>
          <p class="hazards">${site.available_hazards.join(', ')}</p>
        </div>`,
      )

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([site.lon, site.lat])
        .setPopup(popup)
        .addTo(map)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        map.flyTo({ center: [site.lon, site.lat], zoom: Math.max(map.getZoom(), 15), duration: 1500 })
        marker.togglePopup()
      })

      siteMarkersRef.current.push(marker)
      bounds.extend([site.lon, site.lat])
    })

    map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 1500 })
  }, [showSites, sites, flyToDefault])

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map-container" />
      <label className="map-toggle-sites">
        <span>Precomputed Data Centers</span>
        <div className="toggle-switch">
          <input
            type="checkbox"
            checked={showSites}
            onChange={() => setShowSites((prev) => !prev)}
          />
          <span className="toggle-slider" />
        </div>
      </label>
    </div>
  )
}
