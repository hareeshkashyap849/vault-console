/**
 * WHERE THE TWO UPSTREAM SERVICES ARE.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The first version of this console fetched `/api/status` and opened its RPC transport at
 * `/rpc`, and `next.config.ts` rewrote both to the real services. That works in a BROWSER,
 * where a relative URL has an origin to resolve against. It does not work on the SERVER,
 * and this page is a server component: the fetches run in Node, where `fetch('/rpc')` and
 * `http('/rpc')` both throw `TypeError: Failed to parse URL` -- there is no origin to
 * resolve against. The page returned HTTP 500 with a stack that named viem and the string
 * `/rpc`, which reads like a broken RPC endpoint rather than a missing base URL.
 *
 * So the rule is written down once, here, instead of being implied in two places:
 *
 *   SERVER code (server components, route handlers, `next build`)
 *     -> uses the ABSOLUTE upstream URLs. It is the same machine as the services, so the
 *        rewrite hop is pure overhead, and an absolute URL cannot be mis-resolved.
 *
 *   CLIENT code (anything with 'use client')
 *     -> keeps using relative `/api/*` and `/rpc`, which the rewrites in `next.config.ts`
 *        forward. The browser must stay same-origin: the index service refuses
 *        cross-origin requests on purpose, and the real RPC URL may not allow this origin.
 *
 * The rewrites stay even though only client code needs them. Removing them would make the
 * next client component someone adds fail in the browser for a reason that is not obvious
 * from its own source.
 *
 * The defaults are the same ones `next.config.ts` uses, so the server and the browser
 * cannot disagree about where the services are: both read `VAULT_API` / `VAULT_RPC`.
 */

/** The index service. Default port matches `erc4626-vault-dapp`'s API default. */
export function apiBase(): string {
  return stripTrailingSlash(process.env.VAULT_API ?? 'http://127.0.0.1:8787');
}

/** The JSON-RPC endpoint the chain is read through. */
export function rpcBase(): string {
  return stripTrailingSlash(process.env.VAULT_RPC ?? 'http://127.0.0.1:8545');
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * An absolute URL on the index service, for SERVER-side use.
 *
 * `path` is the service-relative path as the service itself spells it (`/api/status`), so
 * the string here and the string in the service's own route table are the same string and
 * a typo is visible by comparison.
 */
export function apiUrl(path: string): string {
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The absolute RPC URL, for SERVER-side use. */
export function rpcUrl(): string {
  return rpcBase();
}
