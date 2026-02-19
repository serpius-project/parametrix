import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'
import type { Site } from '../../types'
import { findNearestSite } from '../../utils/mapbox'

interface MapViewProps {
  sites: Site[]
  selectedSite: Site | null
  onLocationSelect: (lat: number, lon: number, site: Site, distanceKm: number) => void
}

export default function MapView({ sites, selectedSite, onLocationSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const geocoderRef = useRef<MapboxGeocoder | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const clickMarkerRef = useRef<mapboxgl.Marker | null>(null)
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

    // Fly to nearest site
    map.flyTo({
      center: [result.site.lon, result.site.lat],
      zoom: Math.max(map.getZoom(), 5),
      duration: 1500,
    })

    onLocationSelectRef.current(lat, lon, result.site, result.distanceKm)
  }, [])

  // Initialize map + geocoder (runs once)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [0, 20],
      zoom: 1.5,
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Geocoder search bar
    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl: mapboxgl as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      marker: false,
      placeholder: 'Search city or address...',
      collapsed: false,
    })

    map.addControl(geocoder, 'top-left')

    // When user selects a geocoder result, snap to nearest data center
    geocoder.on('result', (e: { result: { center: [number, number] } }) => {
      const [lon, lat] = e.result.center
      selectLocation(map, lat, lon)
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

  // Add site markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || sites.length === 0) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    sites.forEach((site) => {
      const el = document.createElement('div')
      el.className = 'site-marker'
      el.title = `${site.name} — ${site.city}`

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([site.lon, site.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(
            `<div class="site-popup">
              <strong>${site.name}</strong>
              <p>${site.city}</p>
              <p class="hazards">${site.available_hazards.join(', ')}</p>
            </div>`,
          ),
        )
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [sites])

  // Highlight selected site
  useEffect(() => {
    markersRef.current.forEach((marker) => {
      const el = marker.getElement()
      const lngLat = marker.getLngLat()
      const isSelected =
        selectedSite &&
        Math.abs(lngLat.lat - selectedSite.lat) < 0.001 &&
        Math.abs(lngLat.lng - selectedSite.lon) < 0.001
      el.classList.toggle('selected', !!isSelected)
    })
  }, [selectedSite])

  return <div ref={containerRef} className="map-container" />
}
