/**
 * Produce every scenario report in `docs/evidence/` from the running servers, in one run.
 *
 * WHY THIS IS A PROGRAM AND NOT A PROCEDURE
 *
 * The scenario reports are the evidence for the rows that are recorded as PASSED rather than
 * as implemented-but-unverified. Until now they were produced by hand: start a console instance
 * with one service pointed at a dead port, save the page, remember which file you saved into,
 * run the reporter, and copy the output into `docs/evidence/`. Each of those steps is a chance
 * to record the wrong thing, and this repository has already paid for that once -- a report
 * labelled "scenario 11" had opened the leftover HTML from scenario 10 and said so only because
 * the reporter prints the URL it actually complained about.
 *
 * So the whole sequence is one command. A reviewer can re-run it and compare.
 *
 * THE THREE SERVERS IT EXPECTS, AND WHY THREE
 *
 * A failure path cannot be produced by the page under test: it needs a console instance whose
 * upstream is genuinely absent. Pointing an instance's env var at a port nothing listens on is
 * exactly equivalent to the process having died (connection refused) and it does not disturb the
 * three shared services that the other evidence depends on.
 *
 *   3121  both upstreams reachable          -> scenarios 11, 12
 *   3122  VAULT_API on a dead port           -> scenarios 10, 13
 *   3123  VAULT_RPC on a dead port           -> scenario 9
 *
 * Usage:
 *
 *   node tools/capture-scenarios.mjs                       # against the ports above
 *   node tools/capture-scenarios.mjs --port-up 3131 --port-index-down 3132 --port-chain-down 3133
 *   node tools/capture-scenarios.mjs --keep-html           # leave the saved pages for inspection
 *
 * The saved HTML goes to `.captures/` (git-ignored). It is the input to the report, and it is
 * kept only so a failed run can be inspected -- the committed evidence is the report plus, for
 * the two new rows, a screenshot.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const project = resolve(import.meta.dirname, '..');
const captureDir = join(project, '.captures');
const evidenceDir = join(project, 'docs', 'evidence');
const PORT = {
  up: flag('--port-up', '3121'),
  indexDown: flag('--port-index-down', '3122'),
  chainDown: flag('--port-chain-down', '3123'),
};

/**
 * The five scenarios, each naming the report it writes and the fallback the report must show.
 *
 * `expect` is passed straight to `tools/scenario-report.mjs`, which owns the judgement. Nothing
 * about what "passes" is decided here: this file fetches pages and files reports, and a second
 * opinion about the criteria would be a second set of criteria.
 */
const SCENARIOS = [
  {
    n: 9,
    name: 'scenario-9-chain-down',
    url: `http://127.0.0.1:${PORT.chainDown}/vault`,
    expect: 'chain-down',
    what: 'the chain is unreachable and the index is fine: the two sources fail independently',
  },
  {
    n: 10,
    name: 'scenario-10-index-down',
    url: `http://127.0.0.1:${PORT.indexDown}/vault`,
    expect: 'index-down',
    what: 'the index is unreachable and the chain is fine: the exact reverse of scenario 9',
  },
  {
    n: 11,
    name: 'scenario-11-freshness',
    url: `http://127.0.0.1:${PORT.up}/vault`,
    /**
     * TWO PHASES, because this row is a claim about a CHANGE.
     *
     * With static readings a correct console and a caching console render the same bytes, so the
     * scenario advances the index between the two captures and the reporter judges the pair. The
     * "before" page is separately judged as a healthy console render, so a run where the page was
     * already broken cannot pass by looking like it moved.
     */
    before: { expect: 'index-caught-up' },
    advance: true,
    expect: 'index-advanced',
    what: 'the same URL re-read after the index advanced: four values move together, so nothing is cached',
  },
  {
    n: 12,
    name: 'scenario-12-history-up',
    url: `http://127.0.0.1:${PORT.up}/history`,
    expect: 'history-up',
    what: 'the history page with the index up: three tables, each saying how much it is showing',
  },
  {
    n: 13,
    name: 'scenario-13-history-index-down',
    url: `http://127.0.0.1:${PORT.indexDown}/history`,
    expect: 'history-index-down',
    what: 'the history page with the index down: it has one source and must show nothing, not the chain',
  },
];

