/**
 * Chart geometry.
 *
 * THE BUG THESE TESTS EXIST FOR
 *
 * A flat price series must not render as an empty panel. This vault's price is 1.1 at every
 * indexed block, because each yield report raises `totalAssets` proportionally and mints no
 * shares. On such a series `min === max`, `(value - min) / (max - min)` is `0/0`, and every
 * y coordinate becomes NaN. SVG draws nothing for a NaN coordinate -- no exception, no
 * warning, no console entry. The panel is simply blank, and a blank panel reads as "there
 * is no history" when there are 169 candles of perfectly good history sitting in it.
 *
 * So the first test below asserts the absence of NaN rather than the presence of a line.
 * Promoting the guard into a pure function is what makes that assertable at all: inside a
 * React component there is nothing to call.
 *
 * WHAT THESE CANNOT SHOW
 *
 * Geometry is not pixels. These tests prove the numbers handed to SVG are finite and inside
 * the band; they do not prove the browser paints them. `tools/browser-assert.mjs` reads the
 * live SVG's attributes for that, and the two together are the evidence.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { candleGeometry, candleValues, computeRange, horizontalLayout, makeScale, rangeFor } from '../src/lib/chartGeometry.ts';
import type { CandleShape } from '../src/lib/chartGeometry.ts';

/** A candle whose four values are all the same number, i.e. no movement within the bucket. */
function flatCandle(startsAt: number, price: string): CandleShape {
  return { startsAt, high: price, low: price, open: price, close: price };
}

describe('computeRange -- the zero-range guard', () => {
  it('expands a flat range instead of dividing by zero', () => {
    const range = computeRange([1.1, 1.1, 1.1, 1.1]);
    assert.ok(range, 'a flat series must still produce a drawable range');
    assert.ok(range.span > 0, `span must be positive, got ${range.span}`);
    assert.ok(Number.isFinite(range.span));
    assert.equal(range.flat, true);
    // Symmetric around the value, so the line lands in the middle of the panel.
    assert.ok(range.min < 1.1 && range.max > 1.1, 'the value must be strictly inside the scale');
    assert.equal((range.min + range.max) / 2, 1.1);
  });

  it('every y coordinate is finite for a flat series -- the assertion the bug would fail', () => {
    const range = computeRange([1.1, 1.1, 1.1]);
    assert.ok(range);
    const scale = makeScale(range, 12, 286);
    const values = [1.1, 1.1, 1.1, 1.1];
    for (const v of values) {
      const y = scale(v);
      assert.ok(Number.isFinite(y), `scale(${v}) produced ${y}`);
      assert.ok(y >= 12 && y <= 12 + 286, `scale(${v}) = ${y} is outside the drawable band`);
    }
  });

  it('keeps a zero price drawable', () => {
    // The absolute floor branch. `Math.abs(0) * 0.002` is 0, so without the `1e-6` fallback
    // the spread would be zero and the guard would do nothing.
    const range = computeRange([0, 0]);
    assert.ok(range, 'a price of exactly zero must still produce a range');
    assert.ok(range.span > 0, 'the zero-price branch must not produce a zero span');
  });

  it('pads a range that has movement, without making it flat', () => {
    const range = computeRange([1.0, 2.0]);
    assert.ok(range);
    assert.equal(range.flat, false);
    assert.ok(range.min < 1.0, `min ${range.min} should be padded below 1.0`);
    assert.ok(range.max > 2.0, `max ${range.max} should be padded above 2.0`);
    // 8% padding on each side.
    assert.equal(range.min, 1.0 - 0.08);
    assert.equal(range.max, 2.0 + 0.08);
  });

  it('distinguishes flat from padded -- a one-base-unit move is not flat', () => {
    const moved = computeRange([1.1, 1.100001]);
    assert.ok(moved);
    assert.equal(moved.flat, false, 'a series that moved must not be reported as flat');
  });

  it('returns null when there is nothing finite to scale', () => {
    assert.equal(computeRange([]), null);
    assert.equal(computeRange([NaN, Infinity, -Infinity]), null);
  });

  it('ignores non-finite values when finite ones exist', () => {
    const range = computeRange([1.1, NaN, 1.2, Infinity]);
    assert.ok(range);
    assert.ok(Number.isFinite(range.min) && Number.isFinite(range.max) && Number.isFinite(range.span));
  });

  it('handles a negative range (a price cannot be negative, but the guard must not assume it)', () => {
    const range = computeRange([-5, -5]);
    assert.ok(range);
    assert.ok(Number.isFinite(range.span) && range.span > 0);
  });
});

