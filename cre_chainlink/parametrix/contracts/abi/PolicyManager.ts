export const PolicyManager = [
	// Hazard Management Events
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint8', name: 'hazardId', type: 'uint8' },
			{ indexed: false, internalType: 'string', name: 'name', type: 'string' },
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
			{ indexed: false, internalType: 'uint256', name: 'triggerThreshold', type: 'uint256' },
		],
		name: 'PolicyPurchased',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, internalType: 'uint256', name: 'policyId', type: 'uint256' },
			{ indexed: true, internalType: 'address', name: 'holder', type: 'address' },
			{ indexed: false, internalType: 'uint256', name: 'observedValue', type: 'uint256' },
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
	// View Functions - Policy Data
	{
		inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
		name: 'policies',
		outputs: [
			{ internalType: 'uint8', name: 'hazard', type: 'uint8' },
			{ internalType: 'uint40', name: 'start', type: 'uint40' },
			{ internalType: 'uint40', name: 'end', type: 'uint40' },
			{ internalType: 'uint256', name: 'maxCoverage', type: 'uint256' },
			{ internalType: 'uint256', name: 'premium', type: 'uint256' },
			{ internalType: 'uint256', name: 'triggerThreshold', type: 'uint256' },
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
	// State-Changing Functions - Hazard Management
	{
		inputs: [
			{ internalType: 'uint8', name: 'hazardId', type: 'uint8' },
			{ internalType: 'string', name: 'name', type: 'string' },
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
			{ internalType: 'uint256', name: 'observedValue', type: 'uint256' },
			{ internalType: 'uint256', name: 'payout', type: 'uint256' },
		],
		name: 'triggerPayout',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const
