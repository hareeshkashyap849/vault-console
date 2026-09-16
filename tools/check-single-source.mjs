/**
 * Static check: is there more than one place that knows how to count money?
 *
 * G-F3 requires two pieces of evidence that the console has no second source of truth --
 * a static check and a code review. This is the static check, and it is a program rather
 * than a procedure because "I grepped for it" is not evidence a reviewer can re-run.
 *
 * WHAT IT LOOKS FOR
 *
 * The listed patterns are the ways a second implementation of amount arithmetic appears in
 * practice. Each one is a legitimate-looking line that silently becomes a second answer to
 * "what is this number worth":
 *
 *   10 ** n / 10n ** BigInt(n)   a precision constant, which must come from the chain's
 *                                `decimals()` and nowhere else
 *   Number(<looks like an amount>)   a uint256 through a double, which is a wrong number
 *                                that prints as a plausible one
 *   toFixed / parseFloat         float rounding on money
 *   a large numeric literal      a hard-coded amount
 *   BigInt division in a component   arithmetic outside the one module allowed to do it
 *
 * The allow-list is by FILE, not by line: `src/lib/format.ts` is the single implementation
 * point named in `FRONTEND-SPEC.md` §2.2, and everything else in `src/` must route through it.
 * An allow-list by line number would break on the next edit and get widened to nothing.
 *
 * Usage:
 *
 *   node tools/check-single-source.mjs          # report violations, exit 1 if any
 *   node tools/check-single-source.mjs --list   # print the rules and the allow-list
 *   node tools/check-single-source.mjs --selftest
 *                                               # prove the checker CAN fail: write a file that
 *                                               # violates every rule, require each rule to fire,
 *                                               # then delete it. Exit 1 if a rule stays silent.
 *
 * WHY `--selftest` EXISTS
 *
 * A static checker that has never been seen to fail is a checker nobody can trust -- "no
 * violations found" and "the rule does not work" produce the same output. So `--selftest` writes
 * a probe file into `src/lib/`, runs the same scan over it, requires EVERY rule to report at
 * least once, and removes the file in a `finally` so an interrupted run cannot leave it behind.
 * The workspace has the same pattern for its markdown checker, for the same reason: it once
 * reported six false problems while missing one real one.
 *
 * The probe is written under a name that the scan treats as source and that a reader would
 * recognise, and it is deleted either way -- including when the run is interrupted, because a
 * leftover probe would be a permanent violation that looks like a real defect.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');

/** The one module allowed to know about decimals. Named in `FRONTEND-SPEC.md` §2.2. */
const AMOUNT_MODULE = 'src/lib/format.ts';

/**
 * Files permitted to contain the patterns, with the reason. Anything not listed must be
 * clean. Tests are allowed because an expectation that spells out `10n ** 18n` is the test
 * asserting a value, not a second implementation of it.
 */
const ALLOWED = new Map([
  [AMOUNT_MODULE, 'the single implementation point: parseAmount / formatBaseUnits / formatDecimal'],
]);

const isTest = (p) => /(^|\/)(test|tools)\//.test(p) || /\.test\.[cm]?[jt]s$/.test(p);

