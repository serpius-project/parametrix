import { USDC_DECIMALS } from '../config/contracts'

/** Convert human-readable USDC (e.g. 50) to raw 6-decimal bigint */
export const usdcToRaw = (usdc: number): bigint =>
  BigInt(Math.round(usdc * 10 ** USDC_DECIMALS))

/** Convert raw 6-decimal bigint to human-readable USDC */
export const rawToUsdc = (raw: bigint): number =>
  Number(raw) / 10 ** USDC_DECIMALS

/** Format USDC for display */
export const formatUsdc = (usdc: number): string =>
  usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Convert decimal degrees to int32 × 10000 for the contract */
export const coordToInt32 = (coord: number): number =>
  Math.round(coord * 10000)

/** Convert int32 × 10000 from the contract to decimal degrees */
export const int32ToCoord = (val: number): number =>
  val / 10000

/** Convert months to days for the contract (30 days per month) */
export const monthsToDays = (months: number): bigint =>
  BigInt(months * 30)

/** Format a unit string for display (e.g. "m3/s" → "m³/s", "C" → "°C") */
export const formatUnit = (unit: string): string =>
  unit
    .replace(/(\w)3/g, '$1³')
    .replace(/^C$/, '°C')

/** Clean up a hazard description for display (e.g. remove "D_mm") */
export const formatDescription = (desc: string): string =>
  desc
    .replace(/\s*D_mm\s*/g, ' ')
    .replace(/Wet-bulb temperature/gi, 'Wet-bulb Temp.')
    .replace(/\s*\(precip\s*-\s*PET,\s*/gi, '(')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** Format a Unix timestamp to a readable date */
export const formatDate = (timestamp: number): string =>
  new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
