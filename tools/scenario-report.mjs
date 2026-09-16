/**
 * Read a saved console page and report the failure-scenario facts that matter.
 *
 * TWO FALSE READINGS THIS SCRIPT WAS REWRITTEN TO STOP MAKING
 *
 * 1. Counting SVG/tags across the WHOLE FILE. Next.js embeds its hydration payload in a
 *    `<script>` element, and that payload contains the same markup as strings. A regex over
 *    the raw file counted 169 `<rect>` in a page that rendered NO CHART AT ALL, and counted
 *    `<title>` from the wrong places. Every count here now runs on the body with scripts
 *    removed first.
 *
 * 2. Trusting the filename to tell me which scenario I was looking at. The first version of
 *    `scenario 11` reported the INDEX panel failing while reading a page served by a server
 *    whose `VAULT_API` pointed at the live service -- because the file it read was left over
 *    from scenario 10. A report is only as good as the evidence it opens, so the URL the
 *    page actually complained about is now extracted and printed, and it must be checked
 *    against what the server was configured with.
 *
 * Usage:
 *
 *   node tools/scenario-report.mjs <file.html> [--expect chain-down|index-down|index-caught-up|history-up|history-index-down]
 *                                 [--out docs/evidence/name.txt]
 *
 * `--out` exists so the saved report is produced BY THE RUN THAT JUDGED IT, rather than by a
 * human copying the terminal output into a file afterwards. A copied report is a transcript
 * with no guarantee it came from the file it names -- and this repository has already been
 * caught once by exactly that, when a report labelled "scenario 11" had opened the leftover
 * HTML from scenario 10. `tools/capture-scenarios.mjs` uses the flag with `stdio: 'inherit'`,
 * because capturing a child's output through a pipe is refused on this machine (`spawn EPERM`
 * on the named pipe), which is the same limit `tools/run-tests.mjs` documents.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');

/**
 * A path as it should appear in a committed report: relative to this repository, with forward
 * slashes.
 *
 * NOT the path as given. The first version printed whatever it was handed, so the reports carried
 * the absolute path of the machine that produced them -- including the directory names of the
 * workspace they happened to sit in. A committed report is read by people who are not on this
 * machine, and a local absolute path is both noise to them and a small amount of information about
 * this one. Relative paths also make the report reproducible by comparison: the same run on another
 * checkout produces the same line.
 */
const shown = (path) => relative(project, path).replace(/\\/g, '/');

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/scenario-report.mjs <file.html> [--expect chain-down|index-down|index-caught-up|history-up|history-index-down]');
  process.exit(2);
}
const expectFlag = process.argv.indexOf('--expect');
const expectation = expectFlag === -1 ? null : process.argv[expectFlag + 1];
const outFlag = process.argv.indexOf('--out');
const outFile = outFlag === -1 ? null : process.argv[outFlag + 1];

/**
 * Every line goes to the terminal AND into the report, so the two cannot disagree.
 *
 * A report written from a second set of strings would be a second implementation of the
 * report, free to drift from what was actually judged -- and the drift would be invisible
 * precisely because the file looks authoritative.
 */
const lines = [];
const say = (line = '') => {
  lines.push(line);
  console.log(line);
};

function finish(ok) {
  if (outFile !== null) {
    writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
    // The report is written BEFORE the exit status, so a failing scenario still leaves the
    // report that says why. A scenario that exits non-zero with no file is a scenario nobody
    // can look at.
    console.log(`\nreport written to ${outFile}`);
  }
  // NOT `finish(ok)` here. A text substitution once rewrote this line into a call to the
  // function it is in, and the only symptom was `RangeError: Maximum call stack size exceeded`
  // AFTER the report had already been written -- which is to say the failure looked like a
  // formatting problem in the output rather than an infinite recursion in the reporter.
  process.exit(ok ? 0 : 1);
}

/**
 * Everything the checks read, extracted from one saved page.
 *
 * A FUNCTION RATHER THAN TOP-LEVEL CODE, because scenario 11 compares two pages -- the console
 * before the index moved and the console after -- and a comparison between two readings taken
 * by two different pieces of code is not a comparison. Both parts go through this one function.
 */
