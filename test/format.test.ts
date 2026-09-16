/**
 * Amount formatting, in BigInt, against values the code cannot have invented.
 *
 * WHY THE EXPECTATIONS ARE SHAPED THE WAY THEY ARE
 *
 * The rule these tests enforce is "an amount is never routed through a JavaScript number".
 * A test that asserts `formatBigInt(1_100_000n, 6) === '1.1'` proves almost nothing: that
 * value is far below the precision where doubles break, so it would pass just as happily
 * against a `Number`-based implementation.
 *
 * So the values below are the vault's REAL figures, and they sit past `Number.MAX_SAFE_INTEGER`
 * (9007199254740991):
 *
 *   totalSupply   849930996648200851546   (raw base units, 18 decimals)
 *   totalAssets          934924100        (raw base units, 6 decimals)
 *
 * The 18-decimal share count is the load-bearing case. Through a double it becomes
 * 849930996648200900000 -- wrong by 4.9e13 base units, with no error and no warning. Every
 * assertion that touches it is one a float implementation cannot pass.
 *
 * THE TWO FORMATS ARE TESTED AS TWO FORMATS
 *
 * The service answers with raw base units for `totalAssets`/`totalSupply` and with
 * already-formatted decimal strings for `price` and candle OHLC. The first version of the
 * module had one display function for both, and it printed the share supply as the raw
 * integer `849,930,996,648,200,851,546`. The tests below therefore check not only that each
 * formatter is right, but that each one REJECTS the other's input -- which is what makes the
 * mistake loud instead of plausible.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  displayBaseUnits,
  displayDecimal,
  duration,
  formatBaseUnits,
  formatBigInt,
  formatDecimal,
  groupThousands,
  parseAmount,
  sharePercent,
  shortenAddress,
  timeLabel,
} from '../src/lib/format.ts';

describe('parseAmount -- decimal string to base units', () => {
  it('reads a decimal string as exact base units', () => {
    assert.equal(parseAmount('1', 6), 1_000_000n);
    assert.equal(parseAmount('1.1', 6), 1_100_000n);
    assert.equal(parseAmount('0.000001', 6), 1n);
    assert.equal(parseAmount('10000', 6), 10_000_000_000n);
  });

  it('handles a fraction shorter than the asset has decimals', () => {
    // '1.5' at 18 decimals is 1.5e18, not 1.05e18 and not 15e18. The padEnd is the only
    // thing standing between a user's "1.5" and a hundredfold error.
    assert.equal(parseAmount('1.5', 18), 1_500_000_000_000_000_000n);
    assert.equal(parseAmount('0.1', 6), 100_000n);
  });

  it('treats a trailing dot as a whole number', () => {
    assert.equal(parseAmount('7.', 6), 7_000_000n);
  });

  it('carries the sign', () => {
    assert.equal(parseAmount('-1.5', 18), -1_500_000_000_000_000_000n);
  });

  it('REFUSES more fraction digits than the asset has, rather than truncating', () => {
    // Truncation would silently move the displayed amount. A caller passing 7 fraction
    // digits for a 6-decimal asset disagrees with the chain about precision.
    assert.throws(() => parseAmount('1.0000001', 6), /has 7 fraction digits but the asset has 6/);
  });

  it('rejects anything that is not a plain decimal', () => {
    // NOTE: input is trimmed first, so '  6  ' and '1 ' are ACCEPTED -- a value pasted from
    // a spreadsheet cell carries whitespace. `'  '` trims to the empty string and is
    // rejected, which is the case that matters.
    for (const bad of ['', 'abc', '1e6', '0x10', '1,000', '1.2.3', '  ', '+1', '.5', '1..2']) {
      assert.throws(() => parseAmount(bad, 6), /not a decimal amount/, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it('accepts surrounding whitespace rather than making every caller trim', () => {
    assert.equal(parseAmount('  6  ', 6), 6_000_000n);
    assert.equal(parseAmount('1 ', 6), 1_000_000n);
  });

  it('rejects a decimals count that is not a non-negative integer', () => {
    // The first check in the function, before the regex runs -- so an integer input with a
    // bad `decimals` still throws rather than quietly succeeding.
    for (const bad of [-1, 1.5, 0.5, NaN]) {
      assert.throws(() => parseAmount('1', bad), /non-negative integer/, `decimals=${bad} must be rejected`);
      assert.throws(() => parseAmount('1.5', bad), /non-negative integer/, `decimals=${bad} must be rejected`);
    }
  });
});

describe('formatBigInt / formatBaseUnits -- RAW BASE UNITS to a decimal string', () => {
  it('converts the vault\'s real share supply, which no double can hold', () => {
    const supply = '849930996648200851546';
    assert.equal(formatBaseUnits(supply, 18), '849.930996648200851546');

    // The failure this guards, stated as a number: the double nearest to `supply` is not
    // `supply`, and it is what a Number-based implementation would print.
    assert.notEqual(String(Number(supply)), supply);
    assert.equal(String(Number(supply)), '849930996648200900000');
  });

  it('trims trailing zeros so one number prints one way', () => {
    assert.equal(formatBigInt(1_100_000n, 6), '1.1');
    assert.equal(formatBigInt(1_000_000n, 6), '1');
    assert.equal(formatBigInt(1n, 6), '0.000001');
    assert.equal(formatBigInt(0n, 18), '0');
  });

  it('pads a fraction correctly at 18 decimals', () => {
    assert.equal(formatBigInt(1_500_000_000_000_000_000n, 18), '1.5');
    assert.equal(formatBigInt(909_090_905_603_043_012n, 18), '0.909090905603043012');
  });

  it('keeps the sign', () => {
    assert.equal(formatBigInt(-1_100_000n, 6), '-1.1');
  });

  it('handles a magnitude AND a nonzero tail, the worst case for a double', () => {
    assert.equal(formatBigInt(849_930_996_648_200_851_546n, 18), '849.930996648200851546');
  });

  it('accepts a bigint as well as a string, without changing the answer', () => {
    assert.equal(formatBaseUnits(849_930_996_648_200_851_546n, 18), '849.930996648200851546');
    assert.equal(formatBaseUnits('849930996648200851546', 18), '849.930996648200851546');
  });

  it('REFUSES a decimal string -- that input means the caller grabbed the wrong formatter', () => {
    // This is the guard that turns the original silent bug into a loud one. `totalAssets`
    // and `totalSupply` are raw integers; a value with a decimal point did not come from
    // them, and `BigInt('1.1')` would have thrown something about the string "1.1" that
    // never mentions formatters.
    assert.throws(() => formatBaseUnits('1.1', 6), /is not base units: expected a raw integer string/);
    assert.throws(() => formatBaseUnits('849.930996648200851546', 18), /is not base units/);
    assert.throws(() => formatBaseUnits('', 6), /is not base units/);
  });

  it('rejects a decimals count that is not a non-negative integer', () => {
    assert.throws(() => formatBaseUnits('1', -1), /non-negative integer/);
    assert.throws(() => formatBigInt(1n, 1.5), /non-negative integer/);
  });
});

describe('formatDecimal -- an ALREADY-formatted decimal string', () => {
  it('passes a price through unchanged', () => {
    assert.equal(formatDecimal('1.1'), '1.1');
    assert.equal(formatDecimal('0.909090905603043012'), '0.909090905603043012');
  });

  it('normalises trailing zeros so one candle\'s four values print alike', () => {
    // The service can spell the four values of a flat candle '1.10' and '1.1'. They are the
    // same price and must render the same way.
    assert.equal(formatDecimal('1.10'), '1.1');
    assert.equal(formatDecimal('1.1000'), '1.1');
    assert.equal(formatDecimal('1.'), '1');
    assert.equal(formatDecimal('2.000'), '2');
  });

  it('tolerates surrounding whitespace', () => {
    assert.equal(formatDecimal('  1.1  '), '1.1');
  });

  it('passes a whole-number price through, because "2" is a legal price', () => {
    // This is the case that stops `formatDecimal` from being able to reject a raw base-unit
    // integer by shape: `"2"` and `"934924100"` are both plain integers, and both are
    // legitimate `price` values. Guarding on digit count would be an arbitrary threshold
    // pretending to be a check, so this function does not pretend.
    assert.equal(formatDecimal('2'), '2');
    assert.equal(formatDecimal('934924100'), '934924100');
  });

  it('rejects anything that is not a decimal', () => {
    for (const bad of ['', 'abc', '1e6', '0x10', '1.2.3', '--1', '1-', '1.1.1']) {
      assert.throws(() => formatDecimal(bad), /not a formatted decimal string/, `expected ${bad} to be rejected`);
    }
  });

  it('THE PAIR IS ASYMMETRIC ON PURPOSE, and the asymmetry is the protection', () => {
    // `formatBaseUnits` rejects a decimal string, because a uint256 column cannot produce
    // one -- that check is sound and it is the one that catches the original bug.
    assert.throws(() => formatBaseUnits('849.930996648200851546', 18), /is not base units/);
    // `formatDecimal` cannot make the mirror check, because `"2"` is a legal price and also
    // a legal base-unit count. Said out loud here so that nobody later "fixes" the
    // asymmetry by inventing a threshold.
    assert.equal(formatDecimal('2'), '2');
    assert.equal(formatBaseUnits('2', 18), '0.000000000000000002');
  });
});

describe('groupThousands', () => {
  it('groups the integer part only', () => {
    assert.equal(groupThousands('1234.5678'), '1,234.5678');
    assert.equal(groupThousands('934924100'), '934,924,100');
    assert.equal(groupThousands('849930996648200851546'), '849,930,996,648,200,851,546');
  });

  it('leaves short numbers and negatives alone', () => {
    assert.equal(groupThousands('999'), '999');
    assert.equal(groupThousands('1000'), '1,000');
    assert.equal(groupThousands('-1234.5'), '-1,234.5');
  });

  it('does not group the fraction', () => {
    assert.equal(groupThousands('1.123456789012345678'), '1.123456789012345678');
  });
});

describe('displayBaseUnits -- the chain\'s raw amounts, ready for the page', () => {
  it('renders the chained totalAssets in whole units', () => {
    // 934924100 base units at 6 decimals is 934.9241 USDC. NOTE: this is the assertion that
    // shows the original bug plainly -- the old single-formatter version printed
    // '934,924,100' (the raw integer) and it looked entirely plausible.
    assert.equal(displayBaseUnits('934924100', 6), '934.9241');
    assert.equal(displayBaseUnits('934924100', 6, { group: false }), '934.9241');
  });

  it('groups the integer part of a large raw amount', () => {
    // A raw amount whose WHOLE-UNIT value is large: 934,924,100 USDC at 6 decimals.
    assert.equal(displayBaseUnits('934924100000000', 6), '934,924,100');
  });

  it('renders the 19-digit share supply as SHARES, not as raw base units', () => {
    // THE REGRESSION TEST. The buggy version printed
    // '849,930,996,648,200,851,546' here -- the raw uint256, which is exactly the thing
    // this interface must never show.
    assert.equal(displayBaseUnits('849930996648200851546', 18), '849.930996648200851546');
    assert.notEqual(displayBaseUnits('849930996648200851546', 18), '849,930,996,648,200,851,546');
  });

  it('can be asked for the ungrouped form', () => {
    assert.equal(displayBaseUnits('934924100000000', 6, { group: false }), '934924100');
  });

  it('shows an em dash for null -- an empty vault has no price, and 0 is a claim', () => {
    assert.equal(displayBaseUnits(null, 6), '—');
  });

  it('returns an unparseable amount UNCHANGED rather than hiding the evidence', () => {
    // Showing "—" would hide the disagreement between service and console. The raw string
    // is what whoever debugs it needs to see.
    assert.equal(displayBaseUnits('not-a-number', 6), 'not-a-number');
    assert.equal(displayBaseUnits('1.1', 6), '1.1', 'a decimal string is wrong here, and is shown raw rather than mangled');
  });
});

describe('displayDecimal -- the service\'s formatted amounts, ready for the page', () => {
  it('renders a price', () => {
    assert.equal(displayDecimal('1.1'), '1.1');
  });

  it('renders a candle value with an 18-digit tail', () => {
    assert.equal(displayDecimal('0.909090905603043012'), '0.909090905603043012');
  });

  it('groups by default and can be asked not to -- even for a uint256-shaped value', () => {
    // `displayDecimal` cannot DETECT a wrong-format input, and does not pretend to: a
    // uint256-shaped integer is a well-formed decimal string. What it guarantees is that it
    // never mangles one -- the digits it was given are the digits it prints, grouped or not.
    assert.equal(displayDecimal('849930996648200851546'), '849,930,996,648,200,851,546');
    assert.equal(displayDecimal('849930996648200851546', { group: false }), '849930996648200851546');
  });

  it('shows an em dash for null', () => {
    assert.equal(displayDecimal(null), '—');
  });

  it('returns a malformed value unchanged, so the disagreement stays visible', () => {
    assert.equal(displayDecimal('not-a-price'), 'not-a-price');
  });
});

describe('sharePercent', () => {
  it('computes a percentage in BigInt for magnitudes a double cannot divide', () => {
    // The vault's real gross flows: 315,199,997 withdrawn against 1,200,124,097 deposited.
    assert.equal(sharePercent('315199997', '1200124097'), '26.26%');
  });

  it('truncates rather than rounds, so it can never read as more than the truth', () => {
    // 2/3 is 66.666...%; rounding would give 66.67%, which is above the true value.
    assert.equal(sharePercent('2', '3'), '66.66%');
  });

  it('returns null when there is no total to take a share of', () => {
    assert.equal(sharePercent('5', '0'), null);
  });

  it('returns null for values that are not integers', () => {
    // Both inputs are raw base units. A decimal string here is a caller error, and the
    // result is null rather than a quietly truncated percentage.
    assert.equal(sharePercent('1.5', '3'), null);
    assert.equal(sharePercent('nope', '3'), null);
    assert.equal(sharePercent('1', '3.5'), null);
  });

  it('survives 18-decimal share counts', () => {
    assert.equal(sharePercent('424965498324100425773', '849930996648200851546'), '50.00%');
    // One base unit out of a whole supply truncates to zero, which is honest: at two decimal
    // places it genuinely is zero percent.
    assert.equal(sharePercent('1', '849930996648200851546'), '0.00%');
  });
});

describe('timeLabel and duration', () => {
  it('formats a timestamp as zero-padded local HH:MM', () => {
    // Local time, so the assertion is built from the same Date rather than a fixed string --
    // a hard-coded expectation would fail on any machine not in this timezone.
    const unix = 1789542264;
    const d = new Date(unix * 1000);
    const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    assert.equal(timeLabel(unix), expected);
    assert.equal(timeLabel(unix).length, 5);
  });

  it('formats durations at each unit boundary', () => {
    assert.equal(duration(0), '0s');
    assert.equal(duration(59), '59s');
    assert.equal(duration(60), '1m');
    assert.equal(duration(61), '1m 1s');
    assert.equal(duration(599), '9m 59s');
    assert.equal(duration(3600), '1h 0m');
    assert.equal(duration(5719), '1h 35m');
  });

  it('shows an em dash for an unknown duration', () => {
    assert.equal(duration(null), '—');
  });
});

describe('shortenAddress', () => {
  it('keeps enough of an address to recognise it', () => {
    // First 6 and last 4, so two addresses sharing a prefix stay distinguishable.
    assert.equal(shortenAddress('0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'), '0x9fE4…a6e0');
    assert.equal(shortenAddress('0x5FbDB2315678afecb367f032d93F642f64180aa3'), '0x5FbD…0aa3');
  });

  it('handles null and short input without throwing', () => {
    assert.equal(shortenAddress(null), '—');
    assert.equal(shortenAddress(''), '—');
    assert.equal(shortenAddress('0x1234'), '0x1234');
  });
});
