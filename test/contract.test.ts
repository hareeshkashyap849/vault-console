/**
 * The contract between this console and the index service.
 *
 * WHY: THE TYPE IN `src/lib/types.ts` WAS WRONG AND NOTHING NOTICED
 *
 * `SummaryResponse` declared `counts` and `totals`. The service answers with `kinds` and
 * `totalEvents`. `tsc` compiled cleanly, because a wrong type is still a type -- it just
 * describes something nobody sends. Nothing called `indexApi.summary()`, so there was no
 * runtime disagreement either. A front end whose types are fiction is worse than one with
 * no types: it reads as verified.
 *
 * WHAT THIS FILE DOES ABOUT IT, IN TWO PARTS
 *
 *   1. `fixtures/` holds responses CAPTURED VERBATIM from the running service by
 *      `tools/capture-fixtures.mjs`. The shape assertions run against those, so this test
 *      needs no service and runs anywhere.
 *   2. `contract-live.test.ts` re-derives the same expectations from the service as it is
 *      right now, and fails when the two disagree. That is the part that catches drift;
 *      this part catches a fixture that was edited by hand to match broken code.
 *
 * A note on which is authoritative: THE SERVICE IS. The console is a reader. If these
 * tests and the service disagree, the console is what changes.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseAmount } from '../src/lib/format.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const load = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, unknown>;

/** Assert `obj` has exactly these keys: no missing field, and no invented one. */
function assertKeys(obj: Record<string, unknown>, expected: string[], label: string) {
  const actual = Object.keys(obj).sort();
  assert.deepEqual(
    actual,
    [...expected].sort(),
    `${label} fields changed. Actual: ${actual.join(', ')}. Expected: ${[...expected].sort().join(', ')}`,
  );
}

describe('fixture: /api/status', () => {
  const body = load('status.json');

  it('has exactly the fields the console reads, and no others', () => {
    assertKeys(body, [
      'healthy',
      'chainId',
      'vault',
      'asset',
      'startBlock',
      'lastIndexedBlock',
      'chainHeadAtLastRun',
      'lagBlocks',
      'eventCount',
      'snapshotCount',
      'seriesFromBlock',
      'eventsFromBlock',
      'coverage',
      'updatedAt',
      'staleSeconds',
      'note',
    ], 'Status');
  });

  it('types each field the way `Status` declares it', () => {
    assert.equal(typeof body.healthy, 'boolean');
    assert.equal(typeof body.chainId, 'number');
    assert.equal(typeof body.vault, 'string');
    assert.equal(typeof body.eventCount, 'number');
    assert.equal(typeof body.snapshotCount, 'number');
    assert.equal(typeof body.note, 'string');
    assert.equal(typeof body.updatedAt, 'string');
    assert.equal(typeof body.lagBlocks, 'number');
    // Nullable on purpose: a service that has never indexed a block reports null rather
    // than 0, and 0 would read as "indexed to block 0".
    assert.ok(body.lastIndexedBlock === null || typeof body.lastIndexedBlock === 'number');
  });

  it('carries a coverage object whose note is printed verbatim on the page', () => {
    const coverage = body.coverage as Record<string, unknown>;
    assertKeys(coverage, [
      'vaultStartBlock',
      'seriesFromBlock',
      'eventsFromBlock',
      'coverageBeginsAt',
      'startsLaterThanDeployment',
      'note',
    ], 'Coverage');
    assert.equal(typeof coverage.note, 'string');
    assert.ok((coverage.note as string).length > 0, 'the gap must be stated, not implied');
  });

  it('reports the gap honestly: the series starts later than the deployment', () => {
    // The live vault deployed at block 8 and the series begins at 168. The console shows
    // the service's own sentence about this rather than paraphrasing it into "no activity".
    const coverage = body.coverage as Record<string, unknown>;
    assert.equal(coverage.startsLaterThanDeployment, true);
    assert.ok((coverage.seriesFromBlock as number) > (coverage.vaultStartBlock as number));
    assert.match(coverage.note as string, /NOT a period of zero activity/);
  });
});

