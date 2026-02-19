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

export default function MapView({ sites, onLocationSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const geocoderRef = useRef<MapboxGeocoder | null>(null)
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

    // Zoom into the clicked location
    map.flyTo({
      center: [lon, lat],
      zoom: Math.max(map.getZoom(), 15),
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
      center: [8.5417, 47.3769], // Zurich
      zoom: 12,
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
      placeholder: 'Search city or address...',
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


  return <div ref={containerRef} className="map-container" />
}
