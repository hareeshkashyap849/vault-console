/**
 * Write the runtime config the browser reads: `public/api/config`.
 *
 * WHY A GENERATED FILE AND NOT `next.config.ts`
 *
 * The console is a Next.js app with server components. In that shape the deployment record
 * is read per request (`src/lib/deployment.ts`), the index service is reached through a
 * rewrite, and the chain's identity is inlined at build time through `NEXT_PUBLIC_*`. All
 * three depend on a server existing at request time.
 *
 * A static export has no server. So the same facts are written to a file that the browser
 * fetches, and the pages become client components that read it. The record stays the single
 * source: this script reads `deployments/<chain>.json` and writes what the record says, and
 * it re-reads its own output and compares before reporting success.
 *
 * WHY THREE ENDPOINTS AND NOT ONE
 *
 *   rpcUrl        where the BROWSER reads the chain. Must be absolute: a browser cannot be
 *                 handed a path when the wallet also needs the URL, and on a static host
 *                 there is no proxy to make a path mean anything.
 *   walletRpcUrl  what `wallet_addEthereumChain` is told. Always the record's own endpoint.
 *   indexApiUrl   the index service, or NULL when the page has no route to one. Null is a
 *                 deliberate value, not a missing one: the panels then say the service is
 *                 not reachable from this host instead of blaming a service they never
 *                 asked -- the same distinction the dApp's `candlesUrl` makes.
 *
 * In development `indexApiUrl` is `/`, which `next.config.ts` rewrites to the service (same-origin,
 * so the service keeps refusing cross-origin requests, as designed). The static build passes
 * `--index null`.
 *
 * Usage:
 *   node scripts/build-runtime-config.mjs                       # dev defaults
 *   node scripts/build-runtime-config.mjs \
 *     --record deployments/base-sepolia.json \
 *     --rpc https://sepolia.base.org \
 *     --index null \
 *     --out public/api/config
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const recordPath = resolve(REPO, flag('--record', '../erc4626-vault/deployments/local.json'));
const outPath = resolve(REPO, flag('--out', 'public/api/config'));
const indexFlag = flag('--index', '/');

if (!existsSync(recordPath)) {
  console.error(
    `no deployment record at ${recordPath}\n` +
      'The record is written by the vault repository when the contract is deployed:\n' +
      '  cd ../erc4626-vault && powershell -File scripts/dev-chain.ps1\n' +
      'A config generated without one would address no contract, so this stops here.',
  );
  process.exit(2);
}

const record = JSON.parse(readFileSync(recordPath, 'utf8'));

const problems = [];
if (!/^0x[0-9a-fA-F]{40}$/.test(record.vault ?? '')) problems.push(`vault is not an address: ${record.vault}`);
if (!/^0x[0-9a-fA-F]{40}$/.test(record.asset ?? '')) problems.push(`asset is not an address: ${record.asset}`);
if (!Number.isInteger(record.chainId)) problems.push(`chainId is not an integer: ${record.chainId}`);
if (!Number.isInteger(record.deployBlock)) problems.push(`deployBlock is not a block number: ${record.deployBlock}`);
if (problems.length) {
  console.error(`${recordPath} is not usable as a deployment record:\n  - ${problems.join('\n  - ')}`);
  process.exit(2);
}

const rpcUrl = flag('--rpc', record.rpcUrl ?? record.walletRpcUrl);
if (!/^https?:\/\//.test(rpcUrl ?? '')) {
  console.error(`the read endpoint must be an absolute http(s) URL, got ${JSON.stringify(rpcUrl)}. Pass --rpc <url>.`);
  process.exit(2);
}

// `--index null` (the literal string) means "no route to an index service". Anything else
// must be an absolute URL or a page-relative path starting with a slash.
const indexApiUrl = indexFlag === 'null' || indexFlag === '' ? null : String(indexFlag);
if (indexApiUrl !== null && !/^(https?:\/\/|\/)/.test(indexApiUrl)) {
  console.error(`--index must be null, an absolute URL, or a path starting with /, got ${JSON.stringify(indexApiUrl)}`);
  process.exit(2);
}

const config = {
  // The record's own fields, minus the ABI: the console reads the chain through viem with
  // function signatures, so the artifact's ABI would be dead weight in a file the browser
  // downloads on every load.
  chainId: record.chainId,
  chainName: record.chainName ?? `Chain ${record.chainId}`,
  vault: record.vault,
  asset: record.asset,
  owner: record.owner ?? null,
  deployBlock: record.deployBlock,
  // The record's own note, passed through unchanged. It is where a deployment says what it is
  // ("testnet only: no real funds, not audited"), and the landing page shows it verbatim rather
  // than paraphrasing a statement about risk.
  note: record.note ?? null,
  recordPath: recordPath.startsWith(REPO) ? recordPath.slice(REPO.length + 1).replace(/\\/g, '/') : recordPath,
  rpcUrl,
  walletRpcUrl: record.walletRpcUrl ?? record.rpcUrl ?? rpcUrl,
  indexApiUrl,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

// Re-read and compare. A generator that reports success without checking its own output is
// a generator that reports success.
const written = JSON.parse(readFileSync(outPath, 'utf8'));
const mismatches = ['chainId', 'vault', 'asset', 'deployBlock'].filter((f) => written[f] !== config[f]);
if (mismatches.length) {
  console.error(`the written config disagrees with the record on: ${mismatches.join(', ')}`);
  process.exit(1);
}

console.log(`record        ${recordPath}`);
console.log(`chain         ${config.chainId} (${config.chainName})`);
console.log(`vault         ${config.vault}`);
console.log(`reads go to   ${config.rpcUrl}`);
console.log(`index service ${config.indexApiUrl ?? '(none: panels will say there is no route)'}`);
console.log(`written       ${outPath}`);