describe('fixture: /api/price', () => {
  const body = load('price.json');

  it('has exactly the declared fields', () => {
    assertKeys(body, ['series', 'decimals', 'count', 'limit', 'maxLimit', 'seriesFromBlock', 'coverage', 'note'], 'PriceResponse');
    assertKeys(body.decimals as Record<string, unknown>, ['asset', 'share'], 'price.decimals');
  });

  it('keeps every amount a STRING, including the one that overflows a double', () => {
    const series = body.series as Array<Record<string, unknown>>;
    assert.ok(series.length > 0, 'the fixture must contain at least one point');
    for (const point of series) {
      assert.equal(typeof point.totalAssets, 'string', 'totalAssets must survive as a string');
      assert.equal(typeof point.totalSupply, 'string', 'totalSupply must survive as a string');
      assert.equal(typeof point.blockNumber, 'number');
      assert.equal(typeof point.timestamp, 'number');
    }
    const supply = series[0]!.totalSupply as string;
    assert.ok(Number(supply) > Number.MAX_SAFE_INTEGER, `the fixture should exercise past 2^53, got ${supply}`);
    assert.notEqual(String(Number(supply)), supply, 'this value must be one a double cannot hold');
  });

  it('documents that price is derived on read, not stored', () => {
    assert.match(body.note as string, /DERIVED ON READ/);
  });
});

describe('fixture: /api/candles', () => {
  const body = load('candles.json');

  it('has exactly the declared fields', () => {
    assertKeys(body, [
      'candles',
      'decimals',
      'count',
      'pointsPulled',
      'pointsSkipped',
      'bucketSeconds',
      'limit',
      'maxLimit',
      'seriesFromBlock',
      'coverage',
      'note',
    ], 'CandleResponse');
  });

  it('gives every candle eight fields, all of the declared type', () => {
    const candles = body.candles as Array<Record<string, unknown>>;
    assert.ok(candles.length > 0, 'the fixture must contain at least one candle');
    for (const c of candles) {
      assertKeys(
        c,
        ['startsAt', 'endsAt', 'open', 'high', 'low', 'close', 'points', 'firstBlock', 'lastBlock'],
        'Candle',
      );
      assert.equal(typeof c.startsAt, 'number');
      assert.equal(typeof c.endsAt, 'number');
      for (const k of ['open', 'high', 'low', 'close']) {
        assert.equal(typeof c[k], 'string', `${k} must be a decimal string`);
      }
      assert.equal(typeof c.points, 'number');
      assert.equal(typeof c.firstBlock, 'number');
      assert.equal(typeof c.lastBlock, 'number');
    }
  });

  it('keeps OHLC ordered: low <= open,close <= high', () => {
    // The service claims to aggregate in exact integers so a high cannot be reported that
    // the vault never had. That claim is checkable, and this checks it.
    //
    // The values are DECIMAL strings ("1.1"), not uint256 base units -- the candle endpoint
    // formats them for display. So they are converted through `parseAmount`, which is the
    // console's own exact conversion, rather than through `BigInt()` (which throws on a
    // decimal point) or `Number()` (which would defeat the point of the check).
    //
    // This assertion was originally written with `BigInt(v)` and threw
    // `SyntaxError: Cannot convert 1.1 to a BigInt` on the first run. Worth recording: the
    // contract test caught its own author's wrong assumption about the format.
    for (const c of body.candles as Array<Record<string, unknown>>) {
      const o = parseAmount(c.open as string, 6);
      const h = parseAmount(c.high as string, 6);
      const l = parseAmount(c.low as string, 6);
      const cl = parseAmount(c.close as string, 6);
      assert.ok(l <= o && o <= h, `open outside [low, high]: ${c.open} in ${c.low}..${c.high}`);
      assert.ok(l <= cl && cl <= h, `close outside [low, high]: ${c.close} in ${c.low}..${c.high}`);
    }
  });

  it('every candle in the captured window is flat at 1.1 -- the reason the chart guard exists', () => {
    // 169 candles, one distinct price string. If this ever stops being true the chart's
    // flat-series guard stops being exercised by the live data, and the fixture should be
    // recaptured from a vault that has moved.
    const prices = new Set(
      (body.candles as Array<Record<string, unknown>>).flatMap((c) => [c.open, c.high, c.low, c.close] as string[]),
    );
    assert.deepEqual([...prices], ['1.1']);
  });

  it('explains that `limit` is blocks pulled, not candles returned', () => {
    // The console passes limit=5000 and asks for 60-second buckets, and gets 169 candles.
    // Anyone reading `limit` as a candle count would think the response was truncated.
    assert.match(body.note as string, /BLOCKS PULLED, not candles returned/);
    assert.ok((body.pointsPulled as number) > (body.count as number) || (body.count as number) === 1);
  });
});

