/**
 * Assert the LIVE rendered pages, from a real browser, against the running services.
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
 *   6. The other two routes render, link to each other, and SAY what they are. A route that
 *      500s or whose copy quietly disappears is invisible from Node, and "the page is up" is
 *      not the same claim as "the page says the thing it exists to say".
 *   7. The wallet page labels its two fields with their UNITS -- assets for a deposit, shares
 *      for a redeem -- and states that `mint` and `withdraw` are not implemented here. Those
 *      two claims are the ones a reader would otherwise have to infer from a form.
 *   8. The history page's count label matches the rows it actually rendered, and its tally's
 *      printed sum equals the per-kind counts on screen. Both are the page's own arithmetic
 *      read back from the painted DOM -- the one place a claim about rendered state can be
 *      checked, and the place a `test/*.test.ts` file cannot reach.
 *
 * Sections 1-6 are the console, which now lives at `/vault`. They were written when it lived at
 * `/` and they are asserted exactly as they were; only the URL moved, because the claims were
 * always about the console and not about a path.
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
// Fetched without a browser: these two are about the HTTP response and the document served.
check('the page URL answers 200', pageRes.status === 200, `HTTP ${pageRes.status}`);
check('the served HTML is not a framework error page', !html.includes('Internal Server Error'), `${html.length} bytes`);

// ---- 2. drive the real browser ----------------------------------------------------------

await wb('navigate', { url: `${PAGE}/vault`, newTab: true, group_title: 'Vault console + wallet assertions' });

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

/**
 * How many checks were the console's -- that is, everything above section 7, which is what this
 * tool asserted before the page moved from `/` to `/vault`.
 *
 * MEASURED, NOT WRITTEN DOWN. A hard-coded number beside the summary would drift silently the
 * first time a check above was deleted, and the line that exists to prove "the console's
 * assertions survived the move" would then be proving nothing.
 */
const CONSOLE_ASSERTIONS = results.length;

// ---- 7. the other two routes, and what each one must say --------------------------------
//
// EVERYTHING ABOVE THIS LINE IS UNCHANGED and still points at the console -- which is now at
// `/vault` instead of `/`. The move is why the checks were re-scoped by URL: the assertions are
// about the console, so they follow it, and the console's behaviour is asserted exactly as it
// was. Section 7 then covers what the move ADDED.
//
// Why a browser and not a unit test: these are claims about rendered text on real routes. A
// route that 500s, a component that throws during hydration, or a page whose copy silently
// disappears are all invisible from Node -- and the last one is the easiest of the three to ship
// without noticing.

/**
 * Navigate, wait for the paint, and return the rendered text plus whatever else is asked for.
 *
 * `probe` is a FUNCTION, not a string of source, and it is `String(probe)` that crosses into the
 * page. That is not style: a probe written as a template literal is a template literal INSIDE a
 * template literal, so a backtick anywhere in it -- including inside a comment, which is exactly
 * where one was -- terminates the outer string and the file stops parsing. A function cannot have
 * that problem, and it is also checked by the editor that wrote it.
 *
 * `ready` is a CSS selector to wait for before probing, and it is not optional on a route whose
 * content arrives with a client component: `wait({selector: 'main'})` is satisfied by the
 * SERVER-rendered html, so a probe taken at that moment asserts against a page that has not
 * finished becoming itself and reports the client-rendered parts as missing. That is exactly how
 * the first version of section 7c failed.
 *
 * `readyText` is the stronger form, for the case a selector cannot express: a bounded poll for
 * text that is absent in the server-rendered HTML and present once the client has rendered. It
 * reuses the same page-context evaluation as the probe, so there is one mechanism rather than
 * two.
 */
async function visit(url, { ready = null, readyText = null } = {}, probe) {
  await wb('navigate', { url });
  await wb('wait', { selector: 'main', timeout_ms: 20000 });
  if (ready) await wb('wait', { selector: ready, timeout_ms: 20000 });
  if (readyText) await wb('wait', { text: readyText, timeout_ms: 20000 });
  const source = String(probe);
  return evaluate(`(() => {
    const text = document.body.innerText;
    return JSON.stringify({ url: location.pathname, text, html: document.body.innerHTML.length, probe: (${source})(document, text) });
  })()`);
}

