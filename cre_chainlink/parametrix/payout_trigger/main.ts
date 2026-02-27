import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	handler,
	CronCapability,
	EVMClient,
	HTTPClient,
	type EVMLog,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	hexToBase64,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	Runner,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { PolicyManager } from '../contracts/abi'

// ==============================================================================
// CONFIGURATION SCHEMA
// ==============================================================================

const configSchema = z.object({
	schedule: z.string(), // Cron schedule for checking policies (e.g., "*/5 * * * *")
	lookbackMonths: z.number().int().min(1).max(24), // Months to look back for weather data (min 14 for drought)
	evms: z.array(
		z.object({
			policyManagerAddress: z.string(),
			chainSelectorName: z.string(),
			gasLimit: z.string(),
		}),
	),
})

type Config = z.infer<typeof configSchema>

// ==============================================================================
// CRE SERVICE QUOTAS — https://docs.chain.link/cre/service-quotas
// ==============================================================================

const MAX_HTTP_CALLS = 5   // PerWorkflow.HTTPAction.CallLimit
const MAX_EVM_READS = 10   // PerWorkflow.ChainRead.CallLimit

// Parse the cron interval (in minutes) from a schedule string.
// E.g. "*/2 * * * *" returns 2, "* * * * *" returns 1.
const parseCronInterval = (schedule: string): number => {
	const parts = schedule.trim().split(/\s+/)
	if (parts.length < 5) return 1
	const minuteField = parts[0]
	if (minuteField === '*') return 1
	const stepMatch = minuteField.match(/^\*\/(\d+)$/)
	if (stepMatch) return Math.max(1, parseInt(stepMatch[1], 10))
	return 1 // conservative fallback
}

// ==============================================================================
// TYPES
// ==============================================================================

// Hazard types (matches smart contract uint8 values)
type HazardType = number

// Mapping from on-chain hazard IDs to hazard names
const HAZARD_ID_TO_NAME: Record<number, string> = {
	0: 'heatwave',
	1: 'flood',
	2: 'drought',
}

// Open-Meteo API configuration per hazard type
// Source: backend-python/lib/fetcher.py HAZARD_API_CONFIG
interface HazardApiConfig {
	url: string
	dailyVars: string
	aggregation: 'max' | 'mean' | 'thornthwaite'
	extraParams?: Record<string, string>
}

const HAZARD_API_CONFIG: Record<string, HazardApiConfig> = {
	heatwave: {
		url: 'https://archive-api.open-meteo.com/v1/archive',
		dailyVars: 'wet_bulb_temperature_2m_max',
		aggregation: 'max',
	},
	flood: {
		url: 'https://flood-api.open-meteo.com/v1/flood',
		dailyVars: 'river_discharge',
		aggregation: 'max',
	},
	drought: {
		url: 'https://archive-api.open-meteo.com/v1/archive',
		dailyVars: 'temperature_2m_mean,precipitation_sum',
		aggregation: 'thornthwaite',
	},
}

interface Policy {
	id: number
	hazard: HazardType
	hazardName: string
	start: number
	end: number
	lat: number // decimal degrees (decoded from int32 / 10000)
	lon: number // decimal degrees (decoded from int32 / 10000)
	maxCoverage: bigint
	premium: bigint
	triggerThreshold: number
	paid: boolean
}

// Consensus-compatible result from Open-Meteo weather data.
// All fields are numeric so the DON nodes can aggregate via median.
interface TriggerCheckResult {
	triggered: number // 1 = triggered, 0 = not triggered
	value: number // observed weather value
	threshold: number // trigger threshold echoed back
}

// ==============================================================================
// WEATHER DATA FUNCTIONS (replaces Python API dependency)
// ==============================================================================

/**
 * Aggregate daily values to monthly using the specified method.
 * Groups by YYYY-MM key and applies max or mean aggregation.
 * Source: backend-python/lib/fetcher.py aggregate_monthly()
 */