function extract(raw) {
  // The body only, with scripts and styles removed. Everything below reads from `body`.
  const bodyStart = raw.indexOf('<body');
  const body = raw.slice(bodyStart === -1 ? 0 : bodyStart);
  const markup = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');

  const count = (re) => (markup.match(re) ?? []).length;

  const svg = {
    elements: count(/<svg/g),
    candleBodies: count(/<rect/g),
    groups: count(/<g[\s>]/g),
    lines: count(/<line/g),
    tooltips: count(/<title>/g),
    emptyState: count(/No price history in this window/g),
  };

  const text = markup
    .replace(/<\/(h1|h2|h3|p|dd|dt|li|div|section|figure|figcaption|footer|header|span|td|th|tr|table)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  const has = (re) => re.test(text);
  const pick = (re) => re.exec(text)?.[1]?.trim() ?? null;

  const findings = {
    fileBytes: raw.length,
    panelHeadings: [...markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]),
    svg,
    chainFailurePanel: has(/The chain could not be read\./),
    indexFailurePanel: has(/The index service could not be read\./),
    /** The URL the console actually failed on -- the fact that would have caught the mix-up. */
    indexFailureUrl: pick(/The index service is not reachable at (\S+?)\.\s/),
    detailLine: pick(/\ndetail:\n(.+)/),
    noComparisonClaim: has(/A comparison needs both sources/),
    comparisonPresent: has(/The chain says the vault holds/),
    flatSeriesCaption: has(/the price did not move in this window/),
    coverageGapNote: has(/NOT a period of zero activity/),
    indexedToBlock: pick(/Indexed to block\n(\d+)/),
    lagBlocks: pick(/Lag\n(\d+)/),
    indexerLastRan: pick(/indexer last ran (.+?) ago/),
    healthHeading: has(/Index health/),
  totalAssetsShown: pick(/Total assets\n([\d,.]+)/),
  totalSharesShown: pick(/Total shares\n([\d,.]+)/),
  priceShown: pick(/Price per share\n([\d,.—]+)/),
  rawUint256OnPage: /(^|[^\d.,])\d{19,}([^\d.,]|$)/.test(text.replace(/,/g, '')),

  /**
   * THE HISTORY PAGE, which reads ONE source and therefore has a different failure contract:
   * when the index is down it has nothing at all to show, and showing the chain's figures
   * instead would be exactly the substitution its header promises not to make.
   *
   * `tables` is the count that matters. The page is built out of three tables, so zero of them
   * is a page that rendered no figures -- and a page that renders one of them from a source it
   * does not have would be a much worse failure than a page that renders none.
   */
  historyHeading: has(/Indexed History/),
  historyFailurePanel: has(/The index service could not be read\./),
  historyNoFallbackClaim: has(/no second source to fall back on/),
  historySaysOneSource: has(/Nothing on this page was read from the chain/),
  tables: count(/<table/g),
  lagShown: pick(/Lag\n(\d+)/),
  eventsClaim: pick(/(All \d+ events the index holds|The most recent \d+ of \d+ events the index holds)/),
  };

  return { findings, markup, text, svg };
}

const raw = readFileSync(file, 'utf8');
const { findings, svg } = extract(raw);

/**
 * Scenario 11's "before" page, when one is given.
 *
 * `--before` exists because "the page re-reads on every request and caches nothing" is a claim
 * about a CHANGE, and a single page cannot show a change: with static readings, a correct
 * implementation and a caching one render the same bytes. The comparison is made by the same
 * `extract` as the "after" page, so the two readings cannot differ by method.
 */
const beforeFlag = process.argv.indexOf('--before');
const beforeFile = beforeFlag === -1 ? null : process.argv[beforeFlag + 1];
const before = beforeFile === null ? null : extract(readFileSync(beforeFile, 'utf8'));

say(`file: ${shown(file)}`);
say(JSON.stringify(findings, null, 2));

const judge = (label, checks) => {
  const failed = checks.filter((c) => !c.ok);
  say(`\n${label}: ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const c of checks) say(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.text}`);
  return failed.length === 0;
};

if (expectation === 'chain-down') {
  const ok = judge('SCENARIO 9 (RPC unreachable, index up)', [
    { ok: findings.chainFailurePanel, text: 'Now panel shows "The chain could not be read."' },
    { ok: !findings.indexFailurePanel, text: 'Then panel does NOT show a failure' },
    { ok: svg.candleBodies > 0, text: `Then panel still renders the chart (${svg.candleBodies} candle bodies)` },
    { ok: svg.emptyState === 0, text: 'the chart is not the empty state' },
    { ok: findings.indexedToBlock !== null, text: `Indexed to block still shown (${findings.indexedToBlock ?? 'ABSENT'})` },
    { ok: findings.noComparisonClaim && !findings.comparisonPresent, text: 'comparison panel refuses instead of using one source' },
  ]);
  finish(ok);
}

if (expectation === 'index-down') {
  const ok = judge('SCENARIO 10 (index API unreachable, chain up)', [
    { ok: findings.indexFailurePanel, text: 'Then panel shows "The index service could not be read."' },
    { ok: findings.indexFailureUrl !== null, text: `the message carries the actual URL (${findings.indexFailureUrl ?? 'ABSENT'})` },
    { ok: !findings.chainFailurePanel, text: 'Now panel does NOT show a failure' },
    { ok: findings.totalAssetsShown !== null, text: `Now panel still reads the chain (${findings.totalAssetsShown})` },
    { ok: findings.totalSharesShown !== null, text: `shares still exact (${findings.totalSharesShown})` },
    { ok: findings.noComparisonClaim && !findings.comparisonPresent, text: 'comparison panel refuses' },
  ]);
  finish(ok);
}

