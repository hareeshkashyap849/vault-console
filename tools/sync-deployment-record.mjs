/**
 * Copy the canonical deployment record into this repository, for a host that has no sibling checkout.
 *
 * WHY A COPY EXISTS AT ALL, AND WHY IT IS MADE BY A SCRIPT
 *
 * `loadDeployment()` reads the record from `../erc4626-vault/deployments/<chain>.json`. That works on a
 * development machine, where the sibling repository is next to this one -- and it cannot work on Vercel,
 * where this repository is the whole filesystem. So a deployment needs a copy inside this repository, and
 * the copy is the thing the project's own rules are most suspicious of: a second copy of the vault
 * address is exactly how a console ends up reading an address with no contract on it and displaying
 * zeros as fact.
 *
 * Three things keep the copy from becoming a second source of truth:
 *
 *   1. It is COPIED, never edited. This script is the only thing that writes it, and it refuses to run
 *      without the canonical file present -- so a hand-edit is overwritten the next time anyone syncs,
 *      rather than quietly surviving.
 *   2. It carries its provenance: `sourceRecord` names the file it came from and `sourceCommit` the
 *      commit its bytecode was built from, so a reader can tell whether they are looking at a copy.
 *   3. `tools/check-record-copy.mjs` compares the two files field by field and fails when they differ,
 *      so drift is loud. On a host with no canonical file the check says it cannot verify rather than
 *      passing silently -- "I could not check" and "it is correct" are different sentences.
 *
 * Usage (from this repository):
 *
 *   node tools/sync-deployment-record.mjs --from ../erc4626-vault/deployments/base-sepolia.json
 *   node tools/sync-deployment-record.mjs --from <path> --out deployments/base-sepolia.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const from = flag('--from', '../erc4626-vault/deployments/base-sepolia.json');
const out = flag('--out', null);
const project = resolve(import.meta.dirname, '..');

const sourcePath = resolve(project, from);
if (!existsSync(sourcePath)) {
  console.error(`the canonical record is not at ${sourcePath}`);
  console.error('A copy made from nothing is a fabricated address. Point --from at the real record.');
  process.exit(1);
}

const record = JSON.parse(readFileSync(sourcePath, 'utf8'));

// The fields a copy must not lose. Checked here rather than trusted, because the console refuses to
// start without them and the failure would otherwise appear at build time on the host.
for (const field of ['chainId', 'vault', 'asset', 'deployBlock']) {
  if (record[field] === undefined) {
    console.error(`the canonical record has no "${field}"; refusing to copy a partial record`);
    process.exit(1);
  }
}

const target = resolve(out === null ? resolve(project, 'deployments/base-sepolia.json') : resolve(project, out));
const copied = {
  ...record,
  // Provenance, added by the copy rather than by the source: it describes the copy, so it belongs here.
  copiedFrom: relative(project, sourcePath).replace(/\\/g, '/'),
  note:
    `${record.note ?? ''} | COPIED into vault-console by tools/sync-deployment-record.mjs so a host with ` +
    'no sibling checkout can read it. Edit the canonical record, then re-run the sync.',
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(copied, null, 2)}\n`, 'utf8');

console.log(`copied ${sourcePath}`);
console.log(`    to ${target}`);
console.log(`  vault        ${copied.vault}`);
console.log(`  chain        ${copied.chainId}  (${copied.chainName ?? 'unnamed'})`);
console.log(`  deployBlock  ${copied.deployBlock}`);
console.log(`  sourceCommit ${copied.sourceCommit ?? 'not recorded'}`);
console.log('');
console.log('On the host set:  VAULT_DEPLOYMENT=deployments/base-sepolia.json');