const aggregateMonthly = (
	dates: string[],
	values: (number | null)[],
	method: 'max' | 'mean',
): { date: string; value: number }[] => {
	const monthly: Record<string, number[]> = {}

	for (let i = 0; i < dates.length; i++) {
		const v = values[i]
		if (v === null || v === undefined) continue
		const monthKey = dates[i].slice(0, 7) + '-01' // YYYY-MM-01
		if (!monthly[monthKey]) monthly[monthKey] = []
		monthly[monthKey].push(v)
	}

	const result: { date: string; value: number }[] = []
	for (const monthKey of Object.keys(monthly).sort()) {
		const vals = monthly[monthKey]
		if (!vals.length) continue

		let agg: number
		if (method === 'max') {
			agg = Math.max(...vals)
		} else {
			agg = vals.reduce((a, b) => a + b, 0) / vals.length
		}
		result.push({ date: monthKey, value: agg })
	}

	return result
}

/**
 * Compute monthly water deficit D_mm = precip - PET using Thornthwaite method.
 * Used exclusively for drought hazard evaluation.
 * Source: backend-python/lib/fetcher.py compute_thornthwaite_deficit()
 *
 * Steps:
 *   1. Aggregate daily data to monthly (mean temp, sum precip)
 *   2. Heat index per month: I_i = (max(T, 0) / 5)^1.514
 *   3. Annual heat index: 12-month rolling sum
 *   4. Exponent: a = 6.75e-7 * I_a³ - 7.71e-5 * I_a² + 1.79e-2 * I_a + 0.492
 *   5. PET (mm/month): 16.0 * (10 * T / I_a)^a
 *   6. Deficit: D = precip - PET (negative = drought)
 */
const computeThornthwaiteDeficit = (
	dates: string[],
	temps: (number | null)[],
	precips: (number | null)[],
): { date: string; value: number }[] => {
	// Group daily data by month: mean temp, sum precip
	const monthlyData: Record<string, { temps: number[]; precips: number[] }> = {}

	for (let i = 0; i < dates.length; i++) {
		const t = temps[i]
		const p = precips[i]
		if (t === null || t === undefined || p === null || p === undefined) continue
		const monthKey = dates[i].slice(0, 7) + '-01'
		if (!monthlyData[monthKey]) monthlyData[monthKey] = { temps: [], precips: [] }
		monthlyData[monthKey].temps.push(t)
		monthlyData[monthKey].precips.push(p)
	}

	const sortedMonths = Object.keys(monthlyData).sort()
	if (sortedMonths.length < 2) return []

	// Monthly aggregates
	const monthlyTemps: number[] = []
	const monthlyPrecips: number[] = []
	for (const m of sortedMonths) {
		const d = monthlyData[m]
		monthlyTemps.push(d.temps.reduce((a, b) => a + b, 0) / d.temps.length) // mean
		monthlyPrecips.push(d.precips.reduce((a, b) => a + b, 0)) // sum
	}

	// Step 1: Monthly heat index I_i = (max(T, 0) / 5)^1.514
	const heatIndices = monthlyTemps.map((t) => Math.pow(Math.max(t, 0) / 5.0, 1.514))

	// Step 2: Annual heat index — 12-month rolling sum (or sum of all available if < 12)
	const annualI: number[] = []
	for (let i = 0; i < heatIndices.length; i++) {
		const windowStart = Math.max(0, i - 5) // center ≈ 6 before, 5 after
		const windowEnd = Math.min(heatIndices.length, i + 7)
		let sum = 0
		let count = 0
		for (let j = windowStart; j < windowEnd; j++) {
			sum += heatIndices[j]
			count++
		}
		// Scale to 12 months if window is smaller
		annualI.push(count > 0 ? (sum / count) * 12 : 0)
	}

	// Step 3: Compute PET and deficit for each month
	const result: { date: string; value: number }[] = []
	for (let i = 0; i < sortedMonths.length; i++) {
		const Ia = annualI[i] || 1 // avoid division by zero
		const T = Math.max(monthlyTemps[i], 0)

		// Exponent a
		const a = 6.75e-7 * Math.pow(Ia, 3) - 7.71e-5 * Math.pow(Ia, 2) + 1.79e-2 * Ia + 0.492

		// PET in mm/month
		const pet = Ia > 0 ? 16.0 * Math.pow((10.0 * T) / Ia, a) : 0

		// Water deficit: precip - PET (negative = drought condition)
		const deficit = monthlyPrecips[i] - pet

		result.push({ date: sortedMonths[i], value: deficit })
	}

	return result
}

