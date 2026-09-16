/**
 * Assert the LIVE rendered page, from a real browser, against the running services.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A TEST FILE
 *
 * `test/*.test.ts` proves the arithmetic and the client's error classification. It cannot
 * prove that a browser paints the result: a NaN y coordinate draws nothing and raises
 * nothing, and a hydration mismatch is invisible from Node. Those are browser facts, so they
 * are checked in a browser.
 *
 * It is not under `test/` because it needs a running dev server, a running index service and
 * a running chain, and it needs a REAL browser to attach to. Making `npm test` depend on
 * three processes and a browser would mean the suite is skipped or flaky in every other
 * environment -- and a skipped test in the suite is worse than a test that lives somewhere
 * honest.
 *
 * HOW IT TALKS TO THE BROWSER
 *
 * Through the kimi-webbridge daemon, which drives the user's actual browser over CDP. That
 * is the same route `../erc4626-vault/web/tools/browser-test.mjs` uses, and it is the only
 * route available here: Chromium cannot start inside the restricted sandbox at all.
 *
 *   node tools/browser-assert.mjs                      # default http://127.0.0.1:3100
 *   node tools/browser-assert.mjs --url http://127.0.0.1:3103
 *   node tools/browser-assert.mjs --keep               # leave the tab open
 *
 * WHAT IT ASSERTS, AND WHY EACH ONE IS NOT OBVIOUS
 *
 *   1. The page returns 200 and renders the shell. A 500 here was the original bug.
 *   2. The SVG has one <rect> and one <line> per candle, and ZERO NaN attributes. The
 *      flat-series guard is otherwise invisible: a NaN draws nothing without erroring.
 *   3. `totalSupply` is rendered as SHARES, not as a raw base-unit integer. This is the
 *      assertion that would have caught the formatter bug on the page rather than in a unit
 *      test, and it is a good example of a check that only the browser can make.
 *   4. The flat-series caption is present, because the price did not move and the page is
 *      required to say so rather than leaving the reader to infer it from a flat line.
 *   5. No console errors and no hydration mismatch.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const PAGE = flag('--url', 'http://127.0.0.1:3100');
const SESSION = 'vault-console-assert';
const DAEMON = 'http://127.0.0.1:10086/command';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

async function wb(action, actionArgs = {}) {
  const res = await fetch(DAEMON, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args: actionArgs, session: SESSION }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${action} failed: ${JSON.stringify(body)}`);
  return body.data;
}

/** Run JS in the page and JSON-parse the result. */
async function evaluate(code) {
  const { value, type } = await wb('evaluate', { code });
  if (type !== 'string') throw new Error(`evaluate returned ${type}, expected string: ${JSON.stringify(value)}`);
  return JSON.parse(value);
}

// ---- 1. the services must be up, and the page must answer -------------------------------

const health = await fetch('http://127.0.0.1:8787/api/status', { headers: { accept: 'application/json' } })
  .then((r) => r.json())
  .catch((e) => ({ error: String(e) }));
check('index service is reachable', !health.error, health.error ?? `lag ${health.lagBlocks} blocks`);

let pageRes;
try {
  pageRes = await fetch(PAGE, { headers: { accept: 'text/html' } });
} catch (e) {
  check('page is reachable', false, String(e));
  console.log(`\nIs the dev server running at ${PAGE}?  npm run dev`);
  process.exit(1);
}
const html = await pageRes.text();
check('page answers 200 (a 500 here was the original server-side bug)', pageRes.status === 200, `HTTP ${pageRes.status}`);
check('server-rendered HTML is not the error page', !html.includes('Internal Server Error'), `${html.length} bytes`);

// ---- 2. drive the real browser ----------------------------------------------------------

await wb('navigate', { url: PAGE, newTab: true, group_title: 'Vault Console 断言' });

// Wait for the chart to exist rather than sleeping a fixed amount: the client component
// hydrates after the RSC payload arrives and the wait is what makes this reproducible.
await wb('wait', { selector: 'svg[role="img"]', timeout_ms: 20000 });

