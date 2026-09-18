/**
 * Verify a PUBLISHED console's index snapshot, over HTTP, exactly as a browser reads it.
 *
 * WHY THIS IS A TOOL AND NOT A COMMAND TYPED ONCE
 *
 * The snapshot the Pages workflow publishes is five files that must be served at five paths with
 * five shapes. Every way that can go wrong is silent on the page:
 *
 *   a file written one directory too high   -> the panels report the service as unreachable
 *   a file that slipped outside `public/`   -> 404, same symptom
 *   an empty or partial body                -> dashes and empty tables, which look like an empty
 *                                              index rather than like a broken build
 *   a config without `indexSnapshot`        -> the page tells the reader its figures are live
 *
 * The candle file earns its place in this list twice over: it is the path whose absence produced
 * exactly the second symptom -- a 404 the `Then` panel reported as a failed index read, while the
 * `Index health` panel beside it was fully populated (`docs/INDEX-SNAPSHOT-PLAN.md`). The page
 * contradicts itself in a way no build error announces, so this tool asserts the path like the
 * other four.
 *
 * None of those is a build error, and the last one is the honesty bug this whole change exists to
 * prevent. So it is checked from OUTSIDE, over HTTP, against a directory served as plain files --
 * which is the only place the base path, the file names and the query strings are all in play at
 * once.
 *
 * WHAT IT DOES NOT DO: it does not recompute anything. The bodies are checked with
 * `checkBody` FROM `scripts/capture-index-snapshot.mjs` -- the same function the capture refuses
 * on. A second validator here would be a second definition of "valid snapshot", and the two would
 * agree until one of them was edited, which is the failure this project keeps writing down.
 *
 * Usage:
 *   node tools/check-published-snapshot.mjs --base http://127.0.0.1:8123
 *   node tools/check-published-snapshot.mjs --base https://wuzilin-web3.github.io/vault-console
 *
 * Exit 0 only if every check passed. `--expect-deposit-block` defaults to the real Base Sepolia
 * `Deposit`, which is the one row that proves the snapshot came from the chain rather than from an
 * empty database.
 */
import { strict as assert } from 'node:assert';

import { ENDPOINTS, checkBody } from '../scripts/capture-index-snapshot.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const base = (flag('--base', 'http://127.0.0.1:8123') ?? '').replace(/\/+$/, '');
/** Block of the vault's one real Deposit on Base Sepolia. See the plan's "what is not fixed". */
const depositBlock = Number(flag('--expect-deposit-block', '46919498'));
const expectVault = flag('--expect-vault', '0x7941438ee07bea4469ccd4bec583e9fb24037f35');
const expectChain = Number(flag('--expect-chain', '84532'));

const problems = [];
let checks = 0;

function check(ok, description, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  ok    ${description}${detail ? ` -- ${detail}` : ''}`);
  } else {
    console.log(`  FAIL  ${description}${detail ? ` -- ${detail}` : ''}`);
    problems.push(description);
  }
}

async function get(path) {
  const url = `${base}${path}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  return { url, res, text };
}

/**
 * `get`, with a transport failure turned into a REPORT rather than a crash.
 *
 * A base URL with nothing behind it is the single most likely way to run this tool -- the static
 * server was not started, or the port is wrong -- and a stack trace from undici's `fetch` says
 * nothing about which server the caller expected. Every check then fails with the URL attached,
 * and the verdict at the bottom names the base.
 */
async function getOrReport(path) {
  try {
    return await get(path);
  } catch (cause) {
    return { url: `${base}${path}`, res: null, text: '', failure: cause instanceof Error ? cause.message : String(cause) };
  }
}

console.log(`checking the published snapshot at ${base}`);
console.log('(the same five paths the console fetches, plus the runtime config)\n');

// ---- the five snapshot files, at the paths the console requests -------------------------------

const bodies = {};

for (const endpoint of ENDPOINTS) {
  // The QUERY STRING IS PART OF THE REQUEST, on purpose: the console asks for
  // `/api/events?limit=50`, and a static host has to serve the file anyway. A host that treats the
  // query as part of the path would 404 here, and the page would too.
  const { res, text, failure } = await getOrReport(endpoint.path);
  if (failure !== undefined) {
    check(false, `${endpoint.path} could be reached`, `${base}${endpoint.path}: ${failure}`);
    continue;
  }
  check(res.status === 200, `${endpoint.path} answers 200`, `got ${res.status}`);

  let body;
  try {
    body = JSON.parse(text);
    check(true, `${endpoint.path} is JSON`, `${text.length} bytes`);
  } catch (cause) {
    check(false, `${endpoint.path} is JSON`, cause instanceof Error ? cause.message : String(cause));
    continue;
  }

  // THE SAME VALIDATOR THE CAPTURE REFUSES ON. If this fails, the capture should have refused.
  const found = checkBody(endpoint.name, body);
  check(found.length === 0, `${endpoint.name} carries every field the pages read`, found.join(' | '));
  bodies[endpoint.name] = body;
}

// ---- and the facts that make the snapshot REAL rather than merely well-formed -----------------

if (bodies.events) {
  const events = bodies.events.events ?? [];
  const deposit = events.find((event) => event.blockNumber === depositBlock && event.kind === 'Deposit');
  check(
    deposit !== undefined,
    `events holds the real Deposit at block ${depositBlock}`,
    deposit ? `kind=${deposit.kind} logIndex=${deposit.logIndex}` : `kinds present: ${events.map((e) => e.kind).join(', ') || '(none)'}`,
  );
  check(
    typeof deposit?.txHash === 'string' && /^0x[0-9a-f]{64}$/.test(deposit.txHash),
    'that Deposit carries a transaction hash',
    deposit?.txHash ?? '(no deposit)',
  );
  check(bodies.events.filter?.kind === null, 'the events envelope echoes "not filtered"');
}