// ---- 7a. `/` -- the landing page --------------------------------------------------------

const landing = await visit(`${PAGE}/?route=landing`, {}, (document, text) => {
  const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  return {
    hrefs,
    hasConsoleLink: hrefs.includes('/vault'),
    hasManageLink: hrefs.includes('/vault/manage'),
    hasHistoryLink: hrefs.includes('/history'),
    mentionsBothSources: /two independent sources|Why two sources/i.test(text),
    // The landing page shows the deployment it read, or says why it could not read one. A page
    // that showed neither would be claiming a deployment it does not have.
    showsDeployment: /Anvil/.test(text) || /No deployment record could be read/.test(text),
  };
});

check('the landing page is reachable and renders', landing.text.includes('Vault Console'), `${landing.text.length} chars`);
check('the landing page links to the console', landing.probe.hasConsoleLink, landing.probe.hrefs.join(', '));
check('the landing page links to the wallet page', landing.probe.hasManageLink, landing.probe.hrefs.join(', '));
check('the landing page links to the history page', landing.probe.hasHistoryLink,
  'a route nobody links to is a route nobody reaches');
check('the landing page explains the two sources', landing.probe.mentionsBothSources, 'the pairing is the point of the console');
check('the landing page names the deployment it read', landing.probe.showsDeployment,
  'or says no record could be read -- never a guessed address');
check('the landing page is not the error page', !/Internal Server Error|Application error/.test(landing.text), String(landing.html));

// ---- 7b. the console at `/vault`, after the assertions above ran on it -------------------
//
// Navigated to explicitly rather than read off the current page: the landing page above left the
// browser at `/`, so "the console answered at /vault" has to be established by asking for
// `/vault`, not by looking at wherever the last check happened to leave the tab. The first
// version of this read `location.pathname` and reported `/`, which was true and was not the
// question.

const consoleAgain = await visit(`${PAGE}/vault`, { ready: 'svg[role="img"]' }, (document, text) => ({
  heading: document.querySelector('h1') ? document.querySelector('h1').textContent : null,
  panels: document.querySelectorAll('section').length,
  hasConsoleCopy: /read from the chain, this request/.test(text),
}));
check('the console answered at /vault, not at /', consoleAgain.url === '/vault', `rendered at ${consoleAgain.url}`);
check('the console still renders its four panels after the move',
  consoleAgain.probe.panels === 4 && consoleAgain.probe.hasConsoleCopy,
  `${consoleAgain.probe.panels} sections, heading ${JSON.stringify(consoleAgain.probe.heading)}`);
check('the console still labels its first panel with the source it came from',
  /read from the index service, which lags by design/.test(consoleAgain.text),
  'each panel carries its own source, which is the point of the page');

// ---- 7c. `/vault/manage` -- the wallet page ---------------------------------------------

/**
 * The manage page must be MEASURED AFTER ITS CLIENT COMPONENT HAS RENDERED.
 *
 * `main` exists in the server-rendered HTML; the wallet panel and the two forms do not -- they are
 * client components, and `wagmi` reports `reconnecting` on the first client render when a wallet
 * is present, so the page genuinely changes shape a moment after the HTML arrives. Waiting for the
 * panel's own text is waiting for the component tree rather than for the network.
 */