describe('rangeFor', () => {
  it('scales over all four values of every candle, not just the closes', () => {
    const candles: CandleShape[] = [
      { startsAt: 1, high: '1.2', low: '1.0', open: '1.1', close: '1.1' },
      { startsAt: 2, high: '1.3', low: '0.9', open: '1.1', close: '1.1' },
    ];
    const values = candleValues(candles);
    assert.equal(values.length, 8);
    const range = rangeFor(candles);
    assert.ok(range);
    // 0.9 and 1.3 are the extremes even though no close ever left 1.1.
    assert.ok(range.min < 0.9 && range.max > 1.3, `range ${range.min}..${range.max} must cover the wicks`);
  });

  it('returns null for an empty series so the component renders its empty state', () => {
    assert.equal(rangeFor([]), null);
  });

  it('reads the exact decimal strings, which for this vault are all "1.1"', () => {
    // 169 real candles, every one of them 1.1. This is the live shape, and it is flat.
    const candles = Array.from({ length: 169 }, (_, i) => flatCandle(1789542240 + i * 60, '1.1'));
    const range = rangeFor(candles);
    assert.ok(range, 'the real 169-candle series must produce a drawable range');
    assert.equal(range.flat, true);
    assert.ok(Number.isFinite(range.span) && range.span > 0);
  });
});

