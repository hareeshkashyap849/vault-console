import type { NextConfig } from 'next';

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

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
