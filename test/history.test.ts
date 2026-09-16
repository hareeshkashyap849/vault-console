/**
 * The `/history` view's logic, against the shapes the running service actually returns.
 *
 * WHY EACH GROUP OF TESTS EXISTS, AND WHICH DEFECT IT IS AIMED AT
 *
 * A test that only re-states the implementation is worth nothing, so every case below names
 * the failure it distinguishes. The four this file is built around:
 *
 *   A DEFAULTED DECIMALS VALUE     6 and 18 are the common values, so a default looks
 *                                  harmless and renders a confident wrong number. The tests
 *                                  assert `null` explicitly rather than not-6-and-18, because
 *                                  a future default of 8 would still be wrong.
 *   `null` COLLAPSED INTO `"0"`    a yield report carries no share amount. "Zero shares
 *                                  moved" and "this event has no share figure" are
 *                                  different facts and the table must not conflate them.
 *   TRUSTED INPUT ORDER            the row order is a claim the page makes. Sorting on block
 *                                  number alone leaves same-block events in arrival order,
 *                                  so the test uses two events in one block.
 *   `slice(-0)`                    `[1,2,3].slice(-0)` is `slice(0)`, which is the WHOLE
 *                                  array. A `limit = 0` table that renders everything is
 *                                  the kind of bug that only shows up under load.
 *
 * THE AMOUNTS ARE THE VAULT'S REAL FIGURES, and the 18-decimal ones sit past
 * `Number.MAX_SAFE_INTEGER`. That is deliberate: `859021905704231281673` through a double
 * becomes `859.0219057042313` and the exact-string assertions below fail, which is the whole
 * point of using them rather than round numbers.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  amountCell,
  decimalsFrom,
  kindLabel,
  newestFirst,
  priceRows,
  tallyKinds,
  truncationLabel,
} from '../src/lib/history.ts';
import type { PricePoint, SummaryResponse, VaultEvent } from '../src/lib/types.ts';

/** The decimals the index service reports for this deployment. */
const DECIMALS = { asset: 6, share: 18 };

function event(over: Partial<VaultEvent> & { blockNumber: number; logIndex: number }): VaultEvent {
  return {
    blockHash: `0x${'ab'.repeat(32)}`,
    txHash: `0x${'cd'.repeat(32)}`,
    kind: 'Deposit',
    account: '0xa0ee7a142d267c1f36714e4a8f75612f20a79720',
    assets: '5555075900',
    shares: '5555075900000000000',
    timestamp: 1_760_000_000,
    ...over,
  };
}

describe('decimalsFrom', () => {
  it('returns the pair the service reported', () => {
    assert.deepEqual(decimalsFrom({ decimals: { asset: 6, share: 18 } }), { asset: 6, share: 18 });
  });

  it('returns null -- never 6 and 18 -- when the response has no decimals at all', () => {
    // THE DEFECT: defaulting. Written against a literal so that a changed default (8, 9, 24)
    // still fails; `notDeepEqual(…, {asset:6,share:18})` would pass for any other guess.
    assert.equal(decimalsFrom(null), null);
    assert.equal(decimalsFrom({}), null);
    assert.equal(decimalsFrom({ decimals: undefined }), null);
  });

  it('rejects a half-reported pair rather than completing it', () => {
    assert.equal(decimalsFrom({ decimals: { asset: 6 } }), null);
    assert.equal(decimalsFrom({ decimals: { asset: 6, share: null } }), null);
  });

  it('rejects a decimals count that is not a usable integer', () => {
    // A fractional count would reach `formatBaseUnits`, whose guard throws -- which is loud,
    // but the page would then render nothing rather than the raw amount. Reporting "unknown"
    // here keeps the table readable and the value unformatted.
    assert.equal(decimalsFrom({ decimals: { asset: 6.5, share: 18 } }), null);
    assert.equal(decimalsFrom({ decimals: { asset: -1, share: 18 } }), null);
    assert.equal(decimalsFrom({ decimals: { asset: 6, share: 37 } }), null);
    assert.equal(decimalsFrom({ decimals: { asset: '6', share: 18 } }), null);
    assert.equal(decimalsFrom({ decimals: { asset: Number.NaN, share: 18 } }), null);
  });

  it('accepts the boundaries of the legitimate range', () => {
    assert.deepEqual(decimalsFrom({ decimals: { asset: 0, share: 36 } }), { asset: 0, share: 36 });
  });
});