mkdirSync(captureDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const failures = [];

/** Fetch a page, failing the scenario rather than throwing when the server is not there. */
async function fetchPage(url) {
  const res = await fetch(url, { headers: { accept: 'text/html' } });
  const html = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return html;
}

/**
 * Run the indexer once, in the sibling repository that owns it.
 *
 * THE INDEX IS NOT A FIXTURE THIS TOOL MAY FAKE. The freshness scenario asks whether the console
 * re-reads the index, so the index has to actually move -- and the only thing allowed to move it
 * is its own indexer. If the chain has not advanced since the last run, this advances nothing and
 * the judgement below fails, which is the correct outcome: the claim is then unproven.
 */
function advanceIndex() {
  const dapp = resolve(project, '..', 'erc4626-vault-dapp');
  console.log(`\n-- advancing the index: node tools/catch-up.mjs --max-runs 1   (in ${dapp})`);
  const result = spawnSync(process.execPath, ['tools/catch-up.mjs', '--max-runs', '1'], {
    cwd: dapp,
    stdio: 'inherit',
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  });
  if (result.status !== 0) console.log(`!! the indexer exited ${result.status}; the comparison below will show whether anything moved`);
}

for (const scenario of SCENARIOS) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`SCENARIO ${scenario.n}  ${scenario.name}`);
  console.log(scenario.what);
  console.log(`${'='.repeat(78)}\n`);

  let html;
  try {
    html = await fetchPage(scenario.url);
    console.log(`${scenario.url}  -> HTTP 200, ${html.length} bytes`);
  } catch (cause) {
    console.log(`!! ${scenario.url} could not be read: ${cause instanceof Error ? cause.message : cause}`);
    console.log('   Is the console instance for this scenario running on that port?');
    failures.push(`${scenario.name}: unreachable`);
    continue;
  }

  const htmlFile = join(captureDir, `${scenario.name}.html`);
  writeFileSync(htmlFile, html, 'utf8');

  /**
   * The reporter writes its own report through `--out`, so the committed file is the output of
   * the run that judged it. `stdio: 'inherit'` because capturing a child through a pipe is
   * refused here (`spawn EPERM` on the named pipe) -- the same limit `tools/run-tests.mjs`
   * documents at length. The child prints to this terminal and writes the file itself.
   */
  const report = (htmlPath, extra) =>
    spawnSync(
      process.execPath,
      [join(project, 'tools', 'scenario-report.mjs'), htmlPath, ...extra],
      { stdio: 'inherit', cwd: project },
    );

  if (scenario.before !== undefined) {
    // Phase 1: the page as it is now, judged as a healthy console render.
    const beforeFile = join(captureDir, `${scenario.name}-before.html`);
    writeFileSync(beforeFile, html, 'utf8');
    const first = report(beforeFile, ['--expect', scenario.before.expect]);
    if (first.status !== 0) {
      failures.push(`${scenario.name}: the "before" page did not pass ${scenario.before.expect}`);
      continue;
    }

    if (scenario.advance) advanceIndex();

    // Phase 2: the same URL, re-read. This is the reading the report is written from.
    try {
      html = await fetchPage(scenario.url);
      console.log(`\n${scenario.url}  -> HTTP 200, ${html.length} bytes (re-read)`);
    } catch (cause) {
      failures.push(`${scenario.name}: the re-read failed: ${cause instanceof Error ? cause.message : cause}`);
      continue;
    }
    writeFileSync(htmlFile, html, 'utf8');

    const second = report(htmlFile, [
      '--expect', scenario.expect,
      '--before', beforeFile,
      '--out', join(evidenceDir, `${scenario.name}.txt`),
    ]);
    if (second.status !== 0) failures.push(`${scenario.name}: report exited ${second.status}`);
    continue;
  }

  const result = report(htmlFile, [
    '--expect',
    scenario.expect,
    '--out',
    join(evidenceDir, `${scenario.name}.txt`),
  ]);

  if (result.status !== 0) failures.push(`${scenario.name}: report exited ${result.status}`);
}

if (!args.includes('--keep-html')) {
  // Only on success: a failed run's HTML is the thing to look at.
  if (failures.length === 0) rmSync(captureDir, { recursive: true, force: true });
  else console.log(`\n.captures/ kept for inspection (${failures.length} failure(s))`);
}

console.log(`\n${'='.repeat(78)}`);
if (failures.length === 0) {
  console.log(`${SCENARIOS.length}/${SCENARIOS.length} scenarios captured and judged PASS`);
  console.log(`reports are in docs/evidence/`);
  process.exit(0);
}
console.log(`${SCENARIOS.length - failures.length}/${SCENARIOS.length} scenarios PASS`);
for (const f of failures) console.log(`  FAILED ${f}`);
process.exit(1);