/**
 * Evaluate whether an observed value triggers a payout.
 * Source: backend-python/lib/fetcher.py evaluate_trigger()
 *
 * - heatwave, flood: HIGH_IS_BAD → triggered if value > threshold
 * - drought: LOW_IS_BAD → triggered if value < threshold
 */
const evaluateTrigger = (value: number, threshold: number, hazard: string): boolean => {
	if (hazard === 'flood' || hazard === 'heatwave') {
		return value > threshold
	}
	// drought: low deficit (more negative) means worse drought
	return value < threshold
}

/**
 * Build the Open-Meteo query URL for a policy's hazard and location.
 */
const buildOpenMeteoUrl = (policy: Policy, lookbackMonths: number): string => {
	const cfg = HAZARD_API_CONFIG[policy.hazardName]
	if (!cfg) throw new Error(`No API config for hazard: ${policy.hazardName}`)

	// For drought: force minimum 14 months lookback (needed for Thornthwaite)
	const effectiveLookback = policy.hazardName === 'drought'
		? Math.max(lookbackMonths, 14)
		: lookbackMonths

	const now = new Date()
	const startDate = new Date(now.getTime() - effectiveLookback * 31 * 24 * 60 * 60 * 1000)
	startDate.setDate(1) // first of month

	const formatDate = (d: Date) => d.toISOString().slice(0, 10) // YYYY-MM-DD

	const parts = [
		`latitude=${policy.lat}`,
		`longitude=${policy.lon}`,
		`daily=${cfg.dailyVars}`,
		`start_date=${formatDate(startDate)}`,
		`end_date=${formatDate(now)}`,
		`timezone=UTC`,
	]

	// Add extra params (e.g., models=era5_land for waterstress)
	if (cfg.extraParams) {
		for (const k of Object.keys(cfg.extraParams)) {
			parts.push(`${k}=${cfg.extraParams[k]}`)
		}
	}

	return `${cfg.url}?${parts.join('&')}`
}

/**
 * Creates a weather fetcher for a specific policy.
 * Each DON node calls Open-Meteo directly (GET request, no auth needed),
 * aggregates daily data to monthly, evaluates the trigger, and returns
 * a numeric result for DON consensus via median.
 */
const createWeatherFetcher = (policy: Policy) =>
	(sendRequester: HTTPSendRequester, config: Config): TriggerCheckResult => {
		const cfg = HAZARD_API_CONFIG[policy.hazardName]
		if (!cfg) throw new Error(`No API config for hazard: ${policy.hazardName}`)

		const url = buildOpenMeteoUrl(policy, config.lookbackMonths)

		const response = sendRequester.sendRequest({
			method: 'GET',
			url,
		}).result()

		if (response.statusCode !== 200) {
			throw new Error(`Open-Meteo API returned status ${response.statusCode}`)
		}

		const responseText = Buffer.from(response.body).toString('utf-8')
		const data = JSON.parse(responseText)

		if (!data.daily || !data.daily.time) {
			throw new Error('Open-Meteo response missing daily data')
		}

		const dates: string[] = data.daily.time
		let observedValue: number

		if (cfg.aggregation === 'thornthwaite') {
			// Drought: Thornthwaite PET deficit
			const temps = data.daily.temperature_2m_mean as (number | null)[]
			const precips = data.daily.precipitation_sum as (number | null)[]
			const monthly = computeThornthwaiteDeficit(dates, temps, precips)

			if (monthly.length === 0) {
				throw new Error('Insufficient data for Thornthwaite calculation')
			}
			observedValue = monthly[monthly.length - 1].value
		} else {
			// Heatwave / Flood: simple monthly aggregation
			const varName = cfg.dailyVars.split(',')[0]
			const values = data.daily[varName] as (number | null)[]

			if (!values) {
				throw new Error(`Open-Meteo response missing variable: ${varName}`)
			}

			const monthly = aggregateMonthly(dates, values, cfg.aggregation)

			if (monthly.length === 0) {
				throw new Error('No monthly data after aggregation')
			}
			observedValue = monthly[monthly.length - 1].value
		}

		const triggered = evaluateTrigger(observedValue, policy.triggerThreshold, policy.hazardName)

		return {
			triggered: triggered ? 1 : 0,
			value: Math.round(observedValue * 10000) / 10000, // 4 decimal places
			threshold: policy.triggerThreshold,
		}
	}