describe('fixture: /api/summary', () => {
  const body = load('summary.json');

  it('has exactly the declared fields -- the ones this console originally got wrong', () => {
    // The first version of `SummaryResponse` declared `counts` and `totals`. It was wrong,
    // and nothing caught it because nothing called it. This is the assertion that would
    // have caught it.
    assertKeys(body, ['kinds', 'totalEvents', 'firstEventBlock', 'lastEventBlock', 'lastIndexedBlock', 'unknownKinds', 'note'], 'SummaryResponse');
    assert.equal(body.counts, undefined, 'the service does not send `counts`');
    assert.equal(body.totals, undefined, 'the service does not send `totals`');
  });

  it('keys event kinds by name, each with a count and an exact asset sum', () => {
    const kinds = body.kinds as Record<string, Record<string, unknown>>;
    const names = Object.keys(kinds).sort();
    assert.deepEqual(names, ['Deposit', 'Withdraw', 'YieldReported']);
    for (const [name, entry] of Object.entries(kinds)) {
      assertKeys(entry, ['count', 'assets'], `kinds.${name}`);
      assert.equal(typeof entry.count, 'number');
      assert.equal(typeof entry.assets, 'string', `${name}.assets must be an exact string`);
      assert.match(entry.assets as string, /^\d+$/, `${name}.assets must be a uint256 decimal string`);
    }
  });

  it('totals the counts to totalEvents', () => {
    const kinds = body.kinds as Record<string, { count: number }>;
    const sum = Object.values(kinds).reduce((acc, k) => acc + k.count, 0);
    assert.equal(sum, body.totalEvents);
  });

  it('reconciles to the vault\'s total assets -- gross in, minus gross out, plus reported yield', () => {
    // THE CHECK THIS FILE EXISTS FOR, and the one that had to be corrected mid-authoring.
    //
    // The first version asserted that the per-kind sums add up to `totalAssets`. They do
    // not, and the service's own note says why: `YieldReported` carries an amount that was
    // already in the vault, not an addition to it. So the naive sum is 1,565,324,094 while
    // `totalAssets` is 934,924,100 -- three different quantities added together.
    //
    // The relationship that DOES hold is a flow reconciliation:
    //
    //     deposits - withdrawals + yield reported = totalAssets
    //     1200124097 - 315199997 + 50000000       = 934924100
    //
    // And `totalAssets` here is not a number this test invented: it is the vault's
    // on-chain `totalAssets()`, read by the chain and written into the price-series
    // fixture by an entirely different query. Two endpoints, one arithmetic identity.
    const kinds = body.kinds as Record<string, { assets: string }>;
    const deposits = BigInt(kinds.Deposit!.assets);
    const withdrawals = BigInt(kinds.Withdraw!.assets);
    const yieldReported = BigInt(kinds.YieldReported!.assets);

    assert.equal(deposits - withdrawals + yieldReported, 934_924_100n);

    const series = load('price.json').series as Array<{ totalAssets: string }>;
    const onChain = BigInt(series[series.length - 1]!.totalAssets);
    assert.equal(
      deposits - withdrawals + yieldReported,
      onChain,
      'the flow identity and the chain read must agree',
    );
  });

  it('the naive per-kind sum does NOT equal totalAssets, and the difference is the trap', () => {
    // Pinned deliberately, because "sum the categories" is the obvious thing to write and
    // it is wrong. If a future change makes this assertion fail, someone has changed what
    // `YieldReported` means -- which is a decision, not a detail.
    const kinds = body.kinds as Record<string, { assets: string }>;
    const naive = Object.values(kinds).reduce((acc, k) => acc + BigInt(k.assets), 0n);
    assert.equal(naive, 1_565_324_094n);
    assert.notEqual(naive, 934_924_100n);
  });

  it('has no unknown kinds, so the decoder covers every log the vault emits', () => {
    assert.deepEqual(body.unknownKinds, []);
  });
});

