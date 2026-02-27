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
	schedule: z.string(),
	minLoadingFactor: z.number().min(0).max(1),
	evms: z.array(
		z.object({
			policyManagerAddress: z.string(),
			chainSelectorName: z.string(),
			gasLimit: z.string(),
		}),
	),
	apiUrl: z.string(),
})

type Config = z.infer<typeof configSchema>

// ==============================================================================
// CRE SERVICE QUOTAS — https://docs.chain.link/cre/service-quotas
// ==============================================================================

const MAX_HTTP_CALLS = 5   // PerWorkflow.HTTPAction.CallLimit
const MAX_EVM_READS = 10   // PerWorkflow.ChainRead.CallLimit

const parseCronInterval = (schedule: string): number => {
	const parts = schedule.trim().split(/\s+/)
	if (parts.length < 5) return 1
	const minuteField = parts[0]
	if (minuteField === '*') return 1
	const stepMatch = minuteField.match(/^\*\/(\d+)$/)
	if (stepMatch) return Math.max(1, parseInt(stepMatch[1], 10))
	return 1
}

// ==============================================================================
// TYPES
// ==============================================================================

const HAZARD_ID_TO_NAME: Record<number, string> = {
	0: 'heatwave',
	1: 'flood',
	2: 'drought',
}

// PolicyStatus enum values (matches smart contract)
const STATUS_UNVERIFIED = 0
const STATUS_VERIFIED = 1

interface UnverifiedPolicy {
	id: number
	hazard: number
	hazardName: string
	lat: number   // decimal degrees (decoded from int32 / 10000)
	lon: number
	maxCoverage: bigint
	premium: bigint
	triggerThreshold: number
	start: number
	end: number
}

// Result from the Python API /premium endpoint.
// All fields numeric for DON consensus via median.
interface PremiumCheckResult {
	premiumUsdc: number // API-computed minimum premium (USDC, not raw units)
}

// ==============================================================================
// CONTRACT READS
// ==============================================================================

/**
 * Scan the contract for unverified policies within the rotating window.
 * Budget: 1 EVM read for nextId + 2 reads per policy (status + data)
 * → maxPolicyScan = floor((MAX_EVM_READS - 1) / 2) = 4
 */
const getUnverifiedPolicies = (runtime: Runtime<Config>): UnverifiedPolicy[] => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	// 1 EVM read: nextId()
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

	const totalPolicies = Number(nextId) - 1
	const maxPolicyScan = Math.floor((MAX_EVM_READS - 1) / 2) // 2 reads per policy

	// Rotating scan window
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

	const policies: UnverifiedPolicy[] = []

	for (let id = scanStart; id < scanEnd; id++) {
		try {
			// EVM read 1: policyStatus(id)
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

			if (Number(status) !== STATUS_UNVERIFIED) {
				runtime.log(`Policy ${id}: status=${status}, skipping (not unverified)`)
				continue
			}

			// EVM read 2: policies(id)
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

			const [hazard, start, end, lat, lon, maxCoverage, premium, triggerThreshold] = policyData
			const hazardNum = Number(hazard)
			const hazardName = HAZARD_ID_TO_NAME[hazardNum]

			if (!hazardName) {
				runtime.log(`Policy ${id}: unknown hazard ${hazardNum}, skipping`)
				continue
			}

			policies.push({
				id,
				hazard: hazardNum,
				hazardName,
				lat: Number(lat) / 10000,
				lon: Number(lon) / 10000,
				maxCoverage,
				premium,
				triggerThreshold: Number(triggerThreshold),
				start: Number(start),
				end: Number(end),
			})
		} catch (error) {
			runtime.log(`Error fetching policy ${id}: ${error}`)
		}
	}

	return policies
}

// ==============================================================================
// PREMIUM VERIFICATION
// ==============================================================================

// Group key for policies sharing the same API call
const policyGroupKey = (p: UnverifiedPolicy): string =>
	`${p.lat},${p.lon},${p.hazardName}`