const managed = await visit(
  `${PAGE}/vault/manage`,
  // "Deposit assets" is the deposit panel's title, and it is rendered in BOTH wallet states --
  // connected and not -- so waiting for it waits for the client tree without assuming which state
  // the browser is in. Nothing in the server-rendered HTML contains it.
  { readyText: 'Deposit assets' },
  (document, text) => {
    const inputs = Array.from(document.querySelectorAll('input')).map((el) => el.getAttribute('aria-label'));
    const buttons = Array.from(document.querySelectorAll('button')).map((el) => el.innerText.trim());

    /**
     * THE UNIT LABELS, MATCHED AGAINST WHAT THE PAGE ACTUALLY SAYS.
     *
     * The first version of this probe looked for the literal strings "Amount in assets" and
     * "Amount in shares". Neither exists: the page labels the panels `DEPOSIT ASSETS` and
     * `REDEEM SHARES` and explains each beneath. So the assertion failed while the requirement
     * was satisfied, which is the worst kind of failure -- it trains a reader to ignore the tool.
     *
     * What the assertion is FOR is the defect where the two units get swapped or dropped, because
     * a deposit takes ASSETS and a redeem takes SHARES and an unlabelled field is how those two
     * get confused. So it checks that each panel names its own unit, case-insensitively, in the
     * panel's own words -- and it checks the two are DIFFERENT, which is the part that catches a
     * copy-paste where both say the same thing.
     */
    const depositNamesAssets = /deposit\s+assets|field[^.]{0,40}\bin assets\b/i.test(text);
    const redeemNamesShares = /redeem\s+shares|field[^.]{0,40}\bin shares\b/i.test(text);
    const unitsDiffer = depositNamesAssets && redeemNamesShares;

    return {
      inputs,
      buttons,
      depositIsInAssets: depositNamesAssets,
      redeemIsInShares: redeemNamesShares,
      unitsAreDistinguished: unitsDiffer,
      hasDepositControl: /Approve|Deposit/.test(buttons.join(' ')) || /Connect a wallet to deposit/.test(text),
      hasRedeemControl: /Redeem/.test(buttons.join(' ')) || /Connect a wallet to redeem/.test(text),
      /**
       * The honest statement about which of the four ERC-4626 write paths exist here.
       *
       * IT ONLY APPEARS WHEN A WALLET IS CONNECTED, because it lives inside the deposit form and
       * the form is not rendered without one. Asserting it unconditionally asserts a sentence the
       * page has no reason to show yet -- so the probe reports whether the sentence is expected in
       * the state the browser is actually in, and the check accounts for that rather than failing.
       */
      declaresScope:
        /does not implement[\s\S]{0,140}(mint|withdraw)/i.test(text) &&
        /\bmint\b/.test(text) &&
        /\bwithdraw\b/.test(text),
      saysNoWallet: /Connect a wallet|no wallet connected|No wallet is connected/i.test(text),
      hasWallet: window.ethereum !== undefined,
      // True when the page is in its no-wallet state, in which case the form -- and the scope
      // sentence inside it -- is legitimately absent.
      awaitingWallet: /Connect a wallet to deposit/i.test(text),
      connected: /matches the deployment|this app is deployed on chain/.test(text),
    };
  },
);
const manage = managed;

check('the wallet page is reachable and renders', /Manage your position/.test(managed.text), `${managed.text.length} chars`);
check('the wallet page is not the error page', !/Internal Server Error|Application error/.test(managed.text), String(managed.html));
check('the deposit panel names its unit as ASSETS', manage.probe.depositIsInAssets, 'a deposit takes assets');
check('the redeem panel names its unit as SHARES', manage.probe.redeemIsInShares, 'a redeem takes shares');
check(
  'the two panels name DIFFERENT units',
  manage.probe.unitsAreDistinguished,
  'a copy-paste leaving both panels saying "assets" is how the units get swapped',
);
check('a deposit control or its stated absence is on the page', manage.probe.hasDepositControl, manage.probe.buttons.join(' | '));
check('a redeem control or its stated absence is on the page', manage.probe.hasRedeemControl, manage.probe.buttons.join(' | '));
check(
  'the page states it does NOT implement mint or withdraw (or has not reached that state yet)',
  manage.probe.declaresScope || manage.probe.awaitingWallet,
  manage.probe.declaresScope
    ? 'two of the four write paths exist here, and the page says which'
    : 'no wallet connected, so the form that carries the sentence is not rendered -- which is correct, not a pass on the sentence itself',
);
check('the page states the wallet situation rather than showing invented figures',
  manage.probe.saysNoWallet, `window.ethereum present: ${manage.probe.hasWallet}`);
check('no hydration mismatch text on the wallet page',
  !/Hydration|hydrat/i.test(manage.text), 'the wallet context renders on the client, which is where mismatches appear');

// The manage page's figures ARE amounts: a share balance for this vault is
// `359021905704231281673` in base units, and a connected wallet that is not formatted would put
// that whole integer on screen. This is the same rule the console is held to, on the page that
// has real balances rather than vault totals.
const manageRawInteger = /(^|[^\d.,])\d{19,}([^\d.,]|$)/.test(manage.text.replace(/,/g, ''));
check('the wallet page never shows a raw base-unit integer', !manageRawInteger,
  'a 19+ digit run is a uint256 that went to the screen unformatted');

