/**
 * Amount formatting, in BigInt, with the two formats kept apart.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT THREE LINES IN A COMPONENT
 *
 * A number that is formatted in two places will eventually be formatted two ways. The
 * sibling wallet dApp learned that when its "Max" button filled raw base units into a
 * field that expected a decimal string: the transaction was mined and reverted. The fix
 * there was to have exactly one place that knows decimals, and this is that place for
 * the console.
 *
 * THE TWO FORMATS -- THE BUG THIS MODULE WAS REWRITTEN FOR
 *
 * The index service hands out amounts in two different shapes, and the first version of
 * this file ran both through one function:
 *
 *   RAW BASE UNITS      `totalAssets`, `totalSupply`, `event.assets` -- uint256 integers,
 *                       exactly as the chain holds them. `src/api/price.ts` in the service
 *                       says so: "RAW uint256 values in BASE UNITS, exactly as".
 *                       One whole share is `1000000000000000000`, not `1`.
 *
 *   DECIMAL STRINGS     `price` and the candle OHLC values -- already divided by the
 *                       asset's decimals and printed, so a whole share is `"1.1"`.
 *
 * So the old `displayAmount('849930996648200851546', 18)` printed
 * `849,930,996,648,200,851,546` -- a raw base-unit integer, which is item 2 on the list of
 * things this interface must never show. It happened to LOOK right for `totalAssets`,
 * because this vault's asset has 6 decimals and `934924100` reads as a plausible grouped
 * number; it would have been visibly wrong for an 18-decimal asset.
 *
 * `displayBaseUnits` and `displayDecimal` are now separate functions with separate names,
 * because the two are not interchangeable and the call site is where the difference has to
 * be visible. One function serving both is what made the mistake possible.
 *
 * WHAT IS ALLOWED TO GO THROUGH Number
 *
 * Block numbers, timestamps, counts, decimal-place counts -- all genuinely small or
 * genuinely counted. NOT token amounts: `849930996648200851546` becomes
 * `849930996648200900000` as a double, which is a wrong number that looks right. So
 * amounts stay strings end to end, and this module is the only thing that takes them apart.
 */

/** 10n ** BigInt(n), rejecting nonsense rather than producing it. */
function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new Error(`decimals must be a non-negative integer, got ${n}`);
  return 10n ** BigInt(n);
}

/**
 * A decimal string to base units, exactly.
 *
 * REJECTS MORE FRACTION DIGITS THAN THE ASSET HAS rather than truncating. Truncation here
 * would silently move a displayed amount by a base unit; and a caller that passes more
 * digits than the asset has is a caller that disagrees with the chain about precision,
 * which is worth stopping for.
 *
 * Input is trimmed first, so a value carrying stray whitespace is accepted.
 */
