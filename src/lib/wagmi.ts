import { defineChain, type Chain } from 'viem';
import { createConfig, http, injected, type Config, type Connector } from 'wagmi';

import type { RuntimeConfig } from '@/lib/runtimeConfig';

/**
 * The chain this console talks to, and the one connector it has.
 *
 * ONE CHAIN, AND IT IS THE DEPLOYMENT'S
 *
 * An earlier version configured two: the local Anvil chain first, Base Sepolia second. That was
 * right while the console was local-only and the public deployment was "next". It is wrong now,
 * and not because the second chain broke anything: this console reads ONE deployment, and a
 * second chain in the wallet config is an invitation to connect to a chain where that vault does
 * not exist. The wrong-chain guard would then have to explain a situation the configuration
 * created. The record says which chain, so the record decides.
 *
 * WHERE THE IDENTITY COMES FROM
 *
 * `api/config`, generated from the deployment record by `scripts/build-runtime-config.mjs`.
 * Before the static export this value was inlined at build time through `NEXT_PUBLIC_*`, because
 * a module the browser loads cannot read a file. It still cannot -- but it can read the file the
 * build wrote, which keeps the record the single source and lets one build point at any
 * deployment without a rebuild.
 *
 * WHY ONLY `injected()`
 *
 * In wagmi v3 the connector packages are optional peer dependencies. `metaMask()` would need
 * `@metamask/connect-evm` installed, and it is not; `injected()` needs nothing, and the
 * extension in this workspace is MetaMask anyway. One connector also removes the "which wallet"
 * step, which is one less screen between the user and the form.
 */
export function chainFor(config: RuntimeConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainName,
    // The gas token, which is what a wallet needs this field for. It is deliberately NOT the
    // vault's asset: that is an ERC-20 whose address and decimals come from the deployment
    // record and are read from the chain.
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

/**
 * Build the wagmi config from the runtime config.
 *
 * A FUNCTION, NOT A MODULE CONSTANT. The chain's identity is not known until `api/config` has
 * been fetched, so a module-scope `createConfig` would have to invent it -- which is what the
 * build-time env var used to do, and what a static export cannot do for a deployment chosen at
 * deploy time rather than at build time.
 */
export function createWagmiConfig(config: RuntimeConfig): Config {
  const chain = chainFor(config);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: {
      // The deployment's own endpoint, read by the browser. In development the generated config
      // points this at `/rpc`, which `next.config.ts` rewrites to the local chain, so the browser
      // stays same-origin there without a second code path here.
      [chain.id]: http(config.rpcUrl),
    },
    // Server rendering: the wallet exists only in a browser, so connector state resolves on the
    // client. Without this the server-rendered markup and the hydrated tree disagree about whether
    // a wallet is connected, which React reports as a hydration mismatch.
    ssr: true,
  });
}

/**
 * WHICH CHAIN THE WALLET IS ON **RIGHT NOW**, ASKED OF THE WALLET.
 *
 * WHY THIS IS NOT `useChainId()`
 *
 * `useChainId()` returns `config.state.chainId`, and `createConfig` deliberately pins that value to
 * a chain from `config.chains`:
 *
 *     store.subscribe(({ connections, current }) => current ? connections.get(current)?.chainId : undefined,
 *       (chainId) => {
 *         // If chain is not configured, then don't switch over to it.
 *         if (!chains.getState().some((x) => x.id === chainId)) return;   // <-- 8453 returns here
 *         return store.setState((x) => ({ ...x, chainId }));
 *       });
 *     (node_modules/wagmi/node_modules/@wagmi/core/dist/esm/createConfig.js)
 *
 * This app configures ONE chain -- the deployment's -- so a wallet that moves to any other chain
 * leaves `state.chainId` on the deployment's chain: the guard compared the app's chain with itself
 * and could not observe the fact it exists to check. The connection's own `chainId` IS updated for
 * such a chain (`change()` writes it into the connection), and this reads the wallet itself.
 *
 * WHY ASK THE WALLET AND NOT THE CONNECTION OBJECT
 *
 * The connection is a React value: it reaches a click handler through a render, and a click can be
 * delivered in the same task as the wallet's `chainChanged` event -- before React has committed the
 * re-render that would have removed the button. The wallet's own `eth_chainId` has no such lag, and
 * it costs one request that prompts for nothing.
 *
 * `null` MEANS "NOT READ", NEVER "MATCHES": a wallet that cannot answer has not been shown to be on
 * the deployment's chain.
 */
export async function walletChainNow(connector: Connector): Promise<number | null> {
  try {
    return await connector.getChainId();
  } catch {
    return null;
  }
}

/**
 * THE `wallet_addEthereumChain` payload for a chain a wallet has not seen before.
 *
 * Built from the same `Chain` object the config uses, so a wallet that has never heard of this
 * chain is offered exactly what the app is talking to -- id, name, RPC and gas currency included.
 * Writing this out by hand beside the chain definition is how the two drift, and the symptom is a
 * wallet that refuses to switch to the very chain the page is reading.
 */
export function addChainParameterFor(config: Config, chainId: number) {
  const chain = config.chains.find((c) => c.id === chainId);
  if (chain === undefined) return undefined;
  return {
    chainId: `0x${chain.id.toString(16)}` as const,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
  };
}