/**
 * Get active policies from the contract
 */
const getActivePolicies = (runtime: Runtime<Config>): Policy[] => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	// Get the next policy ID to know how many policies exist
	const nextIdCallData = encodeFunctionData({
		abi: PolicyManager,
		functionName: 'nextId',
	})

	const nextIdResponse = evmClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: evmConfig.policyManagerAddress as Address,
				data: nextIdCallData,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const nextId = decodeFunctionResult({
		abi: PolicyManager,
		functionName: 'nextId',
		data: bytesToHex(nextIdResponse.data),
	})

	runtime.log(`Next policy ID: ${nextId.toString()}`)

	const totalPolicies = Number(nextId) - 1 // policy IDs are 1-based
	const maxPolicyScan = Math.floor((MAX_EVM_READS - 1) / 2) // 2 reads per policy: policyStatus + policies

	// Rotating scan window: when there are more policies than we can read
	// in one execution, scan a different window each cron cycle.
	let scanStart = 1
	let scanEnd = Number(nextId)

	if (totalPolicies > maxPolicyScan) {
		const cronInterval = parseCronInterval(runtime.config.schedule)
		const cycleIndex = Math.floor(Date.now() / (cronInterval * 60000))
		const numWindows = Math.ceil(totalPolicies / maxPolicyScan)
		const windowIndex = cycleIndex % numWindows

		scanStart = windowIndex * maxPolicyScan + 1
		scanEnd = Math.min(scanStart + maxPolicyScan, Number(nextId))

		runtime.log(
			`Scanning policy IDs ${scanStart}..${scanEnd - 1} ` +
			`(window ${windowIndex + 1}/${numWindows}, ${maxPolicyScan} max per cycle)`,
		)
	}

	const policies: Policy[] = []
	const currentTime = Math.floor(Date.now() / 1000)

	for (let id = scanStart; id < scanEnd; id++) {
		try {
			// EVM read 1: Check policy verification status first (cheaper to skip early)
			const statusCallData = encodeFunctionData({
				abi: PolicyManager,
				functionName: 'policyStatus',
				args: [BigInt(id)],
			})

			const statusResponse = evmClient
				.callContract(runtime, {
					call: encodeCallMsg({
						from: zeroAddress,
						to: evmConfig.policyManagerAddress as Address,
						data: statusCallData,
					}),
					blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
				})
				.result()

			const status = decodeFunctionResult({
				abi: PolicyManager,
				functionName: 'policyStatus',
				data: bytesToHex(statusResponse.data),
			})

			if (Number(status) !== 1) { // 1 = Verified
				runtime.log(`Policy ${id}: status=${status}, skipping (not verified)`)
				continue
			}

			// EVM read 2: Fetch policy data
			const policyCallData = encodeFunctionData({
				abi: PolicyManager,
				functionName: 'policies',
				args: [BigInt(id)],
			})

			const policyResponse = evmClient
				.callContract(runtime, {
					call: encodeCallMsg({
						from: zeroAddress,
						to: evmConfig.policyManagerAddress as Address,
						data: policyCallData,
					}),
					blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
				})
				.result()

			const policyData = decodeFunctionResult({
				abi: PolicyManager,
				functionName: 'policies',
				data: bytesToHex(policyResponse.data),
			})

			// Destructure policy data: hazard, start, end, lat, lon, maxCoverage, premium, triggerThreshold, paid
			const [hazard, start, end, lat, lon, maxCoverage, premium, triggerThreshold, paid] = policyData

			// Check if policy is active (not paid, not expired)
			if (!paid && Number(end) > currentTime) {
				const hazardNum = Number(hazard)
				const hazardName = HAZARD_ID_TO_NAME[hazardNum]

				if (!hazardName) {
					runtime.log(`Policy ${id}: Unknown hazard type ${hazardNum} - skipping`)
					continue
				}

				policies.push({
					id,
					hazard: hazardNum,
					hazardName,
					start: Number(start),
					end: Number(end),
					lat: Number(lat) / 10000, // Convert from int32 x 10000 to decimal degrees
					lon: Number(lon) / 10000,
					maxCoverage,
					premium,
					triggerThreshold: Number(triggerThreshold),
					paid,
				})
			}
		} catch (error) {
			runtime.log(`Error fetching policy ${id}: ${error}`)
		}
	}

	return policies
}

