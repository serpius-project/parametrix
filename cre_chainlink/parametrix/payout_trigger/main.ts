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
	weatherApiKey: z.string(), // API key for weather data provider
	weatherApiUrl: z.string(), // Base URL for weather API
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

enum Hazard {
	Heatwave = 0,
	Flood = 1,
	Drought = 2,
}

interface Policy {
	id: number
	hazard: Hazard
	start: number
	end: number
	maxCoverage: bigint
	premium: bigint
	triggerThreshold: number
	paid: boolean
	holder: Address
}

interface WeatherData {
	temperature: number // in Celsius
	precipitation: number // in mm
	timestamp: number
}

// ==============================================================================
// UTILITY FUNCTIONS
// ==============================================================================

const safeJsonStringify = (obj: any): string =>
	JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)

/**
 * Fetch weather data from external API
 * In production, this would fetch from multiple sources for consensus
 */
const fetchWeatherDataForPolicy = (
	sendRequester: HTTPSendRequester,
	config: Config,
): WeatherData => {
	// Example: Using OpenWeatherMap or similar API
	// In production, you'd fetch from multiple APIs and aggregate
	const location = 'default_location' // Would come from policy metadata
	const url = `${config.weatherApiUrl}?location=${location}&apiKey=${config.weatherApiKey}`

	const response = sendRequester.sendRequest({ method: 'GET', url }).result()

	if (response.statusCode !== 200) {
		throw new Error(`Weather API request failed with status: ${response.statusCode}`)
	}

	const responseText = Buffer.from(response.body).toString('utf-8')
	const weatherResp = JSON.parse(responseText)

	// Parse weather data (format depends on your API)
	// This is an example structure
	return {
		temperature: weatherResp.temp || weatherResp.temperature || 0,
		precipitation: weatherResp.precipitation || weatherResp.rain || 0,
		timestamp: Date.now(),
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

	// Fetch all policies (in production, you'd want to optimize this)
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

			// Check if policy is active (not paid, not expired)
			const [hazard, start, end, maxCoverage, premium, triggerThreshold, paid] = policyData

			if (!paid && Number(end) > currentTime) {
				policies.push({
					id,
					hazard: Number(hazard) as Hazard,
					start: Number(start),
					end: Number(end),
					maxCoverage,
					premium,
					triggerThreshold: Number(triggerThreshold),
					paid,
					holder: holder as Address,
				})
			}
		} catch (error) {
			runtime.log(`Error fetching policy ${id}: ${error}`)
			// Skip this policy and continue
		}
	}

	return policies
}

/**
 * Check if a policy trigger condition is met
 */
const checkPolicyTrigger = (
	runtime: Runtime<Config>,
	policy: Policy,
	weatherData: WeatherData,
): { triggered: boolean; observedValue: number; payoutAmount: bigint } => {
	let triggered = false
	let observedValue = 0
	let payoutAmount = 0n

	switch (policy.hazard) {
		case Hazard.Heatwave:
			observedValue = weatherData.temperature
			if (weatherData.temperature >= policy.triggerThreshold) {
				triggered = true
				// Calculate payout based on how much threshold was exceeded
				// Simple example: full payout if threshold exceeded
				payoutAmount = policy.maxCoverage
			}
			break

		case Hazard.Flood:
			observedValue = weatherData.precipitation
			if (weatherData.precipitation >= policy.triggerThreshold) {
				triggered = true
				payoutAmount = policy.maxCoverage
			}
			break

		case Hazard.Drought:
			observedValue = weatherData.precipitation
			if (weatherData.precipitation <= policy.triggerThreshold) {
				triggered = true
				payoutAmount = policy.maxCoverage
			}
			break
	}

	runtime.log(
		`Policy ${policy.id}: Hazard=${Hazard[policy.hazard]}, Threshold=${policy.triggerThreshold}, Observed=${observedValue}, Triggered=${triggered}`,
	)

	return { triggered, observedValue, payoutAmount }
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
 * Main policy checking logic
 */
const checkPoliciesAndTriggerPayouts = (runtime: Runtime<Config>): string => {
	runtime.log('Starting policy check...')

	// Get all active policies
	const activePolicies = getActivePolicies(runtime)
	runtime.log(`Found ${activePolicies.length} active policies`)

	if (activePolicies.length === 0) {
		return 'No active policies to check'
	}

	// For each active policy, check if trigger conditions are met
	const httpCapability = new HTTPClient()

	let triggeredCount = 0

	for (const policy of activePolicies) {
		try {
			// Fetch weather data with DON consensus
			const weatherData = httpCapability
				.sendRequest(
					runtime,
					fetchWeatherDataForPolicy,
					ConsensusAggregationByFields<WeatherData>({
						temperature: median,
						precipitation: median,
						timestamp: median,
					}),
				)(runtime.config)
				.result()

			runtime.log(`Weather data: ${safeJsonStringify(weatherData)}`)

			// Check if policy trigger conditions are met
			const { triggered, observedValue, payoutAmount } = checkPolicyTrigger(
				runtime,
				policy,
				weatherData,
			)

			if (triggered) {
				runtime.log(`Policy ${policy.id} triggered! Initiating payout...`)
				triggerPayout(runtime, policy.id, observedValue, payoutAmount)
				triggeredCount++
			}
		} catch (error) {
			runtime.log(`Error processing policy ${policy.id}: ${error}`)
			// Continue with next policy
		}
	}

	return `Checked ${activePolicies.length} policies, triggered ${triggeredCount} payouts`
}

// ==============================================================================
// HANDLER FUNCTIONS
// ==============================================================================

/**
 * Cron trigger handler - periodically checks all active policies
 */
const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('Running CronTrigger for policy monitoring')

	return checkPoliciesAndTriggerPayouts(runtime)
}

/**
 * Log trigger handler - responds to PolicyPurchased events
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

	// Optionally, you could immediately check this new policy
	// For now, we'll let the cron job handle it

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
				// Topic[0] is the event signature hash for PolicyPurchased
				// This will automatically filter for PolicyPurchased events
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
