import type { Site } from '../types'

const R = 6371 // Earth radius in km

/** Haversine distance between two points in km */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Find the nearest site to a given lat/lon */
export function findNearestSite(
  lat: number,
  lon: number,
  sites: Site[],
): { site: Site; distanceKm: number } | null {
  if (sites.length === 0) return null

  let nearest = sites[0]!
  let minDist = haversineKm(lat, lon, nearest.lat, nearest.lon)

  for (let i = 1; i < sites.length; i++) {
    const s = sites[i]!
    const d = haversineKm(lat, lon, s.lat, s.lon)
    if (d < minDist) {
      minDist = d
      nearest = s
    }
  }

  return { site: nearest, distanceKm: minDist }
}