export function parseAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(value)}`);
  const sign = m[1] ?? '';
  const whole = m[2] ?? '';
  const fraction = m[3] ?? '';
  if (fraction.length > decimals) {
    throw new Error(`amount ${value} has ${fraction.length} fraction digits but the asset has ${decimals}`);
  }
  const magnitude = BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return sign === '-' ? -magnitude : magnitude;
}

/**
 * A RAW BASE-UNIT string, as the chain holds it, to a decimal string.
 *
 * THE FUNCTION `totalAssets` AND `totalSupply` NEED. Its input is an integer string, not a
 * decimal one, and feeding it a decimal string is a category error that `toBigInt` below
 * reports loudly rather than rounding away.
 */
export function formatBaseUnits(baseUnits: string | bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const value = typeof baseUnits === 'bigint' ? baseUnits : toBigInt(baseUnits, 'base units');
  return formatBigInt(value, decimals);
}

/** Base units already held as a bigint, to a decimal string with trailing zeros trimmed. */
export function formatBigInt(baseUnits: bigint, decimals: number): string {
  const scale = pow10(decimals);
  const negative = baseUnits < 0n;
  const magnitude = negative ? -baseUnits : baseUnits;
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = fraction === '' ? whole.toString() : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * A DECIMAL string the service already formatted, normalised for display.
 *
 * `price` and the candle values arrive in this shape. Trailing zeros are trimmed so
 * `"1.10"` and `"1.1"` print the same way -- the four values of one candle can be spelled
 * differently by the service and are displayed as one candle, so they have to agree.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It cannot tell `"934924100"` (0.9349241 shares) from `"934924100"` (934.9241 USDC).
 * Those are the same string, and no amount of shape-checking separates them -- the
 * difference is which FIELD it came from, which only the caller knows. So this function
 * does not try, and it accepts a string with no decimal point, because a price of `"2"` is
 * perfectly legal.
 *
 * The protection against mixing the two up lives instead in `formatBaseUnits`, which DOES
 * reject a decimal string: a value with a fractional part did not come from a uint256
 * column, so that check is sound. Together the pair is asymmetric on purpose -- one refuses
 * the other's input, and the direction that can be checked is the direction that is.
 */
export function formatDecimal(value: string): string {
  const trimmed = value.trim();
  // `\.\d*` and NOT `\.\d+`, so that a trailing dot is ACCEPTED here and normalised below,
  // the same way `parseAmount` accepts `'7.'`. The first version required a digit after the
  // dot, which meant `'1.'` was rejected by this guard and the normalisation on the next
  // line never ran at all -- dead code that a test caught.
  if (!/^-?\d+(\.\d*)?$/.test(trimmed)) {
    throw new Error(`not a formatted decimal string: ${JSON.stringify(value)}`);
  }
  // TWO STEPS, IN THIS ORDER, and getting here took four attempts -- recorded because each
  // wrong version looked obviously right:
  //
  //   ` (\d+?)0+$ `   lazy with an anchored `0+` can only give the tail a SHORT match, so
  //                   `'2.000'` -> `'2.0'` and `'10.00'` -> `'10.0'`.
  //   ` (\d+)0+$ `    greedy takes every digit, leaving `0+` nothing: `'2.000'` -> `'2.00'`.
  //   ` (\d*?)0+$ `   right for `'1.1000'`, but the group can match empty, so a tail of ALL
  //                   zeros trims one digit too far and leaves the dot: `'2.000'` -> `'2.'`.
  //   ` (\d*?)0+$|(\.)$ `  the alternation above does NOT fix that, which is the
  //                   counter-intuitive part: on `'2.000'` the engine matches `'.000'` with
  //                   the FIRST alternative (group 1 = `'.'`), so the second alternative --
  //                   the one meant to catch a stranded dot -- is never reached, and the
  //                   result is still `'2.'`.
  //
  // So the stranded dot is removed by a SECOND pass rather than by an alternative branch.
  // Order matters: trim the zeros first, then the dot. `'1.1'` is untouched by either.
  //
  // What caused the ORIGINAL bug was neither quantifier nor ordering, but the dot not being
  // required at all: the first version's pattern could match a dotless string, so it ate the
  // trailing zeros of `'934924100'` and returned `'9349241'`. The literal `.` is what stops
  // that, and it is why `'934924100'` survives both passes here.
  return trimmed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function toBigInt(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `${JSON.stringify(value)} is not ${label}: expected a raw integer string, as the service ` +
        'documents. A decimal string here means the caller used the wrong formatter.',
    );
  }
  return BigInt(trimmed);
}

/** Group the integer part only: `1234.5678` -> `1,234.5678`. */
export function groupThousands(decimal: string): string {
  const negative = decimal.startsWith('-');
  const body = negative ? decimal.slice(1) : decimal;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot);
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${rest}`;
}

/**
 * A RAW BASE-UNIT amount, ready to print.
 *
 * Returns the input unchanged when it cannot be parsed. That is deliberate: an unparseable
 * amount means the service and the console disagree about the shape of the data, and
 * showing the raw string is more useful to whoever has to debug it than showing "—" and
 * hiding the evidence.
 */
export function displayBaseUnits(value: string | null, decimals: number, opts: { group?: boolean } = {}): string {
  if (value === null) return '—';
  try {
    const formatted = formatBaseUnits(value, decimals);
    return opts.group === false ? formatted : groupThousands(formatted);
  } catch {
    return value;
  }
}

/** A DECIMAL amount the service already formatted, ready to print. */
export function displayDecimal(value: string | null, opts: { group?: boolean } = {}): string {
  if (value === null) return '—';
  try {
    const formatted = formatDecimal(value);
    return opts.group === false ? formatted : groupThousands(formatted);
  } catch {
    return value;
  }
}

/**
 * A share of a total, as a percentage string.
 *
 * IN BIGINT, because both sides are huge. `Number(part) / Number(total) * 100` would
 * compute the right percentage here only by luck: it loses precision in both
 * conversions, and the error grows with the magnitudes.
 *
 * Both inputs are RAW BASE UNITS. Decimal places cancel in a ratio, so this one function
 * is genuinely format-independent -- which is why it did not need the split the display
 * functions got, and the reason is written down rather than left to be re-derived.
 *
 * Two decimal places, truncated rather than rounded -- this is a display figure beside an
 * exact one, and truncating means it can never read as more than the truth.
 */
export function sharePercent(part: string, total: string): string | null {
  let p: bigint;
  let t: bigint;
  try {
    p = BigInt(part);
    t = BigInt(total);
  } catch {
    return null;
  }
  if (t === 0n) return null;
  const basisPoints = (p * 10000n) / t; // hundredths of a percent
  const whole = basisPoints / 100n;
  const frac = basisPoints % 100n;
  return `${whole}.${frac.toString().padStart(2, '0')}%`;
}

/** A unix-seconds timestamp as a compact local time. Server and client must agree. */
export function timeLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A duration in seconds as "3m 20s", for lag and staleness. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Shorten an address for a table cell, keeping enough to recognise it. */
export function shortenAddress(address: string | null): string {
  if (!address) return '—';
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
