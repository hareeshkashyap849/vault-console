import type { NextConfig } from 'next';
import { loadDeployment } from './src/lib/deployment.ts';

/**
 * The API the console reads is a SEPARATE SERVICE on another port, and the console is not
 * allowed to call it directly across origins.
 *
 * WHY A REWRITE INSTEAD OF A CROSS-ORIGIN FETCH
 *
 * The index service has no authentication and refuses cross-origin requests -- correctly,
 * because it serves public chain data and should not be callable from a stranger's page.
 * A rewrite keeps the browser's request same-origin: the console asks `/api/*`, Next.js
 * forwards it to the service, and no CORS allowance has to be added to a service that
 * should not have one.
 *
 * WHY THE TARGET IS CONFIGURABLE
 *
 * The service's port is not part of its contract. Hard-coding `8787` here would mean the
 * console breaks the first time someone runs the API elsewhere, and it would do so with a
 * confusing "fetch failed" rather than a wrong-port message. `VAULT_API` overrides it.
 */
const API_TARGET = process.env.VAULT_API ?? 'http://127.0.0.1:8787';
const CHAIN_RPC = process.env.VAULT_RPC ?? 'http://127.0.0.1:8545';

/**
 * The chain's identity, handed to the browser from the deployment record.
 *
 * A SERVER COMPONENT CAN READ THE RECORD; A WALLET CONFIG CANNOT. `wagmiConfig` is built in a
 * module the browser loads, where `node:fs` does not exist and there is no request to read a
 * file during -- so the one fact the wallet genuinely needs about the chain (its id, and what to
 * call it) has to cross the boundary at build time. That is what `NEXT_PUBLIC_*` is for, and
 * naming the values here rather than in `src/lib/wagmi.ts` keeps `deployments/local.json` the
 * single source: this file loads it, exactly as the deploy script and the indexer do.
 *
 * `loadDeployment()` throws on a missing or partial record, so a build against no deployment
 * fails here. That is the intended outcome: the alternative is a wallet pointed at a chain this
 * app has no vault on.
 */
const deployment = loadDeployment();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VAULT_CHAIN_ID: String(deployment.chainId),
    NEXT_PUBLIC_VAULT_CHAIN_NAME: deployment.chainName,
  },
  async rewrites() {
    return [
      // `:path*` so query strings and any future endpoint come along. Listing endpoints
      // one by one would mean a new endpoint silently 404s in the console until someone
      // remembers to add it here.
      { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
      // The chain is proxied too, for the same reason the wallet dApp proxies it: the
      // page must not depend on the RPC endpoint permitting this origin.
      { source: '/rpc', destination: CHAIN_RPC },
    ];
  },
};

export default nextConfig;
