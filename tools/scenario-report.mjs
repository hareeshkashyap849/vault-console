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
 *   node tools/scenario-report.mjs <file.html> [--expect chain-down|index-down]
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/scenario-report.mjs <file.html> [--expect chain-down|index-down]');
  process.exit(2);
}
const expectFlag = process.argv.indexOf('--expect');
const expectation = expectFlag === -1 ? null : process.argv[expectFlag + 1];

const raw = readFileSync(file, 'utf8');

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
  .replace(/<\/(h1|h2|h3|p|dd|dt|li|div|section|figure|figcaption|footer|header|span)>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#x27;/g, "'")
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
  file,
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
};

console.log(JSON.stringify(findings, null, 2));

const judge = (label, checks) => {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${label}: ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.text}`);
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
  process.exit(ok ? 0 : 1);
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
  process.exit(ok ? 0 : 1);
}

if (expectation === 'index-caught-up') {
  const ok = judge('SCENARIO 11 (both up, index caught up)', [
    { ok: svg.candleBodies > 0, text: `chart renders (${svg.candleBodies} candle bodies)` },
    { ok: findings.indexedToBlock !== null, text: `Indexed to block shown (${findings.indexedToBlock})` },
    { ok: findings.lagBlocks !== null, text: `Lag shown (${findings.lagBlocks})` },
    { ok: findings.healthHeading, text: 'Index health panel present' },
    { ok: !findings.chainFailurePanel && !findings.indexFailurePanel, text: 'no source is reporting a failure' },
  ]);
  process.exit(ok ? 0 : 1);
}

console.log('\n(no --expect given; findings only)');