describe('amountCell', () => {
  it('renders an absent amount as an em dash and says why', () => {
    const cell = amountCell(null, DECIMALS, 'share');
    assert.equal(cell.text, '—');
    assert.equal(cell.exact, false);
    assert.match(cell.hint, /no amount of this unit/);
  });

  it('does NOT render an absent amount as zero', () => {
    // THE DEFECT: `null` and `"0"` printed the same way. A yield report has no shares field;
    // showing "0" there states that zero shares moved, which the event does not say.
    const absent = amountCell(null, DECIMALS, 'share');
    const zero = amountCell('0', DECIMALS, 'share');
    assert.notEqual(absent.text, zero.text);
    assert.equal(zero.text, '0');
    assert.equal(zero.exact, true);
  });

  it('prints raw base units, marked inexact, when the decimals are unknown', () => {
    // THE DEFECT: formatting with a guessed value. `5555075900` with 6 decimals is 5,555.0759
    // and with 18 it is 0.0000000055550759 -- a guess is not a rounding error, it is a
    // different number by a factor of a trillion.
    const cell = amountCell('5555075900', null, 'asset');
    assert.equal(cell.text, '5555075900');
    assert.equal(cell.exact, false);
    assert.match(cell.hint, /raw base units/);
  });

  it('formats past Number.MAX_SAFE_INTEGER exactly', () => {
    // An 18-decimal share amount. Through a double this is 859.0219057042313 and this
    // assertion fails, which is what makes it a test of the BigInt path rather than of the
    // decimal point.
    const cell = amountCell('859021905704231281673', DECIMALS, 'share');
    assert.equal(cell.text, '859.021905704231281673');
    assert.equal(cell.exact, true);
    assert.match(cell.hint, /18 decimals/);
  });

  it('picks the decimals from the unit, so one string has two correct answers', () => {
    // WHY THE UNIT IS A REQUIRED PARAMETER AND NOT A DEFAULT. The same raw string is a
    // different quantity depending on which field it came from, and only the caller knows
    // which. Asset units group; share units do not.
    const asAssets = amountCell('5555075900', DECIMALS, 'asset');
    const asShares = amountCell('5555075900', DECIMALS, 'share');
    assert.equal(asAssets.text, '5,555.0759');
    assert.equal(asShares.text, '0.0000000055550759');
    assert.notEqual(asAssets.text, asShares.text);
  });

  it('shows an unparseable amount unchanged rather than hiding it behind an em dash', () => {
    // The service and the console disagreeing about the shape of the data is a fact worth
    // seeing; `displayBaseUnits` already returns the input on a parse failure, and this pins
    // that behaviour at this call site too.
    const cell = amountCell('not-a-number', DECIMALS, 'asset');
    assert.equal(cell.text, 'not-a-number');
    assert.equal(cell.exact, true);
  });
});

