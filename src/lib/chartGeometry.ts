/**
 * The chart's arithmetic, with no React and no DOM in it.
 *
 * WHY THIS IS SEPARATE FROM THE COMPONENT
 *
 * This was inside `PriceChart.tsx` in the first version. It was correct, and it had no
 * assertion that could say so: a rule that lives inside a component can only be checked by
 * rendering the component, and "I read the code and the guard is there" is not evidence.
 * The one bug this chart exists to avoid -- a flat series dividing by a zero range and
 * drawing nothing -- is arithmetic, so the arithmetic is where it belongs and where it can
 * be tested directly.
 *
 * The component now does layout: it owns the pixel constants and turns these numbers into
 * SVG attributes. Nothing here knows what SVG is.
 *
 * GEOMETRY IS ALLOWED TO USE `Number`. LABELS ARE NOT.
 *
 * A pixel cannot show the 17th significant digit, so converting a candle's exact decimal
 * string to a float for the purpose of deciding where to draw a line loses nothing a
 * reader could have seen. The exact strings are what the `<title>` prints, and those are
 * never converted. The distinction is the whole reason `displayAmount` takes a string and
 * this takes a number.
 */

/** A candle, reduced to what geometry needs. Keeps this module independent of the API types. */
export interface CandleShape {
  startsAt: number;
  high: string;
  low: string;
  open: string;
  close: string;
}

/**
 * A drawable range.
 *
 * `min`/`max` are the SCALE bounds, not the data bounds: they include the padding. `span`
 * is `max - min` and is guaranteed to be a finite positive number, which is the guarantee
 * the rest of the chart leans on.
 */
export interface Range {
  min: number;
  max: number;
  span: number;
  /** True when every candle had high === low, i.e. the price never moved. */
  flat: boolean;
}

/**
 * THE GUARD, in one place.
 *
 * `(value - min) / (max - min)` with `max === min` is `0/0` = NaN, every y coordinate
 * becomes NaN, and SVG silently draws nothing -- no error, no warning, just an empty box
 * that a reader interprets as "there is no history" when in fact there is a full history
 * that did not move.
 *
 * So a zero range is expanded symmetrically around the value. A flat series then renders
 * as a flat line down the middle of the panel, which is an honest picture of "this did not
 * move" and keeps the panel visibly alive.
 *
 * The spread is proportional to the magnitude so the expansion is visible at any price
 * scale, with an absolute floor for a price of exactly zero.
 */
export function computeRange(values: readonly number[]): Range | null {
  const finite = values.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return null;

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  const flat = max === min;

  if (flat) {
    const spread = Math.abs(min) > 0 ? Math.abs(min) * 0.002 : 1e-6;
    min -= spread;
    max += spread;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }

  const span = max - min;
  // Belt and braces. The branches above cannot produce a non-positive span for finite
  // input, but `span` becomes a divisor below, and a NaN coordinate is invisible rather
  // than loud -- so an impossible span returns null and the component renders its
  // "no history" panel instead of an empty SVG.
  if (!Number.isFinite(span) || span <= 0) return null;

  return { min, max, span, flat };
}

/** Every value a candle contributes to the scale. */
export function candleValues(candles: readonly CandleShape[]): number[] {
  return candles.flatMap((c) => [Number(c.high), Number(c.low), Number(c.open), Number(c.close)]);
}

/** The scale for a set of candles, or null when there is nothing drawable. */
export function rangeFor(candles: readonly CandleShape[]): Range | null {
  if (candles.length === 0) return null;
  return computeRange(candleValues(candles));
}

/**
 * Map a value into the drawable band.
 *
 * `top` is the pixel row of the range maximum and `height` the band's thickness, so the
 * result is inside `[top, top + height]` for any value inside `[min, max]`. Values outside
 * the range map outside the band, which is correct: they are outside the scale.
 */
export function makeScale(range: Range, top: number, height: number): (value: number) => number {
  return (value: number) => top + height - ((value - range.min) / range.span) * height;
}

/** Where one candle's body and wick go, in the same band the scale produces. */
export interface CandleGeometry {
  /** Body top edge, i.e. the lesser of the open and close rows. */
  top: number;
  /** Body height, never below `minBodyHeight`. */
  height: number;
  /** True when the close is at or above the open. Drives the up/down colour. */
  up: boolean;
  yHigh: number;
  yLow: number;
}

/**
 * One candle's geometry.
 *
 * THE DOJI FLOOR. A candle whose open equals its close -- a doji, and every candle in a
 * flat series -- has zero height. A zero-height `<rect>` draws nothing, so a run of them
 * reads as gaps in the data rather than as "the price held steady". Giving the body a
 * visible minimum is what makes a flat series legible as a series.
 */
export function candleGeometry(
  candle: CandleShape,
  scale: (value: number) => number,
  minBodyHeight = 1.5,
): CandleGeometry {
  const yHigh = scale(Number(candle.high));
  const yLow = scale(Number(candle.low));
  const yOpen = scale(Number(candle.open));
  const yClose = scale(Number(candle.close));
  return {
    top: Math.min(yOpen, yClose),
    height: Math.max(Math.abs(yClose - yOpen), minBodyHeight),
    up: Number(candle.close) >= Number(candle.open),
    yHigh,
    yLow,
  };
}

/**
 * Horizontal placement for a series.
 *
 * `bodyWidth` is clamped rather than derived freely: with one candle in the window
 * `step * 0.7` would be most of the panel (a single candle drawn as a wall), and with five
 * thousand it would round to zero and vanish.
 */
export function horizontalLayout(count: number, innerWidth: number) {
  const step = innerWidth / count;
  const bodyWidth = Math.max(Math.min(step * 0.7, 14), 0.5);
  return {
    step,
    bodyWidth,
    /** Centre of candle `index`, so bodies sit in the middle of their slot. */
    centre: (index: number) => (index + 0.5) * step,
  };
}
