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
	parametrixApiUrl: z.string(), // Base URL for the Parametrix Python API (e.g., "http://localhost:8000")
	lookbackMonths: z.number().int().min(1).max(12), // Months to look back for weather data
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
// TYPES
// ==============================================================================

// Hazard types (matches smart contract uint8 values)
type HazardType = number

// Mapping from on-chain hazard IDs to Python API hazard names
const HAZARD_ID_TO_NAME: Record<number, string> = {
	0: 'heatwave',
	1: 'flood',
	2: 'drought',
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
	holder: Address
}

// Consensus-compatible result from the Parametrix API.
// All fields are numeric so the DON nodes can aggregate via median.
interface TriggerCheckResult {
	triggered: number // 1 = triggered, 0 = not triggered
	value: number // observed weather value
	threshold: number // trigger threshold echoed back
}

// ==============================================================================
// UTILITY FUNCTIONS
// ==============================================================================

/**
 * Creates a fetcher function for a specific policy.
 * The returned function matches the CRE SDK HTTPSendRequester callback signature:
 *   (sendRequester, config) => TriggerCheckResult
 *
 * Each DON node calls POST /check-event on the Parametrix Python API,
 * then the CRE consensus layer aggregates the numeric results via median.
 */
const createPolicyFetcher = (policy: Policy) =>
	(sendRequester: HTTPSendRequester, config: Config): TriggerCheckResult => {
		const url = `${config.parametrixApiUrl}/check-event`

		const body = JSON.stringify({
			lat: policy.lat,
			lon: policy.lon,
			hazard: policy.hazardName,
			threshold: policy.triggerThreshold,
			payout: Number(policy.maxCoverage),
			lookback_months: config.lookbackMonths,
		})

		const response = sendRequester.sendRequest({
			method: 'POST',
			url,
			body,
		}).result()

		if (response.statusCode !== 200) {
			throw new Error(`Parametrix API request failed with status: ${response.statusCode}`)
		}

		const responseText = Buffer.from(response.body).toString('utf-8')
		const parsed = JSON.parse(responseText)

		return {
			triggered: parsed.triggered ? 1 : 0,
			value: Number(parsed.value ?? 0),
			threshold: Number(parsed.threshold ?? policy.triggerThreshold),
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

	// Fetch all policies
	const policies: Policy[] = []
	const currentTime = Math.floor(Date.now() / 1000)

	for (let id = 1; id < Number(nextId); id++) {
		try {
			// Fetch policy data
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

			// Fetch holder
			const holderCallData = encodeFunctionData({
				abi: PolicyManager,
				functionName: 'holderOf',
				args: [BigInt(id)],
			})

			const holderResponse = evmClient
				.callContract(runtime, {
					call: encodeCallMsg({
						from: zeroAddress,
						to: evmConfig.policyManagerAddress as Address,
						data: holderCallData,
					}),
					blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
				})
				.result()

			const holder = decodeFunctionResult({
				abi: PolicyManager,
				functionName: 'holderOf',
				data: bytesToHex(holderResponse.data),
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
					lat: Number(lat) / 10000, // Convert from int32 × 10000 to decimal degrees
					lon: Number(lon) / 10000,
					maxCoverage,
					premium,
					triggerThreshold: Number(triggerThreshold),
					paid,
					holder: holder as Address,
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

/**
 * Main policy checking logic — calls the Parametrix Python API for each active policy
 */
const checkPoliciesAndTriggerPayouts = (runtime: Runtime<Config>): string => {
	runtime.log('Starting policy check...')

	// Get all active policies from the smart contract
	const activePolicies = getActivePolicies(runtime)
	runtime.log(`Found ${activePolicies.length} active policies`)

	if (activePolicies.length === 0) {
		return 'No active policies to check'
	}

	const httpCapability = new HTTPClient()
	let triggeredCount = 0

	for (const policy of activePolicies) {
		try {
			runtime.log(
				`Checking policy ${policy.id}: hazard=${policy.hazardName}, ` +
				`location=(${policy.lat}, ${policy.lon}), threshold=${policy.triggerThreshold}`,
			)

			// Call Parametrix Python API /check-event via DON consensus.
			// Each node calls the API independently; results are aggregated via median.
			const result = httpCapability
				.sendRequest(
					runtime,
					createPolicyFetcher(policy),
					ConsensusAggregationByFields<TriggerCheckResult>({
						triggered: median,
						value: median,
						threshold: median,
					}),
				)(runtime.config)
				.result()

			const isTriggered = result.triggered >= 1

			runtime.log(
				`Policy ${policy.id}: triggered=${isTriggered}, ` +
				`value=${result.value}, threshold=${result.threshold}`,
			)

			if (isTriggered) {
				runtime.log(
					`Policy ${policy.id} TRIGGERED! Observed ${result.value} ` +
					`(threshold: ${policy.triggerThreshold}). Initiating payout...`,
				)

				// Use maxCoverage as the payout amount (pro-rata is handled on-chain)
				const observedValueInt = Math.round(result.value)
				triggerPayout(runtime, policy.id, observedValueInt, policy.maxCoverage)
				triggeredCount++
			}
		} catch (error) {
			runtime.log(`Error processing policy ${policy.id}: ${error}`)
		}
	}

	return `Checked ${activePolicies.length} policies, triggered ${triggeredCount} payouts`
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
