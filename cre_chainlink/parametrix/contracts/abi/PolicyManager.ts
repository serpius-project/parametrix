export const PolicyManager = [
	// Hazard Management Events
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint8', name: 'hazardId', type: 'uint8' },
			{ indexed: false, internalType: 'string', name: 'name', type: 'string' },
			{ indexed: false, internalType: 'bool', name: 'triggerAbove', type: 'bool' },
		],
		name: 'HazardAdded',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [{ indexed: true, internalType: 'uint8', name: 'hazardId', type: 'uint8' }],
		name: 'HazardRemoved',
		type: 'event',
	},
	// Policy Events
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' },
			{ indexed: true, internalType: 'address', name: 'holder', type: 'address' },
			{ indexed: false, internalType: 'uint8', name: 'hazard', type: 'uint8' },
			{ indexed: false, internalType: 'uint256', name: 'start', type: 'uint256' },
			{ indexed: false, internalType: 'uint256', name: 'end', type: 'uint256' },
			{ indexed: false, internalType: 'uint256', name: 'maxCoverage', type: 'uint256' },
			{ indexed: false, internalType: 'int256', name: 'triggerThreshold', type: 'int256' },
			{ indexed: false, internalType: 'int32', name: 'lat', type: 'int32' },
			{ indexed: false, internalType: 'int32', name: 'lon', type: 'int32' },
		],
		name: 'PolicyPurchased',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' },
			{ indexed: true, internalType: 'address', name: 'holder', type: 'address' },
			{ indexed: false, internalType: 'int256', name: 'observedValue', type: 'int256' },
			{ indexed: false, internalType: 'uint256', name: 'requestedPayout', type: 'uint256' },
			{ indexed: false, internalType: 'uint256', name: 'actualPayout', type: 'uint256' },
		],
		name: 'PayoutTriggered',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' },
			{ indexed: false, internalType: 'uint256', name: 'sharesReleased', type: 'uint256' },
		],
		name: 'PolicyExpiredReleased',
		type: 'event',
	},
	// Policy Verification Events
	{
		anonymous: false,
		inputs: [{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' }],
		name: 'PolicyVerified',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' }],
		name: 'PolicyRejected',
		type: 'event',
	},
	// View Functions - Hazard Registry
	{
		inputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
		name: 'validHazards',
		outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
		name: 'hazardNames',
		outputs: [{ internalType: 'string', name: '', type: 'string' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
		name: 'hazardTriggerAbove',
		outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
		stateMutability: 'view',
		type: 'function',
	},
	// View Functions - Policy Data
	{
		inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
		name: 'policies',
		outputs: [
			{ internalType: 'uint8', name: 'hazard', type: 'uint8' },
			{ internalType: 'uint40', name: 'start', type: 'uint40' },
			{ internalType: 'uint40', name: 'end', type: 'uint40' },
			{ internalType: 'int32', name: 'lat', type: 'int32' },
			{ internalType: 'int32', name: 'lon', type: 'int32' },
			{ internalType: 'uint256', name: 'maxCoverage', type: 'uint256' },
			{ internalType: 'uint256', name: 'premium', type: 'uint256' },
			{ internalType: 'int256', name: 'triggerThreshold', type: 'int256' },
			{ internalType: 'bool', name: 'paid', type: 'bool' },
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
		name: 'holderOf',
		outputs: [{ internalType: 'address', name: '', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'oracle',
		outputs: [{ internalType: 'address', name: '', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'nextId',
		outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	// View Functions - Policy Verification Status
	{
		inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
		name: 'policyStatus',
		outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
	// State-Changing Functions - Policy Verification
	{
		inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
		name: 'verifyPolicy',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
		name: 'rejectPolicy',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	// State-Changing Functions - Hazard Management
	{
		inputs: [
			{ internalType: 'uint8', name: 'hazardId', type: 'uint8' },
			{ internalType: 'string', name: 'name', type: 'string' },
			{ internalType: 'bool', name: 'triggerAbove', type: 'bool' },
		],
		name: 'addHazardType',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ internalType: 'uint8', name: 'hazardId', type: 'uint8' }],
		name: 'removeHazardType',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	// State-Changing Functions - Payout
	{
		inputs: [
			{ internalType: 'uint256', name: 'id', type: 'uint256' },
			{ internalType: 'int256', name: 'observedValue', type: 'int256' },
			{ internalType: 'uint256', name: 'payout', type: 'uint256' },
		],
		name: 'triggerPayout',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const