describe('rangeFor -- the OHLC values arrive with thousands separators', () => {
  /**
   * THE BUG THESE EXIST FOR
   *
   * The four values of a candle are the service's DISPLAY strings: `formatCandles` in
   * `erc4626-vault-dapp/src/api/chart.ts` runs each one through `groupThousands`, so `"1,234.5"`
   * is a body the service really produces, and it is the ordinary case rather than an exotic one
   * -- any price above 999 is spelled that way.
   *
   * `Number('1,234.5')` is `NaN`, because a comma is not part of a JavaScript numeric literal.
   * Nothing about that is loud: `computeRange` filters non-finite values, every candle is
   * dropped, `rangeFor` returns `null`, and `/vault` renders *No price history in this window*
   * over a series full of prices. The read is exactly what `/vault` draws with.
   *
   * It cannot happen at today's price of `1`, which is the only reason this went unnoticed: the
   * first test below is the one that fails on the old `Number(...)` implementation, and it fails
   * with `rangeFor` returning `null` rather than with a wrong number, which is why the assertion
   * is on the range existing at all.
   */
  it('asserts the premise: `Number` really cannot read a grouped value', () => {
    assert.ok(
      Number.isNaN(Number('1,234.5')),
      'this test set exists because Number("1,234.5") is NaN -- if that ever changes, so must the reasoning above',
    );
  });

  it('produces a real range for a grouped value, where the old parse produced null', () => {
    const candles: CandleShape[] = [
      { startsAt: 1, high: '1,234.5', low: '1,230.0', open: '1,232.0', close: '1,234.5' },
    ];
    const range = rangeFor(candles);
    assert.ok(range, 'a grouped candle must produce a drawable range, not null');
    assert.ok(Number.isFinite(range.span) && range.span > 0, `span must be positive, got ${range.span}`);
    // The scale is in PRICE units, not in the parsed integer: 1,230.0 and 1,234.5 are the
    // extremes, and the padding puts the bounds outside them.
    assert.ok(range.min < 1230.0 && range.max > 1234.5, `range ${range.min}..${range.max} is not around 1230..1234.5`);
  });

  it('reads a grouped value as the number it is written as', () => {
    // Grouped and ungrouped spellings in one series, so a parse that assumed one scale for the
    // whole array -- a fixed decimals count, or the first value's -- is caught here. Each value
    // carries its own scale, which is what a display string can offer.
    const values = candleValues([
      { startsAt: 1, high: '1,234.5', low: '9', open: '1,000', close: '1,000.25' },
    ]);
    assert.deepEqual(values, [1234.5, 9, 1000, 1000.25]);
  });

  it('scales a grouped series over its true values, not over four NaNs', () => {
    const candles: CandleShape[] = [
      { startsAt: 1, high: '1,000.5', low: '999.5', open: '1,000.0', close: '1,000.5' },
      { startsAt: 2, high: '1,001.0', low: '1,000.0', open: '1,000.5', close: '1,001.0' },
    ];
    const range = rangeFor(candles);
    assert.ok(range, 'a grouped series must produce a range');
    assert.equal(range.flat, false, 'this series moved by one unit and must not be reported as flat');
    assert.ok(range.min < 999.5 && range.max > 1001.0, `range ${range.min}..${range.max} must cover the wicks`);
  });

  it('still expands a grouped series that never moved -- the four-digit flat case', () => {
    // The day the price reaches 1000, every candle is spelled with a comma AND every candle is
    // still flat (this vault's yield reports raise `totalAssets` proportionally and mint no
    // shares). Both guards have to hold at once, and the flat one is the one that silently drew
    // a blank panel before.
    const candles = Array.from({ length: 169 }, (_, i) => flatCandle(1789542240 + i * 60, '1,000.5'));
    const range = rangeFor(candles);
    assert.ok(range, 'a grouped flat series must still produce a drawable range');
    assert.equal(range.flat, true);
    assert.equal((range.min + range.max) / 2, 1000.5);
  });

  it('hands `candleGeometry` finite coordinates for a grouped candle', () => {
    // The same parse feeds the picture, not just the scale: a NaN here is an invisible candle
    // inside a panel that otherwise looks fine, which is harder to notice than a blank panel.
    const candles: CandleShape[] = [{ startsAt: 1, high: '1,234.5', low: '1,230.0', open: '1,232.0', close: '1,234.5' }];
    const range = rangeFor(candles);
    assert.ok(range);
    const scale = makeScale(range, 12, 286);
    const g = candleGeometry(candles[0]!, scale);
    for (const [name, v] of Object.entries(g)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name} = ${v} for a grouped candle`);
    }
    assert.equal(g.up, true, 'the close is above the open, and reading that off NaN loses the colour');
  });

  it('drops a value no parser can read rather than taking the panel down', () => {
    // The behaviour that was already here and is deliberately unchanged: `computeRange` filters
    // non-finite values, so one malformed candle degrades the picture instead of throwing during
    // render.
    const candles: CandleShape[] = [
      { startsAt: 1, high: 'not a number', low: '1,230.0', open: '1,232.0', close: '1,234.5' },
    ];
    const range = rangeFor(candles);
    assert.ok(range, 'the three readable values must still produce a range');
    assert.ok(Number.isFinite(range.span) && range.span > 0);
    assert.equal(candleValues(candles).filter((v) => Number.isFinite(v)).length, 3);
  });
});

describe('makeScale', () => {
  it('maps the range maximum to the top of the band and the minimum to the bottom', () => {
    const range = { min: 1, max: 2, span: 1, flat: false };
    const scale = makeScale(range, 10, 100);
    assert.equal(scale(1), 110);
    assert.equal(scale(2), 10);
    assert.equal(scale(1.5), 60);
  });

  it('is monotonic: a higher price is never drawn lower', () => {
    const range = computeRange([1.0, 1.5, 1.1, 1.4]);
    assert.ok(range);
    const scale = makeScale(range, 0, 300);
    const ys = [1.0, 1.1, 1.4, 1.5].map(scale);
    for (let i = 1; i < ys.length; i += 1) {
      assert.ok(ys[i]! < ys[i - 1]!, `scale must decrease as price rises: ${ys.join(', ')}`);
    }
  });
});

describe('candleGeometry -- the doji floor', () => {
  // Real candles whose extremes are 1.0 and 2.0, so the scale comes from `rangeFor` rather
  // than from a hand-built range object. (The first version of this file called
  // `rangeFor([1.0, 2.0])` -- raw numbers where candles were expected. `Number(undefined)`
  // is NaN, both extremes filtered out, `rangeFor` returned null, and the assertions then
  // ran against a NaN-producing scale. The test passed its own setup check and would have
  // passed a wrong implementation too.)
  const candles: CandleShape[] = [
    { startsAt: 1, high: '2.0', low: '1.0', open: '1.2', close: '1.5' },
    { startsAt: 2, high: '1.6', low: '1.4', open: '1.4', close: '1.6' },
  ];
  const range = rangeFor(candles);
  assert.ok(range, 'the fixture candles must produce a range');
  const scale = makeScale(range, 0, 300);

  it('gives a zero-height body (a doji) a visible minimum', () => {
    // A zero-height rect draws nothing, so a run of dojis reads as gaps in the data
    // rather than as "the price held steady".
    const g = candleGeometry(flatCandle(1, '1.1'), scale);
    assert.ok(g.height >= 1.5, `doji height ${g.height} would be invisible`);
    assert.equal(g.yHigh, g.yLow, 'a flat candle has no wick');
  });

  it('uses the true height when the candle did move', () => {
    const g = candleGeometry({ startsAt: 1, high: '1.6', low: '1.4', open: '1.4', close: '1.6' }, scale);
    assert.ok(g.height > 1.5, `a moving candle should not be clamped: ${g.height}`);
    // 0.2 out of the padded span, over 300px.
    assert.ok(Math.abs(g.height - (0.2 / range!.span) * 300) < 1e-9);
  });

  it('marks up and down from open vs close, not high vs low', () => {
    // Both candles below have the same high and low; only the open/close order differs.
    // Reading the direction off the wick would colour them the same.
    const up = candleGeometry({ startsAt: 1, high: '1.6', low: '1.0', open: '1.2', close: '1.5' }, scale);
    const down = candleGeometry({ startsAt: 1, high: '1.6', low: '1.0', open: '1.5', close: '1.2' }, scale);
    assert.equal(up.up, true);
    assert.equal(down.up, false);
  });

  it('treats close === open as up, so a flat series is one colour rather than alternating', () => {
    const g = candleGeometry(flatCandle(1, '1.1'), scale);
    assert.equal(g.up, true);
  });

  it('places the body top at the lesser of open and close', () => {
    const down = candleGeometry({ startsAt: 1, high: '1.6', low: '1.0', open: '1.5', close: '1.2' }, scale);
    assert.equal(down.top, Math.min(scale(1.5), scale(1.2)));
    assert.ok(Number.isFinite(down.top));
  });

  it('produces a finite geometry for every candle in the real flat series', () => {
    const candles = Array.from({ length: 169 }, (_, i) => flatCandle(1789542240 + i * 60, '1.1'));
    const r = rangeFor(candles);
    assert.ok(r);
    const s = makeScale(r, 12, 286);
    for (const c of candles) {
      const g = candleGeometry(c, s);
      for (const [name, v] of Object.entries(g)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name} = ${v} for candle ${c.startsAt}`);
      }
    }
  });
});

describe('horizontalLayout', () => {
  it('keeps a single candle from being drawn as a wall', () => {
    const { bodyWidth } = horizontalLayout(1, 976);
    assert.equal(bodyWidth, 14, 'the upper clamp must apply');
  });

  it('keeps five thousand candles from rounding away to nothing', () => {
    const { bodyWidth, step } = horizontalLayout(5000, 976);
    assert.ok(step > 0);
    assert.equal(bodyWidth, 0.5, 'the lower clamp must apply');
  });

  it('centres candle i in its own slot', () => {
    const { step, centre } = horizontalLayout(4, 400);
    assert.equal(step, 100);
    assert.equal(centre(0), 50);
    assert.equal(centre(3), 350);
  });

  it('never produces a zero or negative width for any realistic count', () => {
    for (const count of [1, 2, 10, 169, 500, 5000]) {
      const { step, bodyWidth } = horizontalLayout(count, 976);
      assert.ok(step > 0, `step for ${count} was ${step}`);
      assert.ok(bodyWidth > 0, `bodyWidth for ${count} was ${bodyWidth}`);
    }
  });
});
