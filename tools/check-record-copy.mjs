/**
 * Check that this repository's copy of the deployment record still matches the canonical one.
 *
 * THE FAILURE THIS PREVENTS, IN ONE SENTENCE: the console reads a vault address from a file, and if that
 * file says an address the canonical record no longer names, the console queries a contract that may not
 * exist -- `eth_call` to an empty address returns `0x`, viem decodes it as zero, and the page renders
 * "total assets: 0" as fact. Nothing errors. That is the exact failure `src/lib/deployment.ts` was written
 * to prevent, and a copy reintroduces it unless something compares the two.
 *
 * WHAT IT DOES ON A HOST WITH NO CANONICAL FILE: says so, and exits 0 -- a build on Vercel has no sibling
 * repository, and failing there would make the deployment impossible. The distinction it keeps is between
 * "the copy is correct" and "I could not check", and it never prints the first when it means the second.
 *
 * Usage (from this repository):
 *
 *   node tools/check-record-copy.mjs                     # against the default sibling path
 *   node tools/check-record-copy.mjs --from <path>
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const project = resolve(import.meta.dirname, '..');

const copyPath = resolve(project, flag('--copy', 'deployments/base-sepolia.json'));
if (!existsSync(copyPath)) {
  console.log(`no copy at ${copyPath}; nothing to compare (the console falls back to the sibling record)`);
  process.exit(0);
}

const fromPath = resolve(project, flag('--from', '../erc4626-vault/deployments/base-sepolia.json'));
if (!existsSync(fromPath)) {
  console.log('CANNOT CHECK: there is no canonical record beside this repository.');
  console.log(`  looked for ${fromPath}`);
  console.log('  This is the normal case on a host that only has this repository. The copy is what will be');
  console.log('  used; run this check on a machine that has both before deploying.');
  process.exit(0);
}

const copy = JSON.parse(readFileSync(copyPath, 'utf8'));
const canonical = JSON.parse(readFileSync(fromPath, 'utf8'));

/** The fields that decide whether the console reads the right contract. */
const WATCHED = ['chainId', 'vault', 'asset', 'deployBlock', 'owner', 'deployTxHash', 'sourceCommit'];

const differences = [];
for (const field of WATCHED) {
  const a = JSON.stringify(copy[field]);
  const b = JSON.stringify(canonical[field]);
  if (a !== b) differences.push({ field, copy: copy[field], canonical: canonical[field] });
}

console.log(`copy      ${copyPath}`);
console.log(`canonical ${fromPath}`);
console.log(`fields compared: ${WATCHED.join(', ')}\n`);

if (differences.length === 0) {
  console.log('the copy matches the canonical record on every field that decides which contract is read');
  process.exit(0);
}

console.log('DRIFT: the copy disagrees with the canonical record');
for (const d of differences) {
  console.log(`  ${d.field}`);
  console.log(`    copy      ${JSON.stringify(d.copy)}`);
  console.log(`    canonical ${JSON.stringify(d.canonical)}`);
}
console.log('\nRe-run `node tools/sync-deployment-record.mjs` from a machine with both repositories.');
process.exit(1);