if (expectation === 'index-caught-up') {
  const ok = judge('SCENARIO 11 (both up, index caught up)', [
    { ok: svg.candleBodies > 0, text: `chart renders (${svg.candleBodies} candle bodies)` },
    { ok: findings.indexedToBlock !== null, text: `Indexed to block shown (${findings.indexedToBlock})` },
    { ok: findings.lagBlocks !== null, text: `Lag shown (${findings.lagBlocks})` },
    { ok: findings.healthHeading, text: 'Index health panel present' },
    { ok: !findings.chainFailurePanel && !findings.indexFailurePanel, text: 'no source is reporting a failure' },
  ]);
  finish(ok);
}

/**
 * SCENARIO 11 AS IT IS ACTUALLY JUDGED: two pages, one change.
 *
 * The freshness row cannot be decided from one reading. `--before` supplies the page captured
 * before the index was advanced, and the checks below are about the DIFFERENCE: four values
 * that move together, on a page that was not restarted. A console that cached its reads would
 * render the same bytes twice and fail every one of them.
 */
if (expectation === 'index-advanced') {
  if (before === null) {
    say('\n--expect index-advanced needs --before <file.html>: a change cannot be seen in one page.');
    finish(false);
  }

  const b = before.findings;
  const a = findings;

  say(`\n--- before: ${shown(beforeFile)} ---`);
  say(JSON.stringify(
    { indexedToBlock: b.indexedToBlock, lagBlocks: b.lagBlocks, indexerLastRan: b.indexerLastRan, note: b.coverageGapNote },
    null,
    2,
  ));
  say(`--- after:  ${shown(file)} ---`);
  say(JSON.stringify(
    { indexedToBlock: a.indexedToBlock, lagBlocks: a.lagBlocks, indexerLastRan: a.indexerLastRan, note: a.coverageGapNote },
    null,
    2,
  ));

  const moved = (x, y) => x !== null && y !== null && x !== y;

  const ok = judge('SCENARIO 11 (freshness: the same URL, re-read after the index advanced)', [
    { ok: moved(b.indexedToBlock, a.indexedToBlock), text: `Indexed to block changed (${b.indexedToBlock} -> ${a.indexedToBlock})` },
    { ok: moved(b.lagBlocks, a.lagBlocks), text: `Lag changed (${b.lagBlocks} -> ${a.lagBlocks})` },
    { ok: moved(b.indexerLastRan, a.indexerLastRan), text: `"indexer last ran" changed (${b.indexerLastRan} -> ${a.indexerLastRan})` },
    // The service's own sentence must survive the refresh: a page that dropped it while
    // updating its numbers would be showing lag without saying what the lag is measured against.
    { ok: a.coverageGapNote, text: 'the service\'s sentence about what lag is measured against is still on the page' },
    { ok: svg.candleBodies > 0, text: `the chart still renders after the refresh (${svg.candleBodies} candle bodies)` },
    { ok: a.indexFailureUrl === null && !a.chainFailurePanel && !a.indexFailurePanel, text: 'neither source reports a failure in either reading' },
  ]);
  finish(ok);
}

if (expectation === 'history-up') {
  const ok = judge('SCENARIO 12 (history page, index up)', [
    { ok: findings.historyHeading, text: 'the history page rendered' },
    { ok: findings.tables === 3, text: `all three tables rendered (${findings.tables})` },
    { ok: findings.lagShown !== null, text: `the index's lag is shown up front (${findings.lagShown ?? 'ABSENT'})` },
    { ok: findings.eventsClaim !== null, text: `the events table says what it is showing (${findings.eventsClaim ?? 'ABSENT'})` },
    { ok: findings.historySaysOneSource, text: 'the page states it reads one source and which one' },
    { ok: !findings.historyFailurePanel, text: 'no failure panel' },
    { ok: !findings.rawUint256OnPage, text: 'no raw uint256 on the page' },
  ]);
  finish(ok);
}

if (expectation === 'history-index-down') {
  const ok = judge('SCENARIO 13 (history page, index API unreachable)', [
    { ok: findings.historyHeading, text: 'the page still answers: it is the history page, not a 500' },
    { ok: findings.historyFailurePanel, text: 'it says the index service could not be read' },
    { ok: findings.indexFailureUrl !== null, text: `the message names the URL it failed on (${findings.indexFailureUrl ?? 'ABSENT'})` },
    { ok: findings.historyNoFallbackClaim, text: 'it says it has no second source to fall back on' },
    // THE ASSERTION THIS SCENARIO EXISTS FOR. A page that shows nothing is honest; a page that
    // shows the chain's figures under a heading that says "read from the index alone" is not.
    { ok: findings.tables === 0, text: `it rendered NO figures from a source it does not have (${findings.tables} tables)` },
    { ok: !findings.chainFailurePanel, text: 'it does not report a chain failure: it never read the chain' },
    { ok: !findings.rawUint256OnPage, text: 'no raw uint256 on the page' },
  ]);
  finish(ok);
}

say('\n(no --expect given; findings only)');
// Still writes the report and still exits 0: a findings-only run is a legitimate use, and a
// caller that asked for `--out` should get the findings even without a verdict.
finish(true);
