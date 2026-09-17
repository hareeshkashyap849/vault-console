import type { NextConfig } from 'next';

/**
 * TWO MODES, ONE APPLICATION.
 *
 * DEVELOPMENT (and `next start`) -- the mode this file was written for:
 *
 *   The API the console reads is a SEPARATE SERVICE on another port, and the browser is not
 *   allowed to call it directly across origins. The index service has no authentication and
 *   refuses cross-origin requests -- correctly, because it serves public chain data and should
 *   not be callable from a stranger's page. A rewrite keeps the request same-origin: the
 *   console asks `/api/*`, Next.js forwards it, and no CORS allowance has to be added to a
 *   service that should not have one. `VAULT_API` and `VAULT_RPC` override the targets, because
 *   the services' ports are not part of their contract.
 *
 * STATIC EXPORT (`STATIC_EXPORT=1`, used by the Pages workflow):
 *
 *   There is no server, so there is nothing to rewrite and nothing to read a deployment record
 *   per request. The pages are client components that read the chain themselves and fetch a
 *   generated `api/config` written by `scripts/build-runtime-config.mjs`. The rewrites are
 *   omitted rather than left in place, because Next rejects a static export that declares them
 *   -- and a rewrite that silently cannot work is worse than one that is absent.
 *
 *   `basePath` is what makes a GitHub Pages PROJECT site work: the site is served from
 *   `/<repo>/`, not from the domain root. Next rewrites `<Link>` and the router for it
 *   automatically; code that builds a URL by hand must add it itself, which is why the client
 *   config loader reads `NEXT_PUBLIC_BASE_PATH` instead of assuming a root.
 */
const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Skip Next's own type check, which is a SANDBOX WORKAROUND and must not be set in CI.
 *
 * `next build` runs `tsc` as a child process and captures its output through a pipe. Named pipes
 * are unavailable in the sandbox this workspace runs in, so the build dies with `spawn EPERM` at
 * exactly the "Running TypeScript ..." step -- an error about the sandbox that reads like a build
 * failure. `npm run typecheck` runs the same check in-process and does work here, so nothing is
 * unchecked; the flag just moves the check to where it can run.
 *
 * The workflow deliberately does NOT set it: on a real runner the check belongs inside the build,
 * where a failure stops the deploy.
 */
const SKIP_TYPECHECK = process.env.NEXT_SKIP_TYPECHECK === '1';

/**
 * Run the build's page workers as THREADS instead of child processes. Also a sandbox workaround.
 *
 * `next build` collects page data with `jest-worker`, which by default forks a process per worker
 * and talks to it over a named pipe. This workspace's sandbox refuses named pipes, so the build
 * dies at "Collecting page data using 7 workers" with a bare `Error: spawn EPERM` and no file or
 * line -- the same class of failure `NEXT_SKIP_TYPECHECK` exists for, at a different step.
 *
 * `experimental.workerThreads` is Next's own switch for this: the workers become `worker_threads`,
 * which share the parent's process and need no pipe. The work is identical -- the same worker
 * module, the same exposed methods, the same output. What changes is only how the child is
 * created, which is exactly the thing the sandbox forbids.
 *
 * As with `NEXT_SKIP_TYPECHECK`, THE WORKFLOW DELIBERATELY DOES NOT SET IT: a real runner has pipes
 * and uses the default path, so CI exercises the configuration this project actually ships.
 * Locally it is set by hand:
 *
 *   STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH= NEXT_SKIP_TYPECHECK=1 NEXT_WORKER_THREADS=1 npm run build
 */
const WORKER_THREADS = process.env.NEXT_WORKER_THREADS === '1';

/** Where the browser's `/api/*` requests are forwarded, in the modes that have a server. */
const API_TARGET = process.env.VAULT_API ?? 'http://127.0.0.1:8787';
const CHAIN_RPC = process.env.VAULT_RPC ?? 'http://127.0.0.1:8545';

const shared: NextConfig = {
  reactStrictMode: true,
  ...(SKIP_TYPECHECK ? { typescript: { ignoreBuildErrors: true } } : {}),
  ...(WORKER_THREADS ? { experimental: { workerThreads: true } } : {}),
  // Written into the bundle by Next at build time. The client config loader joins it to the
  // path of the generated config, so one build works at a domain root and under a project
  // subpath without a second code path.
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
};

const nextConfig: NextConfig = STATIC_EXPORT
  ? {
      ...shared,
      output: 'export',
      basePath: BASE_PATH === '' ? undefined : BASE_PATH,
      // `vault/index.html` rather than `vault.html`: a static host resolves a directory to its
      // index file without configuration, and `/vault` then works whether or not the host
      // guesses extensions.
      trailingSlash: true,
      // The export has no image optimiser behind it.
      images: { unoptimized: true },
    }
  : {
      ...shared,
      async rewrites() {
        return [
          // `:path*` so query strings and any future endpoint come along. Listing endpoints one
          // by one would mean a new endpoint silently 404s in the console until someone
          // remembers to add it here.
          { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
          // The chain is proxied too, for the same reason the wallet dApp proxies it: the page
          // must not depend on the RPC endpoint permitting this origin.
          { source: '/rpc', destination: CHAIN_RPC },
        ];
      },
    };

export default nextConfig;
