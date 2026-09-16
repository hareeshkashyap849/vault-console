'use client';

import { useMemo } from 'react';
import type { Candle } from '@/lib/types';
import { candleGeometry, horizontalLayout, makeScale, rangeFor } from '@/lib/chartGeometry';
import { displayDecimal, timeLabel } from '@/lib/format';

/**
 * A candlestick chart, drawn as SVG.
 *
 * THE ONE BUG THIS COMPONENT EXISTS TO AVOID
 *
 * A flat series must not draw as a blank panel. This vault's price is almost constant:
 * every yield report raises `totalAssets` proportionally and mints nothing, so the share
 * price moves by less than one part in 10^5 and rounds to the same six-decimal string.
 * On such a series `max === min`, so `(v - min) / (max - min)` is 0/0, every y coordinate
 * is NaN, and SVG draws NOTHING -- no error, no warning, just an empty box that reads as
 * "there is no data" when in fact there is plenty and it simply did not move.
 *
 * The guard itself lives in `@/lib/chartGeometry`, where it is a pure function with its
 * own tests. This component does layout: it owns the pixel constants and turns those
 * numbers into SVG attributes.
 *
 * THE CANDLE VALUES ARE DECIMAL STRINGS, NOT BASE UNITS
 *
 * The service formats OHLC to the asset's decimals before answering, so `open` is `"1.1"`
 * and not `1100000`. `displayDecimal` is the formatter for that shape;
 * `displayBaseUnits` is for the raw uint256 fields (`totalAssets`, `totalSupply`) and using
 * it here would reprint the string unchanged. The two are separate functions precisely so
 * that the wrong one is visible at the call site.
 *
 * WHY NOT A CHARTING LIBRARY
 *
 * The arithmetic that matters here -- bucketing, exactness, the flat-series guard -- is on
 * the service side and in `chartGeometry`, and both are tested. A library would add a
 * dependency, its own opinion about scales, and a second place where the numbers could be
 * transformed.
 */

interface Props {
  candles: Candle[];
  assetSymbol: string;
  bucketSeconds: number;
}

const W = 1000;
const H = 320;
const PAD = { top: 12, right: 12, bottom: 22, left: 12 };

export function PriceChart({ candles, assetSymbol, bucketSeconds }: Props) {
  const view = useMemo(() => {
    const range = rangeFor(candles);
    if (range === null) return null;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    return {
      range,
      scale: makeScale(range, PAD.top, innerH),
      cols: horizontalLayout(candles.length, innerW),
    };
  }, [candles]);

  if (candles.length === 0 || view === null) {
    return (
      <div
        className="flex h-[320px] items-center justify-center rounded-md bg-slate-900/40 text-sm text-slate-500"
        role="img"
        aria-label="No price history is available for this window."
      >
        No price history in this window.
      </div>
    );
  }

  const { range, scale, cols } = view;
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[320px] w-full rounded-md bg-slate-900/40"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `${candles.length} candles of ${bucketSeconds} seconds, from ${last.low} to ${last.high} ` +
          `${assetSymbol}. Latest close ${last.close}.` +
          (range.flat ? ' The price did not move in this window.' : '')
        }
      >
        {/* Gridlines at the top, middle and bottom of the scale, so the reader can see the
            range rather than assuming it starts at zero. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
            y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
            className="stroke-slate-600/30"
            strokeWidth={1}
          />
        ))}

        {candles.map((c, i) => {
          const cx = PAD.left + cols.centre(i);
          const g = candleGeometry(c, scale);

          return (
            <g key={c.startsAt}>
              <line
                x1={cx}
                x2={cx}
                y1={g.yHigh}
                y2={g.yLow}
                strokeWidth={1.5}
                className={g.up ? 'stroke-emerald-500' : 'stroke-rose-500'}
              />
              <rect
                x={cx - cols.bodyWidth / 2}
                y={g.top}
                width={cols.bodyWidth}
                height={g.height}
                strokeWidth={1}
                className={g.up ? 'fill-emerald-500/50 stroke-emerald-500' : 'fill-rose-500/50 stroke-rose-500'}
              >
                {/* The tooltip carries the EXACT stored strings. This is where a one-base
                    unit move is still legible, even though it draws as the same pixel. */}
                <title>
                  {`${new Date(c.startsAt * 1000).toISOString()}\n` +
                    `open  ${c.open}\nhigh  ${c.high}\nlow   ${c.low}\nclose ${c.close}\n` +
                    `${c.points} block${c.points === 1 ? '' : 's'} (${c.firstBlock}-${c.lastBlock})`}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="figure">
          {candles.length} x {bucketSeconds}s
        </span>
        <span className="figure">
          {timeLabel(first.startsAt)} - {timeLabel(last.startsAt)}
        </span>
        <span className="figure">
          blocks {first.firstBlock} - {last.lastBlock}
        </span>
        <span className="figure text-slate-300">
          {displayDecimal(last.low)} - {displayDecimal(last.high)} {assetSymbol}
        </span>
        {range.flat && (
          // Said out loud rather than left for the reader to infer from a flat line. The
          // flatness is a fact about the vault, not a failure of the chart.
          <span className="text-amber-400/90">the price did not move in this window</span>
        )}
      </figcaption>
    </figure>
  );
}
