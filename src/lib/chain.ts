import { createPublicClient, http, parseAbi } from 'viem';
import { rpcUrl } from './endpoints.ts';

/**
 * Live chain reads.
 *
 * WHY THE CONSOLE READS THE CHAIN AND THE INDEX AT ALL
 *
 * These answer different questions and neither can answer the other's:
 *
 *   the CHAIN  knows what is true NOW, and nothing about the past -- asking a node for
 *              "every deposit since deployment" is either refused or ruinously slow.
 *   the INDEX  knows what WAS true at each block, and is always behind by design,
 *              because it runs on a schedule rather than watching the chain.
 *
 * A console that shows only one of them is misleading in a specific way: chain-only makes
 * the history invisible, index-only makes the current figures stale without saying so.
 * So the page shows both and labels which is which.
 *
 * THE TRANSPORT URL IS ABSOLUTE, AND THAT IS NOT A STYLE CHOICE
 *
 * These reads run on the SERVER. The first version pointed the transport at `/rpc` and
 * relied on the rewrite in `next.config.ts`; on the server that throws
 * `TypeError: Failed to parse URL`, and the resulting 500 named `/rpc` as though the
 * endpoint were unhealthy. `endpoints.ts` holds the rule and the reason.
 */
export const VAULT_ABI = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

export const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);

export interface ChainConfig {
  chainId: number;
  vault: `0x${string}`;
  asset: `0x${string}`;
}

/**
 * The addresses come from the deployment record, so they are not typed twice.
 *
 * The console reads the SAME record the deploy script wrote and the indexer reads. A
 * hand-copied address here would be correct until the next deployment and then silently
 * wrong -- the page would query an address with no code and report zeros.
 */
export async function readDeployment(config: ChainConfig) {
  const client = createPublicClient({
    transport: http(rpcUrl(), { batch: true }),
  });

  // Read in one round trip. These are all `view` calls, so nothing here can change state.
  const [totalAssets, totalSupply, assetAddress, shareDecimals, assetSymbol, assetDecimals] = await Promise.all([
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'totalAssets' }),
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'totalSupply' }),
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'asset' }),
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'decimals' }),
    client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);

  return {
    totalAssets: totalAssets.toString(),
    totalSupply: totalSupply.toString(),
    assetAddress,
    shareDecimals: Number(shareDecimals),
    assetSymbol,
    assetDecimals: Number(assetDecimals),
  };
}

/** One holder's position, for the address the reader asks about. */
export async function readPosition(config: ChainConfig, account: `0x${string}`) {
  const client = createPublicClient({ transport: http(rpcUrl(), { batch: true }) });
  const [shares, maxWithdraw, balance] = await Promise.all([
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'balanceOf', args: [account] }),
    client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [account] }),
    client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [account] }),
  ]);
  return {
    shares: shares.toString(),
    maxWithdraw: maxWithdraw.toString(),
    assetBalance: balance.toString(),
  };
}

export type LiveRead = Awaited<ReturnType<typeof readDeployment>>;
export type LivePosition = Awaited<ReturnType<typeof readPosition>>;