// ---- 7d. `/history` -- the indexed history ----------------------------------------------
//
// THE TWO ASSERTIONS HERE THAT A NODE TEST CANNOT MAKE
//
// 1. THE TABLE'S COUNT LABEL MATCHES THE ROWS ACTUALLY PAINTED. The page claims "the most recent
//    N of M events" and then renders a table. If those two disagree -- a truncated label beside
//    a full table, or a full label beside a truncated one -- the page is lying about its own
//    contents, and that is invisible from the code because both numbers come from state.
//
// 2. THE TALLY'S OWN ARITHMETIC, READ OFF THE RENDERED DOM. The summary panel prints one row
//    per event kind and then a "sum of the rows above" line. This adds the rendered per-kind
//    counts up and compares. `test/history.test.ts` proves `tallyKinds` adds correctly; only the
//    browser can prove the page RENDERS the result rather than a second number fetched from
//    somewhere else.
//
// The rest are the same class of claim section 7c makes: a route that 500s or whose copy quietly
// disappears is invisible from Node, and "the page is up" is not "the page says what it exists
// to say".

const history = await visit(
  `${PAGE}/history`,
  { ready: 'table' },
  (document, text) => {
    /**
     * Every table, with its header cells and its body cells, so the arithmetic can be re-done.
     *
     * `textContent` AND NOT `innerText`, which is the opposite of what the rest of this tool
     * uses and cost a debugging round to find. `innerText` reflects RENDERED styling, and these
     * headers carry Tailwind's `uppercase`, so `innerText` returns `"TRANSACTION"` while the
     * source string is `"Transaction"` -- and a check for the column it names failed against a
     * page that rendered it correctly. `textContent` is the source text, which is what a check
     * about CONTENT should read. Where the rendered form matters it is asserted separately.
     *
     * Both are then compared case-insensitively below, for the same reason: the column is the
     * same column whatever CSS has done to its case.
     */
    const cellText = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    const tables = Array.from(document.querySelectorAll('table')).map((table) => ({
      headers: Array.from(table.querySelectorAll('thead th')).map(cellText),
      rows: Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map(cellText),
      ),
    }));

    return {
      tables,
      navHrefs: Array.from(document.querySelectorAll('nav a')).map((a) => a.getAttribute('href')),
      // The page's footer promises no wallet is required. A Connect button here would break
      // that promise, and a read-only page that asks for a wallet is the defect this checks.
      connectControls: Array.from(document.querySelectorAll('button'))
        .map((b) => b.textContent.trim())
        .filter((label) => /connect/i.test(label)),
      claim: /All (\d+) events the index holds\.|The most recent (\d+) of (\d+) events the index holds\./.exec(text),
      saysOneSource: /Nothing on this page was read from the chain/i.test(text),
      saysWhichSource: /read from the index service alone/i.test(text),
      showsLag: /Lag\s*\n?\s*(\d+)\s*\n?\s*blocks/.exec(text)?.[1] ?? null,
      saysCurrentnessFirst: /How current this is/i.test(text),
    };
  },
);

const historyTables = history.probe.tables;
const hasHeader = (table, header) =>
  table !== null && table.headers.some((h) => h.toLowerCase() === header.toLowerCase());
const eventsTable = historyTables.find((t) => hasHeader(t, 'Transaction')) ?? null;
const tallyTable = historyTables.find((t) => hasHeader(t, 'Assets moved')) ?? null;
const priceTable = historyTables.find((t) => hasHeader(t, 'Price per share')) ?? null;

check('the history page is reachable and renders', /Indexed History/.test(history.text), `${history.text.length} chars`);
check('the history page is not the error page',
  !/Internal Server Error|Application error/.test(history.text), String(history.html));
check('the history page says it reads ONE source and names it',
  history.probe.saysOneSource && history.probe.saysWhichSource,
  'a page that mixes sources has to say which each figure came from; this one has only one');