/**
 * Creates a fetcher that calls the Python /premium API for a group of policies.
 * Returns the minimum acceptable premium for the representative policy.
 */
const createPremiumFetcher = (representative: UnverifiedPolicy) =>
	(sendRequester: HTTPSendRequester, config: Config): PremiumCheckResult => {
		const durationSeconds = representative.end - representative.start
		const nMonths = Math.max(1, Math.round(durationSeconds / (30 * 24 * 3600)))

		// maxCoverage is in raw token units — convert to USDC float.
		// We don't know decimals here, so we pass the raw value as payout
		// and compare the API result in the same units.
		// The API expects payout in USDC (float), and the contract stores
		// premium in raw token units. We convert maxCoverage assuming 6 decimals (USDC).
		const payoutUsdc = Number(representative.maxCoverage) / 1e6

		const body = JSON.stringify({
			lat: representative.lat,
			lon: representative.lon,
			hazard: representative.hazardName,
			threshold: representative.triggerThreshold,
			n_months: nMonths,
			payout: payoutUsdc,
			loading_factor: config.minLoadingFactor,
		})

		const response = sendRequester.sendRequest({
			method: 'POST',
			url: `${config.apiUrl}/premium`,
			headers: { 'Content-Type': 'application/json' },
			body: new TextEncoder().encode(body),
		}).result()

		if (response.statusCode !== 200) {
			throw new Error(`Premium API returned status ${response.statusCode}`)
		}

		const responseText = Buffer.from(response.body).toString('utf-8')
		const data = JSON.parse(responseText)

		if (!data.premium_usdc && data.premium_usdc !== 0) {
			throw new Error('Premium API response missing premium_usdc')
		}

		return {
			premiumUsdc: data.premium_usdc,
		}
	}

/**
 * Submit a verifyPolicy or rejectPolicy transaction on-chain.
 */