if (bodies.status) {
  check(typeof bodies.status.updatedAt === 'string', 'status carries updatedAt, so the snapshot has a stateable age', String(bodies.status.updatedAt));
  check(Number.isInteger(bodies.status.staleSeconds), 'status carries staleSeconds', `${bodies.status.staleSeconds}s`);
  check(
    typeof bodies.status.note === 'string' && /snapshot/i.test(bodies.status.note),
    'status.note says the figures are a snapshot (the page prints this verbatim)',
  );
  check(bodies.status.chainId === expectChain, `status reports chain ${expectChain}`, String(bodies.status.chainId));
  check(bodies.status.vault === expectVault, 'status reports the deployed vault', String(bodies.status.vault));
}

if (bodies.summary) {
  // The tally the page reconciles against its own rows. A `counts`/`totals` envelope here would be
  // the shape `SummaryResponse` was first written with, and nothing would throw.
  check(typeof bodies.summary.totalEvents === 'number', 'summary carries totalEvents', String(bodies.summary.totalEvents));
  check(bodies.summary.kinds !== undefined && bodies.summary.counts === undefined, 'summary uses `kinds`, not the invented `counts`');
}

if (bodies.price) {
  check(bodies.price.series?.length > 0, 'the price series is not empty', `${bodies.price.series?.length} point(s)`);
  check(
    Number.isInteger(bodies.price.decimals?.asset) && Number.isInteger(bodies.price.decimals?.share),
    'price reports both decimal counts, so amounts are formatted rather than shown raw',
    `asset=${bodies.price.decimals?.asset} share=${bodies.price.decimals?.share}`,
  );
}

if (bodies.candles) {
  // THE PANEL THIS PATH EXISTS FOR. `/vault`'s `Then` panel asks the service for
  // `/api/candles?bucket=60&limit=5000`; while the capture wrote four files, a static host answered
  // 404 here and the panel printed "The index service could not be read." under a label saying the
  // figures were a snapshot, beside a fully populated `Index health` panel.
  //
  // This file used to fetch that path only to print its status as a `note`, because a check would
  // have made the tool red for a known reason. That trial is not kept alongside the real check: the
  // path is one of `ENDPOINTS` now, so the loop above fetches exactly this URL, requires 200,
  // requires JSON and runs `checkBody` over it -- three of the checks in the count below. A second,
  // weaker statement of the same fact would be two places deciding whether candles is published.
  //
  // These three checks are the facts that make the FILE worth having rather than merely
  // well-formed, and the count is printed because a 200 holding `"candles": []` passes every shape
  // check and still draws no chart.
  const candles = bodies.candles.candles ?? [];
  check(
    candles.length > 0,
    'the candle series the chart draws is not empty',
    // `checkBody` has already refused a body whose candles are not integers here and reported it;
    // this sums defensively so the line prints a number either way rather than `NaN`.
    `${candles.length} candle(s), ${candles.reduce((total, candle) => total + (Number.isInteger(candle?.points) ? candle.points : 0), 0)} block(s)`,
  );
  check(
    // The panel's own axis label prints the bucket width it was constructed with (`bucketSeconds={60}`
    // in `src/app/vault/page.tsx`), so a body bucketed some other way would make that label describe
    // a chart it is not.
    bodies.candles.bucketSeconds === 60,
    'the candles are bucketed by the 60 seconds the panel labels its axis with',
    `${bodies.candles.bucketSeconds}s`,
  );
  if (bodies.price) {
    check(
      // One series, one snapshot: `/history`'s price table and `/vault`'s chart are two views of
      // the same rows, and both endpoints report the block the series starts at. A file copied from
      // an older run would agree with the schema and disagree here.
      bodies.candles.seriesFromBlock === bodies.price.seriesFromBlock,
      'the candle file and the price file start at the same block -- one series, one snapshot',
      `candles=${bodies.candles.seriesFromBlock} price=${bodies.price.seriesFromBlock}`,
    );
  }
}

// ---- the runtime config, which is what tells the page it is a snapshot ------------------------

try {
  const { res, text, failure } = await getOrReport('/api/config');
  if (failure !== undefined) {
    check(false, '/api/config could be reached', `${base}/api/config: ${failure}`);
  } else {
    check(res.status === 200, '/api/config answers 200', `got ${res.status}`);
    const config = JSON.parse(text);
    check(config.chainId === expectChain, `config names chain ${expectChain}`, String(config.chainId));
    check(config.vault === expectVault, 'config names the right vault', String(config.vault));
    check(/^0x[0-9a-fA-F]{40}$/.test(config.asset ?? ''), 'config names the asset', String(config.asset));
    check(/^https?:\/\//.test(config.rpcUrl ?? ''), 'config names an absolute RPC endpoint', String(config.rpcUrl));
    // THE ONE THAT MATTERS MOST FOR THIS CHANGE. False here means the published pages tell the
    // reader their figures are live, and no other check in this file would notice.
    check(config.indexSnapshot === true, 'config says the index answers are a SNAPSHOT', String(config.indexSnapshot));
    check(config.indexApiUrl !== null, 'config points at the captured files rather than saying there is no route', String(config.indexApiUrl));
  }
} catch (cause) {
  check(false, '/api/config is JSON', cause instanceof Error ? cause.message : String(cause));
}

// ---- verdict ----------------------------------------------------------------------------------

console.log('');
if (problems.length > 0) {
  console.error(`${problems.length} of ${checks} check(s) FAILED:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`all ${checks} checks passed against ${base}`);
assert.ok(true);
