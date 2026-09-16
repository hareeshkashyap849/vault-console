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
 * point named in `前端规格.md` §2.2, and everything else in `src/` must route through it.
 * An allow-list by line number would break on the next edit and get widened to nothing.
 *
 * Usage:
 *
 *   node tools/check-single-source.mjs          # report violations, exit 1 if any
 *   node tools/check-single-source.mjs --list   # print the rules and the allow-list
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');

/** The one module allowed to know about decimals. Named in `前端规格.md` §2.2. */
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

console.log(`Scanned ${scanned} source files (excluding ${ALLOWED.size} allowed and all tests/tools).`);
console.log(`Amount module: ${AMOUNT_MODULE}\n`);

if (violations.length === 0) {
  console.log('No second source of truth found.');
  process.exit(0);
}

for (const v of violations) {
  console.log(`${v.rel}:${v.line}  [${v.rule}]`);
  console.log(`    ${v.text}`);
  console.log(`    -> ${v.why}\n`);
}
console.log(`${violations.length} violation(s). Route the arithmetic through ${AMOUNT_MODULE}.`);
process.exit(1);
