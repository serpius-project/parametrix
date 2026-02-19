import { useState, useCallback } from 'react'
import MapView from '../components/Map/MapView'
import PolicyWizard from '../components/PolicyWizard/PolicyWizard'
import { useSites } from '../hooks/useSites'
import type { Site } from '../types'
import { useNavigate } from 'react-router-dom'

export default function BuyPage() {
  const { sites, loading, error } = useSites()
  const navigate = useNavigate()
  const [selectedSite, setSelectedSite] = useState<Site | null>(null)
  const [clickLat, setClickLat] = useState<number | null>(null)
  const [clickLon, setClickLon] = useState<number | null>(null)
  const [distanceKm, setDistanceKm] = useState<number | null>(null)

  const handleLocationSelect = useCallback(
    (lat: number, lon: number, site: Site, distance: number) => {
      setClickLat(lat)
      setClickLon(lon)
      setSelectedSite(site)
      setDistanceKm(distance)
    },
    [],
  )

  return (
    <div className="buy-page">
      <div className="buy-map">
        {error && <div className="map-error">Failed to load sites: {error}</div>}
        {loading && <div className="map-loading">Loading sites...</div>}
        <MapView
          sites={sites}
          selectedSite={selectedSite}
          onLocationSelect={handleLocationSelect}
        />
      </div>
      <div className="buy-wizard">
        <PolicyWizard
          selectedSite={selectedSite}
          clickLat={clickLat}
          clickLon={clickLon}
          distanceKm={distanceKm}
          onComplete={() => navigate('/dashboard')}
        />
      </div>
    </div>
  )
}