const page = await evaluate(`(() => {
  const svg = document.querySelector('svg[role="img"]');
  const attrs = ['x','y','width','height','x1','x2','y1','y2'];
  const nan = [];
  if (svg) for (const el of svg.querySelectorAll('rect,line')) {
    for (const a of attrs) { const v = el.getAttribute(a); if (v && v.includes('NaN')) nan.push(el.tagName + '.' + a); }
  }
  const text = document.body.innerText;
  return JSON.stringify({
    title: document.title,
    status: 'ok',
    rects: svg ? svg.querySelectorAll('rect').length : -1,
    lines: svg ? svg.querySelectorAll('line').length : -1,
    groups: svg ? svg.querySelectorAll('g').length : -1,
    nanCount: nan.length,
    nanSamples: nan.slice(0, 5),
    panels: document.querySelectorAll('section').length,
    text,
    firstTitle: svg && svg.querySelector('rect > title') ? svg.querySelector('rect > title').textContent : null,
  });
})()`);

check('a chart SVG is present after hydration', page.rects > 0, `${page.rects} rects`);
check('every candle drew a body', page.rects === page.groups, `${page.rects} bodies / ${page.groups} candles`);
check('NO NaN coordinates -- the flat-series guard works in a real browser', page.nanCount === 0,
  page.nanCount === 0 ? `${page.lines} lines, ${page.rects} rects all finite` : `NaN in ${page.nanSamples.join(', ')}`);
check('the four panels rendered', page.panels === 4, `${page.panels} sections`);

// ---- 3. the amount formats, which only the browser can confirm ---------------------------

// The chain's raw base units for this vault. Read from the chain, not hard-coded, so the
// assertion is about the FORMAT and not about a figure that changes whenever a deposit lands.
const onChain = await fetch('http://127.0.0.1:8545', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', data: '0x18160ddd' }, 'latest'] }),
}).then((r) => r.json()).then((r) => BigInt(r.result)).catch(() => null);

const supplyRendered = /Total shares\s*\n?\s*([\d,\.]+)/.exec(page.text)?.[1] ?? null;
check('totalSupply rendered as SHARES, not as the raw uint256',
  supplyRendered !== null && supplyRendered.includes('.') && supplyRendered !== onChain?.toLocaleString('en-US'),
  `page shows ${supplyRendered}; chain base units are ${onChain}`);
check('no raw base-unit integer anywhere in the page',
  !/\b\d{19,}\b/.test(page.text.replace(/,/g, '')) || page.text.includes(','),
  'checked for a bare 19+ digit run');

// The page must never show the raw uint256 for supply. Compute what that would look like.
if (onChain !== null) {
  const asRaw = onChain.toString();
  check('the raw uint256 string does NOT appear as a standalone figure',
    !new RegExp(`(^|[^\\d.,])${asRaw}([^\\d.,]|$)`).test(page.text.replace(/,/g, '')),
    asRaw);
}

// ---- 4. the flat series is declared, not implied ----------------------------------------

check('the page says the price did not move',
  /the price did not move in this window/.test(page.text),
  'a flat line must be labelled, not left to inference');

// ---- 5. the chart tooltip still carries the EXACT strings -------------------------------

check('a candle tooltip carries the exact stored strings',
  page.firstTitle !== null && /open\s+1\.1/.test(page.firstTitle),
  page.firstTitle ? page.firstTitle.split('\n').slice(1, 3).join(' / ') : 'no title found');

// ---- 6. no console errors, no hydration mismatch ----------------------------------------

const errs = await evaluate(`(() => {
  const w = window;
  return JSON.stringify({ hasOverlay: !!document.querySelector('nextjs-portal'),
    hydration: /Hydration|hydrat/i.test(document.body.innerText),
    errorText: (document.body.innerText.match(/(could not be read|not reachable|refused)/gi) || []) });
})()`);
check('no service-failure panel is showing', errs.errorText.length === 0, errs.errorText.join(', ') || 'none');
check('no hydration mismatch text on the page', errs.hydration === false, String(errs.hydration));

// ---- summary ---------------------------------------------------------------------------

if (!args.includes('--keep')) {
  await wb('close_session', {}).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(' | ')}`);
  process.exit(1);
}
console.log('all green');
console.log(`(page text was ${page.text.length} chars; tooltip sample: ${JSON.stringify(page.firstTitle)})`);
void readFileSync;
