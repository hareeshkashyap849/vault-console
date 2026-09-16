import { defineChain } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createConfig, http, injected } from 'wagmi';

/**
 * The chains this app can talk to, and the one connector it has.
 *
 * TWO CHAINS, AND A DELIBERATE ORDER
 *
 * `[localAnvil, baseSepolia]` -- the deployment this console reads is the local Anvil chain, so
 * it is first. That order is what makes the wallet's initial connection prefer it, and it means
 * the default chain on screen is the one the pages beside it are reading. Base Sepolia is
 * second and real: it is where the deployment work goes next, and configuring it is what stops
 * this app from being local-only.
 *
 * WHERE THE LOCAL CHAIN'S IDENTITY COMES FROM
 *
 * `deployments/local.json` -- the file the deploy script writes and the indexer reads -- is the
 * only place this chain's identity is written down. `next.config.ts` loads that record and
 * passes `chainId`/`chainName` through as `NEXT_PUBLIC_*` values, which Next inlines into this
 * bundle at build time. So neither value is typed here and neither can drift from the
 * deployment, and a build with no readable record throws below at module load -- failing the
 * build rather than quietly pointing a wallet at a chain this app has no vault on.
 *
 * This is also why the ADDRESS is not here. An address is a deployment instance and is passed
 * in from the server component that read the record; a chain id and a name are what the record
 * says about the chain, and a wallet needs to be told about the chain, not the vault.
 *
 * THE RPC IS THE SAME-ORIGIN PATH, NOT THE UPSTREAM URL
 *
 * `/rpc` goes through the rewrite in `next.config.ts`, which is what keeps the browser
 * same-origin: the real RPC endpoint may not permit this origin. `src/lib/endpoints.ts` holds
 * that rule and the reason; it is server-side code (it reads env at request time), so a client
 * module states the path rather than calling it.
 *
 * WHY ONLY `injected()`
 *
 * In wagmi v3 the connector packages are optional peer dependencies. `metaMask()` would need
 * `@metamask/connect-evm` installed, and it is not; `injected()` needs nothing, and the
 * extension in this workspace is MetaMask anyway. One connector also removes the "which wallet"
 * step, which is one less screen between the user and the form.
 */

/**
 * The local chain, described by the deployment record rather than by this file.
 *
 * `process.env.NEXT_PUBLIC_VAULT_CHAIN_ID` is read as a literal member expression on purpose:
 * Next replaces that exact form at build time. A dynamic lookup such as `process.env[name]` is
 * NOT replaced, so it would arrive in the browser as `undefined`.
 */
const LOCAL_CHAIN_ID = requiredNumber(process.env.NEXT_PUBLIC_VAULT_CHAIN_ID);
const LOCAL_CHAIN_NAME = process.env.NEXT_PUBLIC_VAULT_CHAIN_NAME ?? `Chain ${LOCAL_CHAIN_ID}`;

function requiredNumber(raw: string | undefined): number {
  const id = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      'NEXT_PUBLIC_VAULT_CHAIN_ID is not set, so the local chain cannot be configured. ' +
        'next.config.ts writes it from the deployment record\'s chainId; a build without a ' +
        'readable deployment record must fail here rather than point a wallet at a chain this ' +
        'app has no vault on.',
    );
  }
  return id;
}

const localAnvil = defineChain({
  id: LOCAL_CHAIN_ID,
  name: LOCAL_CHAIN_NAME,
  // The gas token, which is what a wallet needs this field for. It is deliberately NOT the
  // vault's asset: that is an ERC-20 whose address and decimals come from the deployment
  // record and are read from the chain.
  nativeCurrency: { name: 'Anvil Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['/rpc'] } },
});

export const wagmiConfig = createConfig({
  chains: [localAnvil, baseSepolia],
  // The one connector. See the header: v3's connector packages are optional peers, and this one
  // needs none.
  connectors: [injected()],
  transports: {
    [localAnvil.id]: http('/rpc'),
    // Base Sepolia's transport comes from viem's own definition of the chain. Both of the facts
    // it carries were checked against the primary source before being relied on:
    // https://docs.base.org/get-started/connect-to-base ("Connect to Base" -> Network Details)
    // gives Base Sepolia the chain id 84532 and the RPC https://sepolia.base.org, and viem
    // 2.56.5's `_esm/chains/definitions/baseSepolia.js` agrees on both.
    [baseSepolia.id]: http(),
  },
  // Server rendering: the wallet exists only in a browser, so connector state resolves on the
  // client. Without this the server-rendered markup and the hydrated tree disagree about whether
  // a wallet is connected, which React reports as a hydration mismatch.
  ssr: true,
});

/**
 * The `wallet_addEthereumChain` payload for a chain a wallet has not seen before.
 *
 * Built from the same `Chain` object the config uses, so a wallet that has never heard of the
 * local chain is offered exactly what this app is talking to -- id, name, RPC and gas currency
 * included. Writing this out by hand beside the chain definition is how the two drift, and the
 * symptom is a wallet that refuses to switch to the very chain the page is reading.
 */
export function addChainParameterFor(chainId: number) {
  const chain = wagmiConfig.chains.find((c) => c.id === chainId);
  if (chain === undefined) return undefined;
  return {
    chainId: `0x${chain.id.toString(16)}` as const,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
  };
}