/**
 * Trigger a payout on-chain
 */
const triggerPayout = (
	runtime: Runtime<Config>,
	policyId: number,
	observedValue: number,
	payoutAmount: bigint,
): string => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	runtime.log(
		`Triggering payout for policy ${policyId}: observedValue=${observedValue}, payout=${payoutAmount.toString()}`,
	)

	// Encode the triggerPayout call
	const callData = encodeFunctionData({
		abi: PolicyManager,
		functionName: 'triggerPayout',
		args: [BigInt(policyId), BigInt(observedValue), payoutAmount],
	})

	// Generate consensus report
	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(callData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// Submit the transaction
	const resp = evmClient
		.writeReport(runtime, {
			receiver: evmConfig.policyManagerAddress,
			report: reportResponse,
			gasConfig: {
				gasLimit: evmConfig.gasLimit,
			},
		})
		.result()

	const txStatus = resp.txStatus

	if (txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Failed to trigger payout: ${resp.errorMessage || txStatus}`)
	}

	const txHash = resp.txHash || new Uint8Array(32)
	runtime.log(`Payout triggered successfully at txHash: ${bytesToHex(txHash)}`)

	return bytesToHex(txHash)
}

// Create a deterministic grouping key for policies that can share weather data.
const policyGroupKey = (p: Policy): string =>
	`${p.lat},${p.lon},${p.hazardName}`

/**
 * Main policy checking logic — fetches weather from Open-Meteo for each
 * unique (location, hazard) group and evaluates every policy in that group.
 */
const checkPoliciesAndTriggerPayouts = (runtime: Runtime<Config>): string => {
	runtime.log('Starting policy check...')

	// Get all active policies from the smart contract
	const activePolicies = getActivePolicies(runtime)
	runtime.log(`Found ${activePolicies.length} active policies`)

	if (activePolicies.length === 0) {
		return 'No active policies to check'
	}

	// Group policies by (lat, lon, hazard) to minimise HTTP calls
	const groups = new Map<string, Policy[]>()
	for (const policy of activePolicies) {
		const key = policyGroupKey(policy)
		const arr = groups.get(key)
		if (arr) {
			arr.push(policy)
		} else {
			groups.set(key, [policy])
		}
	}

	const groupKeys = Array.from(groups.keys()).sort() // sort for deterministic order
	const totalGroups = groupKeys.length
	runtime.log(`Grouped into ${totalGroups} unique (location, hazard) groups`)

	// Rotate which groups are fetched each cycle so every group gets checked.
	// Derive a cycle counter from time and the cron interval.
	const cronInterval = parseCronInterval(runtime.config.schedule)
	const cycleIndex = Math.floor(Date.now() / (cronInterval * 60000))

	let offset = 0
	if (totalGroups > MAX_HTTP_CALLS) {
		const numWindows = Math.ceil(totalGroups / MAX_HTTP_CALLS)
		offset = (cycleIndex % numWindows) * MAX_HTTP_CALLS
	}

	const httpCapability = new HTTPClient()
	let triggeredCount = 0
	let checkedCount = 0

	// Pick the rotating window of up to MAX_HTTP_CALLS groups
	const groupsToProcess = groupKeys.slice(offset, offset + MAX_HTTP_CALLS)
	// If the window wraps past the end, include groups from the start
	if (groupsToProcess.length < MAX_HTTP_CALLS && offset > 0) {
		const remaining = MAX_HTTP_CALLS - groupsToProcess.length
		groupsToProcess.push(...groupKeys.slice(0, remaining))
	}

	runtime.log(
		`Processing ${groupsToProcess.length} groups starting at offset ${offset} ` +
		`of ${totalGroups} total (cycle ${cycleIndex})`,
	)

	for (const groupKey of groupsToProcess) {
		const policiesInGroup = groups.get(groupKey)!
		// Use the first policy as the representative for the weather fetch
		const representative = policiesInGroup[0]

		try {
			runtime.log(
				`Fetching weather for group ${groupKey} ` +
				`(${policiesInGroup.length} policies, hazard=${representative.hazardName})`,
			)

			// Single HTTP call for the entire group via DON consensus
			const result = httpCapability
				.sendRequest(
					runtime,
					createWeatherFetcher(representative),
					ConsensusAggregationByFields<TriggerCheckResult>({
						triggered: median,
						value: median,
						threshold: median,
					}),
				)(runtime.config)
				.result()

			// Evaluate each policy in this group against the fetched value
			for (const policy of policiesInGroup) {
				checkedCount++
				const isTriggered = evaluateTrigger(result.value, policy.triggerThreshold, policy.hazardName)

				runtime.log(
					`Policy ${policy.id}: triggered=${isTriggered}, ` +
					`value=${result.value}, threshold=${policy.triggerThreshold}`,
				)

				if (isTriggered) {
					runtime.log(
						`Policy ${policy.id} TRIGGERED! Observed ${result.value} ` +
						`(threshold: ${policy.triggerThreshold}). Initiating payout...`,
					)

					const observedValueInt = Math.round(result.value)
					triggerPayout(runtime, policy.id, observedValueInt, policy.maxCoverage)
					triggeredCount++
				}
			}
		} catch (error) {
			runtime.log(`Error processing group ${groupKey}: ${error}`)
		}
	}

	return `Checked ${checkedCount}/${activePolicies.length} policies ` +
		`(${groupsToProcess.length} HTTP calls), triggered ${triggeredCount} payouts`
}

// ==============================================================================
// HANDLER FUNCTIONS
// ==============================================================================

/**
 * Cron trigger handler — periodically checks all active policies
 */
const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('Running CronTrigger for policy monitoring')

	return checkPoliciesAndTriggerPayouts(runtime)
}

/**
 * Log trigger handler — responds to PolicyPurchased events
 */
const onLogTrigger = (runtime: Runtime<Config>, payload: EVMLog): string => {
	runtime.log('Running LogTrigger - New policy purchased')

	const topics = payload.topics

	if (topics.length < 2) {
		runtime.log('Log payload does not contain enough topics')
		throw new Error(`log payload does not contain enough topics ${topics.length}`)
	}

	// Extract policy ID from topics[1] (first indexed parameter)
	const policyId = BigInt(bytesToHex(topics[1]))
	runtime.log(`New policy purchased with ID: ${policyId.toString()}`)

	return `Policy ${policyId.toString()} registered, will be monitored by cron job`
}

// ==============================================================================
// WORKFLOW INITIALIZATION
// ==============================================================================

const initWorkflow = (config: Config) => {
	const cronTrigger = new CronCapability()
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.evms[0].chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(
			`Network not found for chain selector name: ${config.evms[0].chainSelectorName}`,
		)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	return [
		// Cron trigger: Check all active policies periodically
		handler(
			cronTrigger.trigger({
				schedule: config.schedule,
			}),
			onCronTrigger,
		),
		// Log trigger: Listen for PolicyPurchased events
		handler(
			evmClient.logTrigger({
				addresses: [config.evms[0].policyManagerAddress],
			}),
			onLogTrigger,
		),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({
		configSchema,
	})
	await runner.run(initWorkflow)
}
