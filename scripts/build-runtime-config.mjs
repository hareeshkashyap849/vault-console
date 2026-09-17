/**
 * Write the runtime config the browser reads: `public/api/config`.
 *
 * WHY A GENERATED FILE AND NOT `next.config.ts`
 *
 * The console WAS a Next.js app with server components: the deployment record was read per request
 * by `src/lib/deployment.ts` (since deleted -- a module that reads the record per request
 * contradicts the architecture), the index service was reached through a rewrite, and the chain's
 * identity was inlined at build time through `NEXT_PUBLIC_*`. All three need a server existing at
 * request time, and the published console has none. Written in the past tense on purpose:
 * `docs/STATIC-EXPORT-MIGRATION.md` recorded this header as still speaking in the present tense
 * about a module that no longer exists.
 *
 * A static export has no server. So the same facts are written to a file that the browser
 * fetches, and the pages are client components that read it. The record stays the single
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
 * WHY THERE IS ALSO `indexSnapshot`
 *
 * `indexApiUrl` alone cannot say WHERE the answers come from, and on the published console they
 * no longer come from a running service: the build captures the service's own responses into
 * `public/api/` and the static host serves those files at the same paths
 * (`scripts/capture-index-snapshot.mjs`, and the Pages workflow's step that runs it). So the
 * config carries `indexSnapshot`, and the pages label the source accordingly -- "a snapshot of the
 * index service, taken when this page was published" instead of "the index service, which lags by
 * design". Those are different claims about the same figures and a reader must not have to infer
 * which one holds. `--snapshot` sets it; it defaults to FALSE, because a config that claimed a
 * snapshot without one having been taken would be the console inventing a provenance.
 *
 * Usage:
 *   node scripts/build-runtime-config.mjs                       # dev defaults
 *   node scripts/build-runtime-config.mjs \
 *     --record deployments/base-sepolia.json \
 *     --rpc https://sepolia.base.org \
 *     --index null \
 *     --out public/api/config
 *   node scripts/build-runtime-config.mjs --index / --snapshot  # the published console
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

/**
 * Whether the index answers this build reads are a SNAPSHOT taken during the build.
 *
 * Default false. `--snapshot` (bare flag) or `--snapshot true` sets it. It is not derived from
 * `--index`: a path or URL says where the answers are, and both a live service and a directory of
 * captured files answer at such a path. Only the build knows which it just produced, so the build
 * has to say.
 */
const snapshotFlags = process.argv.filter((arg) => arg === '--snapshot').length;
if (snapshotFlags > 1) {
  console.error('--snapshot was given more than once. A build is either a snapshot or it is not.');
  process.exit(2);
}
const snapshotIndex = process.argv.indexOf('--snapshot');
const snapshotValue = snapshotIndex === -1 ? false : (process.argv[snapshotIndex + 1] ?? 'true');
const indexSnapshot = snapshotValue === true || snapshotValue === 'true';

if (snapshotIndex !== -1 && !indexSnapshot && snapshotValue !== 'false') {
  console.error(`--snapshot must be true or false (or a bare flag), got ${JSON.stringify(snapshotValue)}`);
  process.exit(2);
}

// A SNAPSHOT NEEDS SOMEWHERE TO HAVE COME FROM. With `indexApiUrl: null` the client makes no
// request at all, so `indexSnapshot: true` would be a provenance claim about figures nothing can
// reach -- the pages would say "read from a snapshot" and then show the no-route message. Refused
// rather than downgraded silently: whichever of the two flags is wrong, a person meant something
// and a quiet fallback would hide which.
if (indexSnapshot && indexApiUrl === null) {
  console.error(
    '--snapshot was passed together with --index null, which is a contradiction:\n' +
      '  a snapshot is served at the paths the console fetches, so the config must point at them.\n' +
      '  Pass --index / (the published export) or drop --snapshot.',
  );
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
  // Where the index answers come from: a running service (false) or files captured by the build
  // (true). The pages change one label on it and nothing else -- see `src/lib/runtimeConfig.ts`.
  indexSnapshot,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

// Re-read and compare. A generator that reports success without checking its own output is
// a generator that reports success.
//
// `indexSnapshot` is compared here, and that is the point of it being in this list: the artifact
// on disk is the only thing the browser ever sees, so the flag must be read back OUT of the file
// rather than trusted from the variable that wrote it. A build cannot then disagree with the
// artifact it produced.
const written = JSON.parse(readFileSync(outPath, 'utf8'));
const mismatches = ['chainId', 'vault', 'asset', 'deployBlock', 'indexSnapshot'].filter((f) => written[f] !== config[f]);
if (mismatches.length) {
  console.error(`the written config disagrees with the record on: ${mismatches.join(', ')}`);
  process.exit(1);
}

console.log(`record        ${recordPath}`);
console.log(`chain         ${config.chainId} (${config.chainName})`);
console.log(`vault         ${config.vault}`);
console.log(`reads go to   ${config.rpcUrl}`);
console.log(`index service ${config.indexApiUrl ?? '(none: panels will say there is no route)'}`);
console.log(
  `index answers ${config.indexSnapshot ? 'a SNAPSHOT captured by this build (the panels say so)' : 'a running service (live)'}`,
);
console.log(`written       ${outPath}`);
