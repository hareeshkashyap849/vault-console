/**
 * The `/history` view's logic, kept out of the page so it can be tested without a browser.
 *
 * FOUR DECISIONS THAT ARE CORRECTNESS, NOT LAYOUT
 *
 * 1. THE ROW ORDER IS ENFORCED HERE, NOT TRUSTED FROM THE SERVICE.
 *
 * The events endpoint documents "newest first", so the obvious page just renders the array.
 * Then the page's own claim -- "newest first" -- depends on a clause in another repository
 * that nobody re-reads. `newestFirst` sorts on `(blockNumber, logIndex)`, which is the only
 * total order these events have: two events in the SAME block differ only by log index, so
 * sorting on block number alone leaves them in whatever order the array arrived in and the
 * table can disagree with itself between two requests.
 *
 * It returns a copy. Sorting the caller's array in place would make a function that looks
 * pure reorder a value the caller still holds.
 *
 * 2. THE TWO EVENT TOTALS ARE RECONCILED, NOT BOTH PRINTED.
 *
 * `GET /api/summary` answers with `totalEvents` AND a per-kind breakdown. Two numbers for
 * one quantity. A page that prints both is one service bug away from showing a reader
 * "12 events" beside a table of 11, with no way to tell which is wrong. `tallyKinds` adds
 * the breakdown up itself and reports whether the service's own total agrees, so a
 * disagreement becomes a sentence on the page instead of a silent contradiction. The sum is
 * computed HERE and never copied from the field it is checking -- a check that reads its own
 * answer from the thing it is checking is not a check.
 *
 * 3. A MISSING DECIMALS VALUE IS NOT A DEFAULT.
 *
 * Amounts arrive as raw base units and are unreadable as such. Formatting them needs the
 * asset's and the share's decimals, and on this page those come from the index service. The
 * first version of the console's sibling dApp defaulted to 6 and 18 when the value was
 * absent, which turns "we do not know" into a confident wrong number. `decimalsFrom` returns
 * `null` rather than a guess, and `amountCell` then shows the raw base units and says so.
 *
 * 4. `null` AND `"0"` ARE DIFFERENT FACTS.
 *
 * A `YieldReported` event has no `shares` field at all -- the event carries one amount, not
 * two -- and the service serialises that as `null`. Zero shares moved and no shares figure
 * exists are different statements, and a cell that renders both as "0" is wrong about one of
 * them. So `null` renders as an em dash with the reason, and the string `"0"` renders as the
 * number it is.
 */
import { displayBaseUnits, displayDecimal } from './format.ts';
import type { PricePoint, SummaryResponse, VaultEvent } from './types.ts';

/** The asset and share decimals, in the two names the callers use. */
export interface Decimals {
  asset: number;
  share: number;
}

/**
 * Decimals from a service response, or `null` -- and `null` is a real answer.
 *
 * `decimals` is validated rather than trusted: a non-integer, a negative, or an absurd count
 * would otherwise reach `formatBaseUnits`, where a fractional count silently produces a
 * range error or a wrong grouping. The upper bound is 36 because that is the largest value
 * the ERC-20 convention admits; anything past it is a service bug, and reporting it as
 * "decimals unknown" is better than printing a number that is merely plausible.
 */
export function decimalsFrom(response: { decimals?: { asset?: unknown; share?: unknown } } | null): Decimals | null {
  if (response === null || response.decimals === undefined || response.decimals === null) return null;
  const asset = response.decimals.asset;
  const share = response.decimals.share;
  if (!isDecimalCount(asset) || !isDecimalCount(share)) return null;
  return { asset, share };
}

function isDecimalCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36;
}

/**
 * One event's amount, ready to print, WITH the reason it reads the way it does.
 *
 * `exact` is false in the two cases where the cell is not a formatted amount: the field is
 * absent, or the decimals are unknown. The page uses it for the cell's title, so a reader
 * hovering an em dash learns WHY rather than assuming zero.
 */
export function amountCell(
  baseUnits: string | null,
  decimals: Decimals | null,
  unit: 'asset' | 'share',
): { text: string; exact: boolean; hint: string } {
  if (baseUnits === null) {
    return { text: '—', exact: false, hint: 'this event carries no amount of this unit' };
  }
  if (decimals === null) {
    // Printed raw on purpose. See decision 3 above: a guessed decimals value would turn an
    // unknown into a wrong number, and the raw string is what a debugging reader wants.
    return { text: baseUnits, exact: false, hint: 'raw base units — the index has not reported the decimals' };
  }
  return {
    text: displayBaseUnits(baseUnits, unit === 'asset' ? decimals.asset : decimals.share),
    exact: true,
    hint: unit === 'asset' ? `${decimals.asset} decimals` : `${decimals.share} decimals`,
  };
}