const submitVerification = (
	runtime: Runtime<Config>,
	policyId: number,
	action: 'verifyPolicy' | 'rejectPolicy',
): string => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	runtime.log(`Submitting ${action} for policy ${policyId}`)

	const callData = encodeFunctionData({
		abi: PolicyManager,
		functionName: action,
		args: [BigInt(policyId)],
	})

	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(callData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	const resp = evmClient
		.writeReport(runtime, {
			receiver: evmConfig.policyManagerAddress,
			report: reportResponse,
			gasConfig: {
				gasLimit: evmConfig.gasLimit,
			},
		})
		.result()

	if (resp.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Failed to ${action}: ${resp.errorMessage || resp.txStatus}`)
	}

	const txHash = resp.txHash || new Uint8Array(32)
	runtime.log(`${action} succeeded at txHash: ${bytesToHex(txHash)}`)

	return bytesToHex(txHash)
}

// ==============================================================================
// MAIN VERIFICATION LOGIC
// ==============================================================================

const verifyPolicies = (runtime: Runtime<Config>): string => {
	runtime.log('Starting underwriter verification...')

	const unverifiedPolicies = getUnverifiedPolicies(runtime)
	runtime.log(`Found ${unverifiedPolicies.length} unverified policies`)

	if (unverifiedPolicies.length === 0) {
		return 'No unverified policies to check'
	}

	// Group by (lat, lon, hazard) to minimise HTTP calls
	const groups = new Map<string, UnverifiedPolicy[]>()
	for (const policy of unverifiedPolicies) {
		const key = policyGroupKey(policy)
		const arr = groups.get(key)
		if (arr) {
			arr.push(policy)
		} else {
			groups.set(key, [policy])
		}
	}

	const groupKeys = Array.from(groups.keys()).sort()
	const totalGroups = groupKeys.length
	runtime.log(`Grouped into ${totalGroups} unique (location, hazard) groups`)

	// Rotating HTTP window
	const cronInterval = parseCronInterval(runtime.config.schedule)
	const cycleIndex = Math.floor(Date.now() / (cronInterval * 60000))

	let offset = 0
	if (totalGroups > MAX_HTTP_CALLS) {
		const numWindows = Math.ceil(totalGroups / MAX_HTTP_CALLS)
		offset = (cycleIndex % numWindows) * MAX_HTTP_CALLS
	}

	const httpCapability = new HTTPClient()
	let verifiedCount = 0
	let rejectedCount = 0

	const groupsToProcess = groupKeys.slice(offset, offset + MAX_HTTP_CALLS)
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
		const representative = policiesInGroup[0]

		try {
			runtime.log(
				`Fetching premium for group ${groupKey} ` +
				`(${policiesInGroup.length} policies, hazard=${representative.hazardName})`,
			)

			// Single HTTP call per group via DON consensus
			const result = httpCapability
				.sendRequest(
					runtime,
					createPremiumFetcher(representative),
					ConsensusAggregationByFields<PremiumCheckResult>({
						premiumUsdc: median,
					}),
				)(runtime.config)
				.result()

			// API returns premium_usdc as a float (e.g. 281.47).
			// On-chain premium is in raw token units (6 decimals for USDC).
			const minimumPremiumRaw = BigInt(Math.floor(result.premiumUsdc * 1e6))

			runtime.log(`Group ${groupKey}: API minimum premium = ${result.premiumUsdc} USDC (${minimumPremiumRaw} raw)`)

			// Evaluate each policy in this group
			for (const policy of policiesInGroup) {
				// Policies in the same group share location+hazard but may have
				// different coverage/threshold. For policies with different coverage
				// or threshold than the representative, we use the group result
				// as an approximation. The premium scales linearly with coverage,
				// so we adjust: adjustedMinimum = minimumPremiumRaw * policy.maxCoverage / representative.maxCoverage
				let adjustedMinimum = minimumPremiumRaw
				if (policy.maxCoverage !== representative.maxCoverage) {
					adjustedMinimum = (minimumPremiumRaw * policy.maxCoverage) / representative.maxCoverage
				}

				runtime.log(
					`Policy ${policy.id}: onChainPremium=${policy.premium.toString()}, ` +
					`minimumRequired=${adjustedMinimum.toString()}`,
				)

				if (policy.premium >= adjustedMinimum) {
					submitVerification(runtime, policy.id, 'verifyPolicy')
					verifiedCount++
				} else {
					runtime.log(
						`Policy ${policy.id} REJECTED: premium ${policy.premium.toString()} < ` +
						`minimum ${adjustedMinimum.toString()}`,
					)
					submitVerification(runtime, policy.id, 'rejectPolicy')
					rejectedCount++
				}
			}
		} catch (error) {
			runtime.log(`Error processing group ${groupKey}: ${error}`)
		}
	}

	return `Verified ${verifiedCount}, rejected ${rejectedCount} ` +
		`out of ${unverifiedPolicies.length} unverified policies ` +
		`(${groupsToProcess.length} HTTP calls)`
}

// ==============================================================================
// HANDLER FUNCTIONS
// ==============================================================================

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('Running CronTrigger for underwriter verification')
	return verifyPolicies(runtime)
}

const onLogTrigger = (runtime: Runtime<Config>, payload: EVMLog): string => {
	runtime.log('Running LogTrigger - New policy purchased')

	const topics = payload.topics

	if (topics.length < 2) {
		runtime.log('Log payload does not contain enough topics')
		throw new Error(`log payload does not contain enough topics ${topics.length}`)
	}

	const policyId = BigInt(bytesToHex(topics[1]))
	runtime.log(`New policy purchased with ID: ${policyId.toString()}`)

	return `Policy ${policyId.toString()} registered, will be verified by cron job`
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
		handler(
			cronTrigger.trigger({
				schedule: config.schedule,
			}),
			onCronTrigger,
		),
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
