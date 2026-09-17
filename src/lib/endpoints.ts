/**
 * WHERE THE TWO UPSTREAM SERVICES ARE.
 *
 * WHO READS THIS NOW, AND WHO DOES NOT
 *
 * NOTHING in `src/`. The pages are client components in a static export, and the endpoint a
 * page reads the chain through comes from the generated runtime config (`public/api/config`,
 * written by `../scripts/build-runtime-config.mjs`, read by `./runtimeConfig.ts`), so no
 * application module needs to know where either service lives. What is left is one duplicate and
 * two importers:
 *
 *   `next.config.ts` -- the duplicate, and not by import. That is worth stating plainly, because it
 *     is the one hand-kept duplicate in this repository. It declares `API_TARGET` and
 *     `CHAIN_RPC` with the same two defaults below and the same `VAULT_API` / `VAULT_RPC`
 *     overrides, and uses them for its DEVELOPMENT-only rewrites. The two files have to agree
 *     by being read together; if a default moves in one and not the other, a development
 *     rewrite and a test point at different hosts and neither of them says so.
 *
 *   `test/api.test.ts` -- asserts the defaults, the env override and the trailing-slash strip.
 *   `test/api-against-real-service.test.ts` -- calls a live service through `apiBase()`, and
 *     that is the one caller for which an absolute URL is still load-bearing (see below).
 *
 * WHY THE URLS ARE ABSOLUTE, AND WHAT SURVIVED OF THE REASON
 *
 * The first version of this console fetched `/api/status` and opened its RPC transport at
 * `/rpc`, and `next.config.ts` rewrote both to the real services. That works in a BROWSER,
 * where a relative URL has an origin to resolve against. It does not work anywhere without
 * one: `fetch('/rpc')` and `http('/rpc')` in Node throw `TypeError: Failed to parse URL`, and
 * the 500 that reached the reader named viem and the string `/rpc`, which reads like a broken
 * RPC endpoint rather than a missing base URL.
 *
 * The rule that used to be written out here -- server code takes the absolute URLs, client
 * code keeps the relative `/api/*` and `/rpc` paths -- was a rule about an application that
 * ran a server component beside the services. There is no server any more, so most of that
 * rule has nothing left to be true of. The narrower half survived, and it is the half these
 * tests exercise: a caller with no origin to resolve against must be handed a URL that already
 * means something on its own. That caller is a Node test now, not a server component.
 * `./chain.ts` states the browser's version of the same constraint: there the endpoint is
 * passed in from the generated config, because a client bundle has no request-time
 * environment to read it from and `process.env.VAULT_RPC` in it is `undefined`.
 *
 * The DEV-ONLY rewrites in `next.config.ts` still exist, for the reason they always did: the
 * index service refuses cross-origin requests on purpose, so the browser has to reach it
 * same-origin. That file omits them entirely for the static export rather than leaving a
 * rewrite that cannot run -- a rewrite that silently cannot work is worse than one that is
 * absent.
 *
 * The defaults are the same ones `next.config.ts` uses, so a development rewrite and a test
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
 * An absolute URL on the index service.
 *
 * `path` is the service-relative path as the service itself spells it (`/api/status`), so
 * the string here and the string in the service's own route table are the same string and
 * a typo is visible by comparison. ABSOLUTE is the property under test: it is what a caller
 * with no origin -- `test/api-against-real-service.test.ts` -- needs, and it is the reason
 * this file outlived the server it was written for (see the header).
 */
export function apiUrl(path: string): string {
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The absolute RPC URL, for the same origin-less caller `apiUrl` serves. */
export function rpcUrl(): string {
  return rpcBase();
}