describe('newestFirst', () => {
  it('orders by block, newest first', () => {
    const sorted = newestFirst([
      event({ blockNumber: 10, logIndex: 0 }),
      event({ blockNumber: 30, logIndex: 0 }),
      event({ blockNumber: 20, logIndex: 0 }),
    ]);
    assert.deepEqual(
      sorted.map((e) => e.blockNumber),
      [30, 20, 10],
    );
  });

  it('orders two events in the SAME block by log index, newest first', () => {
    // THE DEFECT: sorting on block number alone. A comparator that returns 0 for these two
    // leaves them in arrival order, so the table can reorder itself between two requests
    // that returned identical data.
    const sorted = newestFirst([
      event({ blockNumber: 42, logIndex: 0, kind: 'Deposit' }),
      event({ blockNumber: 42, logIndex: 7, kind: 'Withdraw' }),
      event({ blockNumber: 42, logIndex: 3, kind: 'YieldReported' }),
    ]);
    assert.deepEqual(
      sorted.map((e) => e.logIndex),
      [7, 3, 0],
    );
  });

  it('returns a copy and leaves the caller\'s array alone', () => {
    // A function that looks pure and silently reorders the caller's array is a bug that shows
    // up far from its cause.
    const input = [event({ blockNumber: 10, logIndex: 0 }), event({ blockNumber: 30, logIndex: 0 })];
    const before = input.map((e) => e.blockNumber);
    const sorted = newestFirst(input);
    assert.notEqual(sorted, input);
    assert.deepEqual(
      input.map((e) => e.blockNumber),
      before,
    );
    assert.deepEqual(
      sorted.map((e) => e.blockNumber),
      [30, 10],
    );
  });
});

describe('kindLabel', () => {
  it('labels the three kinds the decoder knows', () => {
    assert.equal(kindLabel('Deposit'), 'Deposit');
    assert.equal(kindLabel('Withdraw'), 'Withdraw');
    assert.equal(kindLabel('YieldReported'), 'Yield reported');
  });

  it('passes an unknown kind through unchanged instead of calling it "Unknown"', () => {
    // The service's own spelling is the searchable fact. A label invented here would hide
    // which string actually arrived, which is what someone debugging an undecoded event
    // needs most.
    assert.equal(kindLabel('SomethingNew'), 'SomethingNew');
  });
});

describe('tallyKinds', () => {
  const summary: SummaryResponse = {
    kinds: {
      Deposit: { count: 9, assets: '49995675000' },
      YieldReported: { count: 3, assets: '12000000000' },
      Withdraw: { count: 1, assets: '5555075900' },
    },
    totalEvents: 13,
    firstEventBlock: 8,
    lastEventBlock: 41,
    lastIndexedBlock: 41,
    unknownKinds: [],
    note: 'indexed from the deployment block',
  };

  it('adds the per-kind counts up itself and agrees with the service when they match', () => {
    const tally = tallyKinds(summary);
    assert.equal(tally.summedCount, 13);
    assert.equal(tally.reportedTotal, 13);
    assert.equal(tally.agrees, true);
    assert.equal(tally.disagreement, null);
  });

  it('reports a disagreement instead of picking one of the two numbers', () => {
    // THE DEFECT: printing `totalEvents` in one place and the per-kind rows in another, so a
    // service bug shows a reader "14 events" above a table that adds to 13 with no way to
    // tell which is wrong. The sum here is 13 and the reported total is 14 on purpose.
    const tally = tallyKinds({ ...summary, totalEvents: 14 });
    assert.equal(tally.agrees, false);
    assert.equal(tally.summedCount, 13);
    assert.equal(tally.reportedTotal, 14);
    assert.match(tally.disagreement ?? '', /14 events in total/);
    assert.match(tally.disagreement ?? '', /add up to 13/);
  });

  it('computes the sum rather than echoing the field it is checking', () => {
    // If `summedCount` were assigned from `totalEvents` the check above would be circular.
    // This case makes the two differ in the other direction, so an implementation that read
    // its own answer from the thing under test fails here too.
    const tally = tallyKinds({ ...summary, totalEvents: 0 });
    assert.equal(tally.summedCount, 13);
    assert.equal(tally.reportedTotal, 0);
    assert.equal(tally.agrees, false);
  });

  it('orders rows deterministically whatever order the service sent them in', () => {
    // `Object.entries` follows insertion order, which for a GROUP BY result is whatever the
    // database chose. Two responses with identical data would then render two different
    // tables, and a reader comparing screenshots would see a difference that is not there.
    const reordered: SummaryResponse = {
      ...summary,
      kinds: {
        Withdraw: { count: 1, assets: '5555075900' },
        YieldReported: { count: 3, assets: '12000000000' },
        Deposit: { count: 9, assets: '49995675000' },
      },
    };
    assert.deepEqual(
      tallyKinds(reordered).rows,
      tallyKinds(summary).rows,
    );
    assert.deepEqual(
      tallyKinds(summary).rows.map((r) => r.kind),
      ['Deposit', 'YieldReported', 'Withdraw'],
    );
  });

  it('breaks a tie on count by kind, so equal counts do not swap places', () => {
    const tie: SummaryResponse = {
      ...summary,
      kinds: { Withdraw: { count: 3, assets: '1' }, Deposit: { count: 3, assets: '2' } },
      totalEvents: 6,
    };
    assert.deepEqual(
      tallyKinds(tie).rows.map((r) => r.kind),
      ['Deposit', 'Withdraw'],
    );
  });

  it('survives an empty tally without inventing rows', () => {
    const empty = tallyKinds({ ...summary, kinds: {}, totalEvents: 0 });
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.agrees, true);
  });
});

