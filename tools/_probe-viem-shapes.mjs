/**
 * WHICH ERROR SHAPE DOES viem 2.56.5 PRESENT FOR EACH WAY A WALLET OR A NODE REFUSES?
 *
 * This is the artifact the error shapes in `test/wallet-errors.test.ts` came from, kept so a reader
 * can re-run the measurement instead of trusting the comment that quotes it. It drives viem's own
 * `writeContract` action against a custom transport that answers each call the way a wallet or a node
 * answers it, and prints the constructor names, `code`, `shortMessage` and the whole `cause` chain of
 * whatever comes back. What it establishes, and why the classifier reads CLASS NAMES:
 *
 *   a node refusing for funds   ContractFunctionExecutionError -> TransactionExecutionError
 *                                 -> InsufficientFundsError -> InvalidInputRpcError(code -32000, ...)
 *   a call that would revert    ContractFunctionExecutionError -> TransactionExecutionError
 *                                 -> ExecutionRevertedError   -> InvalidInputRpcError(code -32000, ...)
 *
 * SAME CODE, SAME WRAPPERS, DIFFERENT CLASS -- a classifier that read only codes would give one
 * sentence for two problems whose next actions differ.
 *
 * It sends nothing: the transport is a function, there is no network and no chain.
 *
 *   node tools/_probe-viem-shapes.mjs
 *   (output of record: verification/out/viem-error-shapes-2.56.5.txt)
 */
import { createClient, custom } from 'viem';
import { sendTransaction, writeContract } from 'viem/actions';
import { privateKeyToAccount } from 'viem/accounts';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PK);
const TO = '0x0000000000000000000000000000000000000001';

const err = (message, code) => Object.assign(new Error(message), { code });

async function attempt(label, respond) {
  const calls = [];
  const provider = {
    request: async ({ method, params }) => {
      calls.push(method);
      return respond(method, params);
    },
    on: () => {},
    removeListener: () => {},
  };
  const client = createClient({ account, transport: custom(provider) });
  console.log(`\n### ${label}`);
  try {
    const hash = await writeContract(client, {
      abi: ERC20_ABI,
      address: TO,
      functionName: 'approve',
      args: ['0x0000000000000000000000000000000000000002', 100n],
      chain: null,
    });
    console.log(`  RESOLVED with ${hash}`);
  } catch (e) {
    console.log(`  THREW ${e.constructor?.name}`);
    console.log(`    name       = ${e.name}`);
    console.log(`    code       = ${JSON.stringify(e.code)}`);
    console.log(`    shortMessage = ${JSON.stringify(e.shortMessage)}`);
    console.log(`    message    = ${JSON.stringify(String(e.message).slice(0, 400))}`);
    let cause = e.cause;
    let depth = 0;
    while (cause && depth < 5) {
      console.log(`    cause[${depth}]: ${cause.constructor?.name} code=${JSON.stringify(cause.code)} msg=${JSON.stringify(String(cause.message ?? '').slice(0, 200))}`);
      cause = cause.cause;
      depth += 1;
    }
  }
  console.log(`  methods asked: ${JSON.stringify(calls)}`);
}

const GAS_MESSAGE = 'insufficient funds for gas * price + value: have 352712045842 want 898152800000';
const ALLOWANCE_MESSAGE = 'gas required exceeds allowance (0)';
const REVERT_MESSAGE = 'execution reverted: ERC20InsufficientAllowance(0x7941438e, 0, 1000000)';

await attempt('chain refuses the send: -32000 + gas message', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err(GAS_MESSAGE, -32000);
});

await attempt('chain refuses the GAS ESTIMATE: -32000 + gas message', (method) => {
  if (method === 'eth_estimateGas') throw err(GAS_MESSAGE, -32000);
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err(GAS_MESSAGE, -32000);
});

await attempt('chain refuses the send: -32000 + "gas required exceeds allowance (0)"', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err(ALLOWANCE_MESSAGE, -32000);
});

await attempt('wallet refuses the send: 4001', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err('User rejected the request.', 4001);
});

await attempt('wallet is disconnected: 4900', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err('The provider is disconnected from all chains.', 4900);
});

await attempt('chain refuses the send with -32000 + revert text', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err(REVERT_MESSAGE, -32000);
});

await attempt('no accounts: -32603 internal error', (method) => {
  if (method === 'eth_estimateGas') return '0x5208';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_chainId') return '0x14a34';
  throw err('No accounts available.', -32603);
});
