/**
 * The contract, checked against the service AS IT IS RIGHT NOW.
 *
 * WHY THIS IS SEPARATE FROM `contract.test.ts`
 *
 * `contract.test.ts` asserts the shape of fixtures captured from the service. It runs
 * anywhere, needs nothing running, and is part of `npm test`. That makes it fast, and it also
 * means it can only tell you the fixture and the types agree -- if the SERVICE changes, a
 * stale fixture keeps the pair in happy agreement with each other and with nobody else.
 *
 * This file closes that gap. It asks the live service for the same four endpoints and
 * re-derives the same expectations. Run it after any change to the service, and before
 * recording evidence for G-F3.
 *
 * It runs from the OUTSIDE, over HTTP, with no import from the console's own code. That is
 * deliberate: the console is a reader, and this test must be able to disagree with it. If it
 * imported `src/lib/types.ts` it would inherit whatever that file believes.
 *
 * WHEN THE SERVICE IS NOT RUNNING
 *
 * Every test is skipped with a loud message, and the file exits 0. A missing service is not a
 * contract violation, and failing here would make this file un-runnable in `npm test`. That is
 * why it is not part of `npm test` at all -- run it explicitly.
 *
 *   node --experimental-strip-types test/contract-live.test.ts
 *   VAULT_API=http://127.0.0.1:8787 node --experimental-strip-types test/contract-live.test.ts
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

const apiBase = (process.env.VAULT_API ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

/** Whether the service is up, resolved once before any test body runs. */
const reachable = await fetch(`${apiBase}/api/status`, { signal: AbortSignal.timeout(3000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!reachable) {
  console.log(
    `\n  SKIPPED: the index service is not answering at ${apiBase}.\n` +
      '  This file checks a live contract, so it needs a live service. Start it with\n' +
      '  `node --experimental-strip-types src/api/cli.ts` in ../erc4626-vault-dapp.\n' +
      '  Skipping is not a pass: nothing about the contract was verified.\n',
  );
}

const get = async (path: string): Promise<Record<string, unknown>> => {
  const res = await fetch(`${apiBase}${path}`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
};

/**
 * The service's field names, SORTED.
 *
 * `assert.deepEqual` on arrays compares order, and `Object.keys` returns insertion order --
 * which is the order the service happens to build its response object in, not a contract.
 * The expected lists below are `.sort()`ed for the same reason. (The first version was not,
 * and failed on `count` versus `coverage`: the list was right and the comparison was wrong.)
 */
const keysOf = (o: object) => Object.keys(o).sort();

describe('live contract', { skip: reachable ? false : 'index service not reachable' }, () => {
  it('/api/status has the fields `Status` declares', async () => {
    const body = await get('/api/status');
    assert.deepEqual(keysOf(body), [
      'asset', 'chainHeadAtLastRun', 'chainId', 'coverage', 'eventCount', 'eventsFromBlock',
      'healthy', 'lagBlocks', 'lastIndexedBlock', 'note', 'seriesFromBlock', 'snapshotCount',
      'staleSeconds', 'startBlock', 'updatedAt', 'vault',
    ].sort());
  });

  it('/api/price keeps amounts as strings, including one past 2^53', async () => {
    const body = await get('/api/price?limit=1');
    assert.deepEqual(keysOf(body), [
      'coverage', 'count', 'decimals', 'limit', 'maxLimit', 'note', 'series', 'seriesFromBlock',
    ].sort());
    const series = body.series as Array<Record<string, unknown>>;
    assert.ok(series.length > 0);
    const point = series[0]!;
    assert.equal(typeof point.totalAssets, 'string');
    assert.equal(typeof point.totalSupply, 'string');
    assert.ok(Number(point.totalSupply as string) > Number.MAX_SAFE_INTEGER);
    assert.equal(typeof point.price, 'string');
  });

  it('/api/candles returns decimal strings and ordered OHLC', async () => {
    const body = await get('/api/candles?bucket=60&limit=200');
    assert.deepEqual(keysOf(body), [
      'bucketSeconds', 'candles', 'count', 'coverage', 'decimals', 'limit', 'maxLimit',
      'note', 'pointsPulled', 'pointsSkipped', 'seriesFromBlock',
    ].sort());
    const candles = body.candles as Array<Record<string, unknown>>;
    assert.ok(candles.length > 0, 'the live service returned no candles; is the indexer caught up?');
    for (const c of candles) {
      // Decimal strings, NOT base units. `BigInt('1.1')` throws -- which is how this was found.
      for (const k of ['open', 'high', 'low', 'close']) {
        assert.match(c[k] as string, /^\d+(\.\d+)?$/, `${k} = ${JSON.stringify(c[k])} is not a decimal string`);
      }
    }
  });

  it('/api/summary uses `kinds`, the name this console originally got wrong', async () => {
    const body = await get('/api/summary');
    assert.deepEqual(keysOf(body), [
      'firstEventBlock', 'kinds', 'lastEventBlock', 'lastIndexedBlock', 'note', 'totalEvents', 'unknownKinds',
    ].sort());
    assert.equal(body.counts, undefined, 'the service has never sent `counts`; the type was fiction');
    assert.equal(body.totals, undefined, 'the service has never sent `totals`; the type was fiction');
    const kinds = body.kinds as Record<string, { count: number; assets: string }>;
    assert.ok(Object.keys(kinds).length > 0);
    for (const [name, entry] of Object.entries(kinds)) {
      assert.equal(typeof entry.count, 'number', `${name}.count`);
      assert.match(entry.assets, /^\d+$/, `${name}.assets must be a uint256 decimal string`);
    }
  });

  it('the flow identity holds against the chain: deposits - withdrawals + yield = totalAssets', async () => {
    // The corrected invariant. The naive "sum the categories" version gives a third number
    // (1,565,324,094 at the time of writing) and is wrong -- `YieldReported` is not an
    // addition to the vault, it is a statement about assets already in it.
    const summary = await get('/api/summary');
    const kinds = summary.kinds as Record<string, { assets: string }>;
    assert.ok(kinds.Deposit && kinds.Withdraw && kinds.YieldReported, `unexpected kinds: ${Object.keys(kinds).join(', ')}`);
    const flows = BigInt(kinds.Deposit.assets) - BigInt(kinds.Withdraw.assets) + BigInt(kinds.YieldReported.assets);

    // Read `totalAssets` off the price series, which is the same number the chain returned for
    // the latest indexed block -- but compare it to the CHAIN directly where that is possible.
    const price = await get('/api/price?limit=1');
    const series = price.series as Array<{ totalAssets: string; blockNumber: number }>;
    const last = series[series.length - 1]!;
    assert.equal(
      flows.toString(),
      last.totalAssets,
      `the flow identity (${flows}) disagrees with the indexed totalAssets (${last.totalAssets}) at block ${last.blockNumber}`,
    );
  });

  it('the asset decimals the console reads for display match every endpoint', async () => {
    // The page takes `assetDecimals` from a chain read. If the service disagrees, the two
    // halves of the same screen format the same number differently.
    for (const path of ['/api/price?limit=1', '/api/candles?bucket=60&limit=10']) {
      const body = await get(path);
      const decimals = body.decimals as { asset: number; share: number };
      assert.equal(typeof decimals.asset, 'number', `${path} decimals.asset`);
      assert.equal(typeof decimals.share, 'number', `${path} decimals.share`);
      assert.ok(decimals.share > decimals.asset, `${path}: share decimals should exceed asset decimals`);
    }
  });
});