describe('fixture: /api/events', () => {
  /**
   * PROVENANCE, AND WHY THIS ONE IS A DIFFERENT CHAIN FROM THE OTHER FOUR.
   *
   * The four fixtures above are the local anvil deployment (chain 31337, vault
   * `0x9fE4...`), captured by `tools/capture-fixtures.mjs` against a developer service. This
   * one is the **committed Base Sepolia snapshot** (`data/vault.sqlite`, chain 84532), taken
   * from the service started against it -- the same service and the same database that produce
   * the published console's `public/api/events`. So the vault address and chainId here are
   * DIFFERENT from the four above, on purpose, and `cross-fixture consistency` below does not
   * include this file for that reason.
   *
   * It exists because `EventResponse` is the one interface in `src/lib/types.ts` that was
   * written from the route table's one-line description rather than from a response, and the
   * `filter` envelope was missing from it as a result. Asserting the envelope against a
   * captured response is the only way that class of error is visible without a live service.
   */
  const body = load('events.json');

  it('has exactly the envelope `EventResponse` declares -- including `filter`', () => {
    assertKeys(body, ['events', 'count', 'limit', 'maxLimit', 'filter'], 'EventResponse');
    assertKeys(body.filter as Record<string, unknown>, ['kind', 'account'], 'events.filter');
  });

  it('spells "not filtered" as null rather than by omitting the key', () => {
    // `null` is "no filter applied"; an absent key is neither that nor "filtered to nothing".
    const filter = body.filter as Record<string, unknown>;
    assert.equal(filter.kind, null);
    assert.equal(filter.account, null);
  });

  it('gives every event row the nine fields `VaultEvent` declares', () => {
    // The tx hash is the reason this table exists at all: it is what a reader checks against
    // a block explorer, so a row without one is not a row this page can show.
    const events = body.events as Array<Record<string, unknown>>;
    assert.ok(events.length > 0, 'the captured snapshot contains one real Deposit; an empty fixture would prove nothing');
    for (const event of events) {
      assertKeys(
        event,
        ['blockNumber', 'logIndex', 'blockHash', 'txHash', 'kind', 'account', 'assets', 'shares', 'timestamp'],
        'VaultEvent',
      );
      assert.equal(typeof event.blockNumber, 'number');
      assert.equal(typeof event.logIndex, 'number');
      assert.equal(typeof event.timestamp, 'number');
      assert.match(event.blockHash as string, /^0x[0-9a-f]{64}$/);
      assert.match(event.txHash as string, /^0x[0-9a-f]{64}$/);
      // Amounts are decimal strings, or null where the kind carries no amount. NEVER numbers:
      // `shares` here is 20000000000000000000, which a double would round.
      for (const key of ['assets', 'shares']) {
        const value = event[key];
        assert.ok(value === null || typeof value === 'string', `${key} must be a string or null, got ${typeof value}`);
        if (typeof value === 'string') assert.match(value, /^\d+$/, `${key} must be a uint256 decimal string`);
      }
      assert.ok(event.account === null || /^0x[0-9a-f]{40}$/.test(event.account as string));
    }
  });

  it('reports a count that matches the rows it actually sent', () => {
    assert.equal(body.count, (body.events as unknown[]).length);
    assert.equal(body.limit, 50, 'the console asks for 50 rows (EVENT_ROWS in src/app/history/page.tsx)');
    assert.ok((body.count as number) <= (body.limit as number));
  });
});

describe('cross-fixture consistency', () => {
  it('the same vault and chain appear in every fixture that names them', () => {
    const status = load('status.json');
    assert.equal(status.vault, '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0');
    assert.equal(status.asset, '0x5FbDB2315678afecb367f032d93F642f64180aa3');
    assert.equal(status.chainId, 31337);
  });

  it('the asset decimals agree across every fixture', () => {
    // A decimals disagreement between two endpoints is how a display bug is born.
    for (const name of ['price.json', 'candles.json']) {
      const decimals = load(name).decimals as Record<string, number>;
      assert.equal(decimals.asset, 6, `${name} disagrees about asset decimals`);
      assert.equal(decimals.share, 18, `${name} disagrees about share decimals`);
    }
  });

  it('the summary flow identity equals the price series\' last totalAssets', () => {
    // Two independent endpoints, two independent queries, one number -- and the identity
    // that relates them is the corrected one (see the reconciliation test above).
    const kinds = load('summary.json').kinds as Record<string, { assets: string }>;
    const flows = BigInt(kinds.Deposit!.assets) - BigInt(kinds.Withdraw!.assets) + BigInt(kinds.YieldReported!.assets);
    const series = load('price.json').series as Array<{ totalAssets: string }>;
    assert.equal(flows.toString(), series[series.length - 1]!.totalAssets);
  });
});
