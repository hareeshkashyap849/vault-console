/**
 * Capture the index service's responses verbatim into `test/fixtures/`.
 *
 * WHY CAPTURE INSTEAD OF WRITE
 *
 * Hand-written fixtures encode the author's misunderstanding twice -- once in the data and
 * once in the expectation -- and then agree with each other. That failure mode is not
 * hypothetical here: `SummaryResponse` in `src/lib/types.ts` declared `counts`/`totals`,
 * which the service has never sent. A hand-written fixture would have been written to match
 * the wrong interface and the contract test would have passed against it.
 *
 * So the fixtures are bytes the service actually produced. `test/contract.test.ts` asserts
 * their shape, and `test/contract-live.test.ts` re-derives the same expectations from the
 * running service, so a service change shows up as a failing test rather than as a console
 * that quietly reads the wrong field.
 *
 * Usage, with the index service and a chain both up:
 *
 *   node tools/capture-fixtures.mjs
 *   node tools/capture-fixtures.mjs --api http://127.0.0.1:8787
 *
 * It refuses to write a fixture that is not valid JSON, and it prints the byte counts and a
 * digest of each body so a diff in the commit is reviewable.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const apiFlag = args.indexOf('--api');
const apiBase = (apiFlag === -1 ? process.env.VAULT_API ?? 'http://127.0.0.1:8787' : args[apiFlag + 1]).replace(/\/$/, '');

/**
 * The endpoints, with the arguments the console itself uses. Capturing a different query
 * than the page sends would produce a fixture that describes a request nobody makes.
 */
const endpoints = [
  ['status.json', '/api/status'],
  ['price.json', '/api/price?limit=1'],
  ['candles.json', '/api/candles?bucket=60&limit=5000'],
  ['summary.json', '/api/summary'],
];

const outDir = resolve(import.meta.dirname, '..', 'test', 'fixtures');
mkdirSync(outDir, { recursive: true });

let failures = 0;

for (const [file, path] of endpoints) {
  const url = `${apiBase}${path}`;
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) {
      console.error(`FAIL ${path} -> HTTP ${res.status}`);
      console.error(`     ${text.slice(0, 300)}`);
      failures += 1;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      console.error(`FAIL ${path} -> not JSON: ${cause instanceof Error ? cause.message : cause}`);
      failures += 1;
      continue;
    }
    // Re-serialise with indentation so a fixture diff is readable in review. The VALUES are
    // the service's, byte for byte; only whitespace is ours.
    const body = `${JSON.stringify(parsed, null, 2)}\n`;
    writeFileSync(join(outDir, file), body, 'utf8');
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 12);
    console.log(`OK   ${file.padEnd(16)} ${String(body.length).padStart(7)} bytes  sha256:${sha}`);
  } catch (cause) {
    console.error(`FAIL ${path} -> ${cause instanceof Error ? cause.message : String(cause)}`);
    failures += 1;
  }
}

console.log(`\n${endpoints.length - failures}/${endpoints.length} fixtures captured into test/fixtures/`);
if (failures > 0) {
  console.error('Are the index service and the chain running? See README.md "Running it".');
  process.exit(1);
}