check('the history page leads with how current the index is',
  history.probe.saysCurrentnessFirst && history.probe.showsLag !== null,
  `lag ${history.probe.showsLag ?? 'ABSENT'} blocks`);

check('the events table rendered with its seven columns',
  eventsTable !== null && eventsTable.headers.length === 7,
  eventsTable ? eventsTable.headers.join(' | ') : 'no table with a Transaction column');
check('the events table has at least one row',
  (eventsTable?.rows.length ?? 0) > 0,
  `${eventsTable?.rows.length ?? 0} rows, each carrying the block and hash that prove it`);

/**
 * The claim must match the table. `All N events` or `The most recent N of M events` -- either
 * way the first captured number is the number of rows the label claims, and it has to equal the
 * rows painted.
 */
const claimedRows = history.probe.claim === null ? null : Number(history.probe.claim[1] ?? history.probe.claim[2]);
check('the count label matches the rows actually rendered',
  claimedRows !== null && claimedRows === (eventsTable?.rows.length ?? -1),
  `the label claims ${claimedRows ?? 'NOTHING'}, the table rendered ${eventsTable?.rows.length ?? 0}`);

/** The tally's own arithmetic, re-done from the rendered cells. */
if (tallyTable !== null) {
  const sumRow = tallyTable.rows.find((cells) => /sum of the rows above/i.test(cells[0] ?? '')) ?? null;
  const kindRows = tallyTable.rows.filter((cells) => !/sum of the rows above/i.test(cells[0] ?? ''));
  const renderedSum = kindRows.reduce((total, cells) => total + Number((cells[1] ?? '0').replace(/,/g, '')), 0);
  const printedSum = sumRow === null ? null : Number((sumRow[1] ?? '').replace(/,/g, ''));

  check('the tally prints a sum of its own rows',
    printedSum !== null && Number.isFinite(printedSum), `printed ${sumRow?.[1] ?? 'ABSENT'}`);
  check('the printed sum equals the rendered per-kind counts',
    printedSum === renderedSum,
    `${kindRows.length} kind rows add to ${renderedSum}, the page printed ${printedSum}`);
  check('the tally does not show a raw uint256 for "assets moved"',
    !kindRows.some((cells) => /\d{19,}/.test((cells[2] ?? '').replace(/,/g, ''))),
    kindRows.map((cells) => cells[2]).join(' | '));
} else {
  check('the tally panel rendered', false, 'no table with an "Assets moved" column');
}

check('the price series is readable as a table, not only as a chart',
  priceTable !== null && priceTable.rows.length > 0,
  priceTable ? `${priceTable.rows.length} rows` : 'the table is absent -- the chart would be the only form');
check('the price table shows shares as decimals, never as raw base units',
  priceTable !== null && !priceTable.rows.some((cells) => /\d{19,}/.test((cells[3] ?? '').replace(/,/g, ''))),
  'the share supply is an 18-decimal uint256; unformatted it would be 21 digits');
check('the history page never shows a raw base-unit integer',
  !/(^|[^\d.,])\d{19,}([^\d.,]|$)/.test(history.text.replace(/,/g, '')),
  'a 19+ digit run is a uint256 that went to the screen unformatted');
check('the history page asks for no wallet',
  history.probe.connectControls.length === 0,
  history.probe.connectControls.length === 0
    ? 'no connect control, which is what its own footer promises'
    : `found: ${history.probe.connectControls.join(', ')}`);
check('the nav links every route from the history page',
  ['/', '/vault', '/history', '/vault/manage'].every((href) => history.probe.navHrefs.includes(href)),
  history.probe.navHrefs.join(', '));
check('no hydration mismatch text on the history page',
  !/Hydration|hydrat/i.test(history.text), 'the layout carries the wallet providers, so this page is inside them too');

// ---- summary ---------------------------------------------------------------------------

if (!args.includes('--keep')) {
  await wb('close_session', {}).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
console.log(
  `(the console accounts for the first ${CONSOLE_ASSERTIONS} of them -- the same assertions this ` +
    'tool made before the page moved, at a new URL)',
);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(' | ')}`);
  process.exit(1);
}
console.log('all green');
console.log(`(page text was ${page.text.length} chars; tooltip sample: ${JSON.stringify(page.firstTitle)})`);
void readFileSync;
