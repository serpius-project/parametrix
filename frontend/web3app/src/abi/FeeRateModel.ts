export const FeeRateModelAbi = [
  {
    type: 'function',
    name: 'getFeeSplit',
    inputs: [
      { name: 'totalPremium', type: 'uint256' },
      { name: 'capitalJunior', type: 'uint256' },
      { name: 'capitalSenior', type: 'uint256' },
      { name: 'capitalUnderwriter', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'allocation',
        type: 'tuple',
        components: [
          { name: 'juniorBps', type: 'uint256' },
          { name: 'seniorBps', type: 'uint256' },
          { name: 'underwriterBps', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'juniorCap',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'seniorCap',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'baseSeniorBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'underwriterBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'uTargetBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'kBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const