/** Newest first, by `(blockNumber, logIndex)`, as a copy. See decision 1 above. */
export function newestFirst(events: VaultEvent[]): VaultEvent[] {
  return [...events].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
}

/** A readable label for an event kind, with an unknown kind passed through unchanged. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'Deposit':
      return 'Deposit';
    case 'Withdraw':
      return 'Withdraw';
    case 'YieldReported':
      return 'Yield reported';
    default:
      // Unchanged, not "Unknown". The service's own spelling is the searchable fact, and a
      // label invented here would hide which string the service actually sent.
      return kind;
  }
}

export interface KindRow {
  kind: string;
  label: string;
  count: number;
  /** The exact sum of this kind's `assets`, as a uint256 string. A string, never a number. */
  assets: string;
}

export interface Tally {
  /** One row per kind, ordered by count then name, so two requests render identically. */
  rows: KindRow[];
  /** The per-kind counts added up HERE. The check's own arithmetic. */
  summedCount: number;
  /** The service's `totalEvents`, echoed for comparison. */
  reportedTotal: number;
  agrees: boolean;
  /** A sentence for the page when the two disagree, or `null` when they agree. */
  disagreement: string | null;
}

/**
 * Reconcile the service's event total with its own per-kind breakdown. See decision 2 above.
 *
 * Rows are ordered by `(count desc, kind asc)`. `Object.entries` order is insertion order,
 * which for a `GROUP BY` result is whatever the database chose -- so leaving it alone would
 * let the table reorder itself between two requests that returned identical data, and a
 * reader comparing two screenshots would see a difference that is not there.
 */
export function tallyKinds(summary: SummaryResponse): Tally {
  const rows: KindRow[] = Object.entries(summary.kinds ?? {})
    .map(([kind, entry]) => ({
      kind,
      label: kindLabel(kind),
      count: entry.count,
      assets: entry.assets,
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));

  const summedCount = rows.reduce((total, row) => total + row.count, 0);
  const reportedTotal = summary.totalEvents;
  const agrees = summedCount === reportedTotal;

  return {
    rows,
    summedCount,
    reportedTotal,
    agrees,
    disagreement: agrees
      ? null
      : `The service reports ${reportedTotal} events in total, but its own per-kind counts add up to ` +
        `${summedCount}. Both figures are shown above; neither is silently preferred, because this ` +
        'page cannot tell which one is wrong.',
  };
}

/**
 * A truncation label for a table that shows the newest `shown` of `total` rows.
 *
 * `shown > total` is impossible and is REPORTED rather than clamped: it means the two
 * endpoints disagree about how much history exists, which is exactly the kind of drift a
 * fabricated "N of M" would hide. Clamping would print a tidy sentence over a real fault.
 */
export function truncationLabel(shown: number, total: number, noun: string): { text: string; impossible: boolean } {
  if (shown > total) {
    return {
      text:
        `This page is showing ${shown} ${noun}, but the index reports only ${total}. ` +
        'The two endpoints disagree, so this count is not trustworthy.',
      impossible: true,
    };
  }
  if (shown === total) return { text: `All ${total} ${noun} the index holds.`, impossible: false };
  return { text: `The most recent ${shown} of ${total} ${noun} the index holds.`, impossible: false };
}

export interface PriceRow {
  blockNumber: number;
  /** The share price the service computed, normalised for display. A decimal string. */
  price: string;
  timestamp: number;
  /** Raw base units of the asset, as stored. Format with `amountCell`, not with `price`. */
  totalAssets: string;
  /** Raw base units of shares, as stored. */
  totalSupply: string;
}

/** The newest `limit` points of the series, newest first, for the table beside the chart. */
export function priceRows(series: PricePoint[], limit: number): PriceRow[] {
  if (limit <= 0) return [];
  return series
    .slice(-limit)
    .reverse()
    .map((point) => ({
      blockNumber: point.blockNumber,
      price: displayDecimal(point.price),
      timestamp: point.timestamp,
      totalAssets: point.totalAssets,
      totalSupply: point.totalSupply,
    }));
}