const RULES = [
  {
    id: 'precision-constant',
    // `10 ** <anything>` and not just `10 ** <digits>`: the first version of this pattern
    // required a numeric exponent, so `10 ** DECIMALS` and `10n ** 18n` slipped past it --
    // which is to say it missed the exact form the rule exists to catch. Anything raised to
    // a power of ten outside the amount module is a precision constant being computed.
    re: /\b10n?\s*\*\*/g,
    why: 'a power of ten computed outside the amount module. Decimals must be read from the chain, never assumed.',
  },
  {
    id: 'number-on-amount',
    // `Number(` applied to something amount-shaped, plus the explicit conversions.
    re: /\bNumber\(\s*(?:[\w.]*(?:[Aa]mount|[Aa]ssets|[Ss]hares|[Ss]upply|[Bb]alance|[Pp]rice)[\w.]*|BigInt\()/g,
    why: 'a uint256 routed through a double. It prints as a plausible number and is wrong.',
  },
  {
    id: 'float-money',
    re: /\.toFixed\(|parseFloat\(|Math\.round\(/g,
    why: 'float rounding on a money value.',
  },
  {
    id: 'bigint-division',
    re: /\/\s*(?:10n|BigInt\()|\bBigInt\([^)]*\)\s*\//g,
    why: 'BigInt division outside the single implementation point.',
  },
  {
    id: 'hardcoded-amount',
    re: /=\s*\d{12,}n?\b/g,
    why: 'a large numeric literal. An amount or an address written into the source instead of read.',
  },
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('Rules:');
  for (const r of RULES) console.log(`  ${r.id.padEnd(20)} ${r.why}`);
  console.log('\nAllowed files:');
  for (const [f, why] of ALLOWED) console.log(`  ${f.padEnd(24)} ${why}`);
  console.log(`\nAmount module: ${AMOUNT_MODULE}`);
  process.exit(0);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The scan, over whatever files are on disk when it is called.
 *
 * `files` and `scanned` are returned rather than counted inside the loop, because `--selftest`
 * has to report on the same scan the normal run performs instead of a second, similar one.
 */
function scan(project) {
  const files = walk(join(project, 'src')).concat(
    statSync(join(project, 'tools')).isDirectory() ? walk(join(project, 'tools')) : [],
  );

  const violations = [];
  let scanned = 0;

  for (const file of files) {
    const rel = relative(project, file).replace(/\\/g, '/');
    if (ALLOWED.has(rel) || isTest(rel)) continue;
    scanned += 1;
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(source)) !== null) {
        const line = source.slice(0, m.index).split('\n').length;
        // Skip anything inside a comment: a comment describing the rule is not a violation.
        const text = lines[line - 1] ?? '';
        const trimmed = text.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        violations.push({ rel, line, rule: rule.id, text: trimmed, why: rule.why });
      }
    }
  }

  return { files, scanned, violations };
}

function report(project, result) {
  console.log(`Scanned ${result.scanned} source files (excluding ${ALLOWED.size} allowed and all tests/tools).`);
  console.log(`Amount module: ${AMOUNT_MODULE}\n`);

  if (result.violations.length === 0) {
    console.log('No second source of truth found.');
    return true;
  }

  for (const v of result.violations) {
    console.log(`${v.rel}:${v.line}  [${v.rule}]`);
    console.log(`    ${v.text}`);
    console.log(`    -> ${v.why}\n`);
  }
  console.log(`${result.violations.length} violation(s). Route the arithmetic through ${AMOUNT_MODULE}.`);
  return false;
}

// ---- --selftest: prove every rule can fire ------------------------------------------------

if (args.includes('--selftest')) {
  /**
   * One file, one violation per rule, in the shapes the rules are written for.
   *
   * `10 ** DECIMALS` and not `10 ** 6` for the precision rule, because the rule was widened to
   * catch the symbolic form after the numeric-only version missed `10n ** 18n` -- which is to
   * say the exact form it exists to catch. A probe using only literals would not test that.
   */
  const PROBE = `export const SCALE = 10 ** DECIMALS;
export const SHARE_SCALE = 10n ** 18n;
export function toUnits(rawAssets: string): string {
  const n = Number(rawAssets);
  return (n / 1e6).toFixed(2);
}
export function scaleDown(totalAssetsRaw: bigint): bigint {
  return totalAssetsRaw / 10n ** 6n;
}
export const HARDCODED = 123456789012345;
`;
  const probePath = join(project, 'src', 'lib', 'check-single-source.probe.ts');

  let sawAllRules = false;
  try {
    writeFileSync(probePath, PROBE, 'utf8');
    console.log(`wrote ${relative(project, probePath).replace(/\\/g, '/')} (${PROBE.split('\n').length} lines)\n`);

    const result = scan(project);
    const ok = report(project, result);
    console.log('\n--- selftest verdict ---');
    console.log(`the scan must FAIL on the probe, and it ${ok ? 'DID NOT (a rule is dead)' : 'did'}`);

    const fired = new Set(result.violations.map((v) => v.rule));
    const silent = RULES.filter((r) => !fired.has(r.id));
    for (const rule of RULES) {
      console.log(`  ${fired.has(rule.id) ? 'fired  ' : 'SILENT '} ${rule.id}`);
    }
    // Every rule must fire on a file built to trip it, and the probe must produce only
    // violations from the probe -- a real violation found alongside it is information, not a
    // failure of the selftest, so it is reported rather than counted.
    const foreign = result.violations.filter((v) => !v.rel.includes('check-single-source.probe'));
    sawAllRules = !ok && silent.length === 0;
    console.log(`\n${sawAllRules ? 'PASS' : 'FAIL'}: ${RULES.length - silent.length}/${RULES.length} rules fired on a file built to trip them`);
    if (foreign.length > 0) {
      console.log(`note: ${foreign.length} violation(s) in other files -- see the list above`);
    }
  } finally {
    rmSync(probePath, { force: true });
    console.log(`removed ${relative(project, probePath).replace(/\\/g, '/')}`);
  }

  process.exit(sawAllRules ? 0 : 1);
}

// ---- the normal run ------------------------------------------------------------------------

const result = scan(project);
process.exit(report(project, result) ? 0 : 1);