describe('truncationLabel', () => {
  it('says all of them when the table holds everything', () => {
    const label = truncationLabel(50, 50, 'events');
    assert.equal(label.text, 'All 50 events the index holds.');
    assert.equal(label.impossible, false);
  });

  it('says how many of how many when the table is truncated', () => {
    const label = truncationLabel(50, 2431, 'events');
    assert.equal(label.text, 'The most recent 50 of 2431 events the index holds.');
  });

  it('reports an impossible count rather than clamping it', () => {
    // THE DEFECT: a tidy "showing 60 of 12" that a reader has no reason to question. Two
    // endpoints disagreeing about how much history exists is a fault to surface, and clamping
    // would print a plausible sentence over it.
    const label = truncationLabel(60, 12, 'events');
    assert.equal(label.impossible, true);
    assert.match(label.text, /not trustworthy/);
    assert.match(label.text, /showing 60 events/);
  });
});

describe('priceRows', () => {
  const series: PricePoint[] = [
    { blockNumber: 10, blockHash: '0xaa', timestamp: 100, totalAssets: '1000000', totalSupply: '1000000000000000000', price: '1' },
    { blockNumber: 11, blockHash: '0xbb', timestamp: 101, totalAssets: '1100000', totalSupply: '1000000000000000000', price: '1.1' },
    { blockNumber: 12, blockHash: '0xcc', timestamp: 102, totalAssets: '1200000', totalSupply: '1000000000000000000', price: '1.20' },
  ];

  it('takes the newest rows and reverses them to newest first', () => {
    assert.deepEqual(
      priceRows(series, 2).map((r) => r.blockNumber),
      [12, 11],
    );
  });

  it('normalises the price string it will display', () => {
    // `1.20` and `1.2` are the same price; the service can spell a candle's values either
    // way, and a table showing both spellings for one value reads as two values.
    assert.equal(priceRows(series, 1)[0]?.price, '1.2');
  });

  it('returns nothing for a limit of zero instead of the whole series', () => {
    // THE DEFECT: `arr.slice(-0)` is `arr.slice(0)`. A limit of 0 that renders the entire
    // series is a bug that hides until the data is large.
    assert.deepEqual(priceRows(series, 0), []);
    assert.deepEqual(priceRows(series, -1), []);
  });

  it('returns the whole series, newest first, when the limit exceeds it', () => {
    assert.deepEqual(
      priceRows(series, 999).map((r) => r.blockNumber),
      [12, 11, 10],
    );
  });

  it('returns a copy and does not reverse the caller\'s series', () => {
    const before = series.map((p) => p.blockNumber);
    priceRows(series, 3);
    assert.deepEqual(
      series.map((p) => p.blockNumber),
      before,
    );
  });

  it('renders a null price as an em dash, not as a number', () => {
    // A block where the vault held no shares has no price. That is not a price of zero.
    const withNull: PricePoint[] = [{ ...series[0]!, price: null }];
    assert.equal(priceRows(withNull, 1)[0]?.price, '—');
  });
});
